import {renderPrompt} from '@vscode/prompt-tsx';
import * as vscode from 'vscode';
import {StackyPrompt} from './prompt';
import {ScopesResponse, StackFrame, StackTraceResponse, VariablesResponse} from './dap';

const MODEL_SELECTOR: vscode.LanguageModelChatSelector = {vendor: 'copilot', family: 'gpt-4o'};

interface CodeContext {
  start: number;
  end: number;
  code: string;
}

// TODO: decrease context as the current frame is further away
function extractCodeContext(code: Uint8Array, line: number, contextSize: number): CodeContext {
  let start = line - contextSize;
  let end = line + contextSize;
  if (start < 0) {
    end -= start;
    start = 0;
  }
  code.toString().split(/\r?\n/).slice(start, end).join('\n');
  return {
    start: start,
    end: end,
    code: code.toString().split(/\r?\n/).slice(start, end).join('\n'),
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
  const localScope = scopes.scopes.find((s: any) => s.name.toLowerCase().includes('local'));
  const globalScope = scopes.scopes.find((s: any) => s.name.toLowerCase().includes('global'));
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
async function getDebugContext(maxStacks = 5, maxVariables = 10): Promise<string> {
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
  for (const trace of traces.stackFrames) {
    // a line is on average 90 chars ~= 30 tokens
    const stackItem = await getStackItem(trace, Math.ceil(8192 / (maxStacks * 30)));

    out += `\nStack Frame ${i + 1} "${stackItem.fn}" in "${stackItem.file}:"\n`;
    if (trace.id === frameId) {
      out += 'Local Variables:\n';
      let j = 0;
      for (const variable of variables.local?.variables ?? []) {
        out += `${variable.name} = ${variable.value}\n`;
        if (++j >= maxVariables) {
          break;
        }
      }
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

function exportHistory(history: ReadonlyArray<vscode.ChatRequestTurn | vscode.ChatResponseTurn>): string {
  // TODO: extract only the relevant information from the history
  let out = '';
  let i = history.length - 1;
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

    let debugContext, history;
    if (request.command.includes('c')) {
      debugContext = await getDebugContext();
    }
    if (request.command.includes('h')) {
      history = exportHistory(chatContext.history);
    }
    try {
      const [model] = await vscode.lm.selectChatModels(MODEL_SELECTOR);
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
