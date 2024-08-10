## stacky

stacky is a copilot chat assistant specialized in debugging

### features

- retrieve call stack and local/global variables to answer the user question

### usage

- start a debugging session in VS Code
- open the VS Code chat
- type `@stacky` followed by a command and your question

### commands

- `/c`: use debug context only
- `/h`: use chat history only
- `/ch`: use both debug context and chat history

note that to use the debug context you need to be on an active breakpoint.

### examples

```
@stacky /c What's causing this null pointer exception?
@stacky /h Can you explain the last solution again?
@stacky /ch Why isn't my loop terminating?
```

### planned features

- provide a kind of API for the model so that more advanced output could be displayed to the user
- add command to copy context to clipboard for external prompting
