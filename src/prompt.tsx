import {AssistantMessage, BasePromptElementProps, PromptElement, PromptSizing, UserMessage} from '@vscode/prompt-tsx';

export interface DebugPromptProps extends BasePromptElementProps {
  bugDesc: string;
  stackTrace: string;
}

export class DebugPrompt extends PromptElement<DebugPromptProps, void> {
  render(state: void, sizing: PromptSizing) {
    // TODO: set priority for UserMessage desc should be higher than stackTrace?
    return (
      <>
        <UserMessage>
          You are an AI debugging assistant. Based on the information given by the user:
          <br />
          1. Identify the likely cause of the bug.
          <br />
          2. Suggest a potential fix or next debugging step.
          <br />
          3. Explain your reasoning.
          <br />
          4. If more information is needed, specify what additional details would be helpful.
          <br />
          Respond in a clear, concise manner suitable for display in an IDE.
        </UserMessage>
        <UserMessage>Bug Description: {this.props.bugDesc}</UserMessage>
        <UserMessage>Stack Trace: {this.props.stackTrace}</UserMessage>
      </>
    );
  }
}
