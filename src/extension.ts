import * as vscode from 'vscode';
import {Scope, ScopesResponse, StackFrame, StackTraceResponse, VariablesResponse} from './dap';
import {StackyPrompt} from './prompt';
import {renderPrompt} from '@vscode/prompt-tsx';

const MODEL_SELECTOR: vscode.LanguageModelChatSelector = {
  vendor: 'copilot',
  family: vscode.workspace.getConfiguration('stacky').get('model') || 'gpt-4o',
};

interface CodeContext {
  start: number;
  end: number;
  code: string;
}

// TODO: decrease context as the current frame is further away
function extractCodeContext(code: Uint8Array, line: number, contextSize: number): CodeContext {
  let start = Math.max(0, line - contextSize);
  let end = Math.min(line + contextSize, code.length);
  const lines = code.toString().split(/\r?\n/);
  const contextLines = lines.slice(start, end);

  const lineNumberWidth = end.toString().length;

  const numberedLines = contextLines.map((lineContent, index) => {
    const lineNumber = start + index + 1;
    const isCurrentLine = lineNumber === line;
    return `${lineNumber.toString().padStart(lineNumberWidth, ' ')}${isCurrentLine ? '>' : ' '} | ${lineContent}`;
  });

  return {
    start: start + 1,
    end: end,
    code: numberedLines.join('\n'),
  };
}

interface StackFrameContext {
  file: string;
  fn: string;
  context?: CodeContext;
}

async function getStackItem(trace: StackFrame, contextSize: number): Promise<StackFrameContext> {
  const filepath = trace.source?.path;
  if (filepath === undefined) {
    return {file: '', fn: '', context: undefined};
  }
  const code = await vscode.workspace.fs.readFile(vscode.Uri.parse(filepath));
  const relativePath = vscode.workspace.asRelativePath(filepath, true);
  return {
    file: relativePath,
    fn: trace.name,
    context: extractCodeContext(code, trace.line, contextSize),
  };
}

interface Variables {
  local?: VariablesResponse;
  global?: VariablesResponse;
}

// TODO: we might want to filter some variables, check how to find the most relevant ones (Copilot use Jaccard?)
async function getVariables(session: vscode.DebugSession, scopes: ScopesResponse): Promise<Variables> {
  const localScope = scopes.scopes.find((s: Scope) => s.name.toLowerCase().includes('local'));
  const globalScope = scopes.scopes.find((s: Scope) => s.name.toLowerCase().includes('global'));
  const localVariables: VariablesResponse | undefined =
    localScope !== undefined
      ? await session.customRequest('variables', {variablesReference: localScope.variablesReference})
      : undefined;
  const globalVariables: VariablesResponse | undefined =
    globalScope !== undefined
      ? await session.customRequest('variables', {variablesReference: globalScope.variablesReference})
      : undefined;
  return {
    local: localVariables,
    global: globalVariables,
  };
}

// TODO: find right value for maxStacks and maxVariables depending on token budget
async function getDebugContext(
  model: vscode.LanguageModelChat | undefined = undefined,
  grabVars = true,
): Promise<string> {
  const session = vscode.debug.activeDebugSession;
  if (session === undefined) {
    return '';
  }
  const threadId = vscode.debug?.activeStackItem?.threadId;
  const frameId = (vscode.debug?.activeStackItem as vscode.DebugStackFrame)?.frameId;
  if (threadId === undefined || frameId === undefined) {
    return '';
  }
  const traces: StackTraceResponse = await session.customRequest('stackTrace', {threadId: threadId});
  let i = 0;
  let out = '';
  const scopes: ScopesResponse = await session.customRequest('scopes', {frameId: frameId});
  const variables = await getVariables(session, scopes);

  const maxInputTokens = model?.maxInputTokens ?? 4096;
  const config = vscode.workspace.getConfiguration('stacky');
  const maxStacks: number | undefined = config.get('debugContextMaxStacks') || 5;
  const maxVars: number | undefined = config.get('debugContextMaxVars') || 10;

  for (const trace of traces.stackFrames) {
    // a line is on average 90 chars ~= 30 tokens
    const stackItem = await getStackItem(trace, Math.ceil(maxInputTokens / (maxStacks * 30)));
    out += `\nStack Frame ${i + 1} "${stackItem.fn}" in "${stackItem.file}:"\n`;

    if (grabVars && maxVars > 0 && trace.id === frameId) {
      out += '\nLocal Variables:\n';
      let j = 0;
      for (const variable of variables.local?.variables ?? []) {
        out += `${variable.name} = ${variable.value}\n`;
        if (++j >= maxVars) {
          break;
        }
      }
      out += '\n';
    }

    if (stackItem.context !== undefined) {
      out += '```\n' + stackItem.context.code + '\n```\n';
    }
    if (++i >= maxStacks) {
      break;
    }
  }
  return out.trim();
}

