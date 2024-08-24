import { BasePromptElementProps, PromptElement, PromptSizing, TextChunk, UserMessage } from '@vscode/prompt-tsx';

export interface StackyPromptProps extends BasePromptElementProps {
  userPrompt?: string;
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
        {(this.props.userPrompt && (
          <UserMessage priority={300}>
            <TextChunk breakOn=" ">User Prompt: {this.props.userPrompt.trim()}</TextChunk>
          </UserMessage>
        )) || <></>}
        {(this.props.debugContext && (
          <>
            <UserMessage priority={250}>
              Analyze the provided debug context. Focus on the current stack frame, variables, and code snippet to identify potential issues.
            </UserMessage>
            <UserMessage priority={200}>
              <TextChunk breakOn=" ">Debug Context: {this.props.debugContext}</TextChunk>
            </UserMessage>
            <UserMessage priority={250}>
              Structure your response as follows:
              1. Brief summary of the identified issue (1-2 sentences)
              2. Detailed explanation (2-3 bullet points)
              3. Suggested fix or next debugging steps (1-2 sentences)
              If you don't have enough information provide advice on what additional information you need.
              You can also suggest other breakpoints to get more information.
              Use markdown formatting for code snippets or important terms.
            </UserMessage>
          </>
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
