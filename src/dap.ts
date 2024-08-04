type ChecksumAlgorithm = 'MD5' | 'SHA1' | 'SHA256' | 'timestamp';

interface Checksum {
  algorithm: ChecksumAlgorithm;
  checksum: string;
}

interface Source {
  name?: string;
  path?: string;
  sourceReference?: number;
  presentationHint?: 'normal' | 'emphasize' | 'deemphasize';
  origin?: string;
  sources?: Source[];
  adapterData?: any;
  checksums?: Checksum[];
}

export interface StackFrame {
  id: number;
  name: string;
  source?: Source;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  canRestart?: boolean;
  instructionPointerReference?: string;
  moduleId?: number | string;
  presentationHint?: 'normal' | 'label' | 'subtle';
}

export interface StackTraceResponse extends Response {
  stackFrames: StackFrame[];
  totalFrames?: number;
}

interface ProtocolMessage {
  seq: number;
  type: 'request' | 'response' | 'event' | string;
}

interface Response extends ProtocolMessage {
  type: 'response';
  request_seq: number;
  success: boolean;
  command: string;
  message?: 'cancelled' | 'notStopped' | string;
  body?: any;
}

export interface Scope {
  name: string;
  presentationHint?: 'arguments' | 'locals' | 'registers' | 'returnValue' | string;
  variablesReference: number;
  namedVariables?: number;
  indexedVariables?: number;
  expensive: boolean;
  source?: Source;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

export interface ScopesResponse extends Response {
  scopes: Scope[];
}

interface VariablePresentationHint {
  kind?:
    | 'property'
    | 'method'
    | 'class'
    | 'data'
    | 'event'
    | 'baseClass'
    | 'innerClass'
    | 'interface'
    | 'mostDerivedClass'
    | 'virtual'
    | 'dataBreakpoint'
    | string;
  attributes?: (
    | 'static'
    | 'constant'
    | 'readOnly'
    | 'rawString'
    | 'hasObjectId'
    | 'canHaveObjectId'
    | 'hasSideEffects'
    | 'hasDataBreakpoint'
    | string
  )[];
  visibility?: 'public' | 'private' | 'protected' | 'internal' | 'final' | string;
  lazy?: boolean;
}

interface Variable {
  name: string;
  value: string;
  type?: string;
  presentationHint?: VariablePresentationHint;
  evaluateName?: string;
  variablesReference: number;
  namedVariables?: number;
  indexedVariables?: number;
  memoryReference?: string;
}

export interface VariablesResponse extends Response {
  variables: Variable[];
}