async function copyDebugContext(grabVars = true): Promise<void> {
  const [model] = await vscode.lm.selectChatModels(MODEL_SELECTOR);
  const debugContext = await getDebugContext(model, grabVars);
  vscode.env.clipboard.writeText(debugContext);
}

function exportHistory(history: ReadonlyArray<vscode.ChatRequestTurn | vscode.ChatResponseTurn>): string {
  // TODO: extract only the relevant information from the history
  let out = '';
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    if (message instanceof vscode.ChatResponseTurn && message.response[0]?.value instanceof vscode.MarkdownString) {
      out += `Stacky: ${message.response[0].value.value}\n`;
    } else if (message instanceof vscode.ChatRequestTurn) {
      out += `User: ${message.command ? '/' + message.command : ''} ${message.prompt}\n`;
    }
  }
  return out;
}

export function activate(context: vscode.ExtensionContext) {
  let api = {
    getDebugContext,
  };

  const handler: vscode.ChatRequestHandler = async (
    request: vscode.ChatRequest,
    chatContext: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<void> => {
    stream.progress('Thinking...');
    const validCommands = ['c', 'h', 'ch', 'hc'];
    if (request.command === undefined || !validCommands.includes(request.command)) {
      stream.markdown(`Invalid command. Please use one of the following:
-  \`/c\`: Use debug context only
- \`/h\`: Use chat history only
- \`/ch\` or \`/hc\`: Use both debug context and chat history

Followed by your question or prompt.`);
      return;
    }
    if (!request.prompt) {
      stream.markdown(`Please provide a prompt after the command. For example:
- "\`/c\` What's causing the null pointer exception?"
- "\`/h\` Can you explain the previous solution again?"
- "\`/ch\` Why is my loop not terminating?"`);
      return;
    }

    const [model] = await vscode.lm.selectChatModels(MODEL_SELECTOR);

    let debugContext, history;
    if (request.command.includes('c')) {
      debugContext = await getDebugContext(model);
    }
    if (request.command.includes('h')) {
      history = exportHistory(chatContext.history);
    }
    try {
      if (model) {
        const {messages} = await renderPrompt(
          StackyPrompt,
          {userPrompt: request.prompt, debugContext: debugContext, history: history},
          {modelMaxPromptTokens: model.maxInputTokens},
          model,
        );
        const chatResponse = await model.sendRequest(messages, {}, token);
        for await (const fragment of chatResponse.text) {
          stream.markdown(fragment);
        }
      }
    } catch (err) {
      handleError(logger, err, stream);
    }
    logger.logUsage('request', {kind: ''});
  };

  const stacky = vscode.chat.createChatParticipant('stacky.stacky', handler);
  stacky.iconPath = vscode.Uri.joinPath(context.extensionUri, 'icon.png');

  // TODO: add real code to capture events and errors
  const logger = vscode.env.createTelemetryLogger({
    sendEventData(eventName, data) {
      console.log(`Event: ${eventName}`);
      console.log(`Data: ${JSON.stringify(data)}`);
    },
    sendErrorData(error, data) {
      console.error(`Error: ${error}`);
      console.error(`Data: ${JSON.stringify(data)}`);
    },
  });

  // TODO: add real code to capture feedback
  context.subscriptions.push(
    stacky.onDidReceiveFeedback((feedback: vscode.ChatResultFeedback) => {
      logger.logUsage('chatResultFeedback', {
        kind: feedback.kind,
      });
    }),
  );

  context.subscriptions.push(vscode.commands.registerCommand('stacky.copyDebugContext', copyDebugContext));
  context.subscriptions.push(
    vscode.commands.registerCommand('stacky.copyDebugContextNoVars', () => copyDebugContext(false)),
  );

  return api;
}

function handleError(logger: vscode.TelemetryLogger, err: any, stream: vscode.ChatResponseStream): void {
  logger.logError(err);

  if (err instanceof vscode.LanguageModelError) {
    console.log(err.message, err.code, err.cause);
    if (err.cause instanceof Error && err.cause.message.includes('off_topic')) {
      stream.markdown("I'm sorry, I can't help with that.");
    }
  } else {
    throw err;
  }
}

export function deactivate() {}
