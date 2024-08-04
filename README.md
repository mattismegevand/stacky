## stacky

stacky is a copilot chat assistant specialized in debugging

features:
- retrieve call stack and local/global variables to answer the user question

usage:
- launch a debugging session
- while stopped on a breakpoint launch a chat with stacky using `@stacky` and provide the command along with the prompt: `@stacky /debug <error message/description of bug>`

planned features:
- suggest breakpoints
- add ability for user to mark suspect function/variable
- use history to refine model understanding of the bug
