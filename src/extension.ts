import {renderPrompt} from '@vscode/prompt-tsx';
import * as vscode from 'vscode';
import {DebugPrompt} from './prompt';
import {ScopesResponse, StackFrame, StackTraceResponse, VariablesResponse} from './dap';

interface StackyChatResult extends vscode.ChatResult {
  metadata: {
    command: string;
  };
}

const MODEL_SELECTOR: vscode.LanguageModelChatSelector = {vendor: 'copilot', family: 'gpt-4o'};

interface CodeContext {
  start: number;
  end: number;
  code: string;
}

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
async function getStackTraceContext(maxStacks = 3, maxVariables = 5): Promise<string> {
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
    const stackItem = await getStackItem(trace, 10);

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

export function activate(context: vscode.ExtensionContext) {
  const handler: vscode.ChatRequestHandler = async (
    request: vscode.ChatRequest,
    chatContext: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<StackyChatResult> => {
    // TODO: currently history is not used we should use it, especially with request without commands
    if (request.command === 'debug') {
      stream.progress('Debugging...');
      const stackTraceContext = await getStackTraceContext();
      try {
        const [model] = await vscode.lm.selectChatModels(MODEL_SELECTOR);
        if (model) {
          const {messages} = await renderPrompt(
            DebugPrompt,
            {bugDesc: request.prompt, stackTrace: stackTraceContext},
            {modelMaxPromptTokens: model.maxInputTokens},
            model,
          );

          if (stackTraceContext === '') {
            stream.markdown('Make sure you are in a debugging session to use this command.');
          } else {
          const chatResponse = await model.sendRequest(messages, {}, token);
          for await (const fragment of chatResponse.text) {
            stream.markdown(fragment);
          }
        }
        }
      } catch (err) {
        handleError(logger, err, stream);
      }
      logger.logUsage('request', {kind: 'debug'});
      return {metadata: {command: 'breakpoint'}};
    } else if (request.command === 'breakpoint') {
      //TODO: implement breakpoint command
      logger.logUsage('request', {kind: 'breakpoint'});
      return {metadata: {command: 'debug'}};
    } else {
      try {
        const [model] = await vscode.lm.selectChatModels(MODEL_SELECTOR);
        if (model) {
          const messages = [
            vscode.LanguageModelChatMessage.User(
              `You are a debugger assistant. Answer the following questions based on the information given by the user:`,
            ),
            vscode.LanguageModelChatMessage.User(request.prompt),
          ];

          const chatResponse = await model.sendRequest(messages, {}, token);
          for await (const fragment of chatResponse.text) {
            stream.markdown(fragment);
          }
        }
      } catch (err) {
        handleError(logger, err, stream);
      }
      logger.logUsage('request', {kind: ''});
      return {metadata: {command: ''}};
    }
  };

  const stacky = vscode.chat.createChatParticipant('stacky.stacky', handler);
  stacky.iconPath = {
    light: vscode.Uri.joinPath(context.extensionUri, 'icon_light.png'),
    dark: vscode.Uri.joinPath(context.extensionUri, 'icon_dark.png'),
  };

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
