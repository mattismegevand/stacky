## stacky

stacky is a VS Code extension that provides a specialized Copilot chat assistant for debugging. It leverages the current debug context and chat history to provide more accurate and context-aware answers to your debugging questions.

### Features

- Retrieves call stack information and local/global variables to answer user questions
- Integrates seamlessly with VS Code's built-in debugging and chat features
- Supports context-aware commands for tailored responses
- Allows copying debug context to clipboard for external use

### Usage

1. Start a debugging session in VS Code
2. Open the VS Code chat (Ctrl+Shift+P, then type "Chat: Focus on Chat View")
3. Type `@stacky` followed by a command and your question

#### Commands

- `/c`: Use debug context only
- `/h`: Use chat history only
- `/ch` or `/hc`: Use both debug context and chat history

Note: To use the debug context, you need to be on an active breakpoint.

#### Examples

```
@stacky /c What's causing this null pointer exception?
@stacky /h Can you explain the last solution again?
@stacky /ch Why isn't my loop terminating?
```

### Additional Features

#### Copy Debug Context

You can copy the current debug context to your clipboard using the following commands:

- `Stacky: Copy Debug Context`: Copies the debug context including variables
- `Stacky: Copy Debug Context (No Variables)`: Copies the debug context without variables

These can be accessed via the Command Palette (Ctrl+Shift+P).

### Configuration

You can customize Stacky's behavior through VS Code settings:

- `stacky.model`: Set the AI model to use (default: 'gpt-4o')
- `stacky.debugContextMaxStacks`: Maximum number of stack frames to include in the context (default: 5)
- `stacky.debugContextMaxVars`: Maximum number of variables to include per frame (default: 10)

### Planned Features

- Provide an API for the model to enable more advanced output display to the user
- Enhance context filtering for more relevant information
- Improve variable selection based on relevance
- Capture runtime error

### License

[MIT License](LICENSE)
