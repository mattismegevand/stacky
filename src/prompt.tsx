import {TextChunk, BasePromptElementProps, PromptElement, PromptSizing, UserMessage} from '@vscode/prompt-tsx';

export interface StackyPromptProps extends BasePromptElementProps {
  userPrompt: string;
  debugContext?: string;
  history?: string;
}

export class StackyPrompt extends PromptElement<StackyPromptProps, void> {
  render(state: void, sizing: PromptSizing) {
    return (
      <>
        <UserMessage priority={400}>
          You are Stacky, an AI debugging assistant. Based on the context you are provided answer the user question.
          Respond in a clear, concise manner suitable for display in an IDE.
        </UserMessage>
        <UserMessage priority={300}>
          <TextChunk breakOn=" ">User Prompt: {this.props.userPrompt.trim()}</TextChunk>
        </UserMessage>
        {(this.props.debugContext && (
          <UserMessage priority={200}>
            <TextChunk breakOn=" ">Debug Context: {this.props.debugContext}</TextChunk>
          </UserMessage>
        )) || <></>}
        {(this.props.history && (
          <UserMessage priority={100}>
            <TextChunk breakOn=" ">History: {this.props.history}</TextChunk>
          </UserMessage>
        )) || <></>}
      </>
    );
  }
}
