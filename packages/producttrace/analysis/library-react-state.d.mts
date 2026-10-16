import type {LibraryProgram} from './library-program.mjs';
import type {LibraryExecutionContext} from './library-execution-context.mjs';
export function createReactStateBoundary(options:{program:LibraryProgram;api:'useState'|'useReducer';occurrencePrefix?:string;executionContext?:LibraryExecutionContext|null;executionSource?:unknown}):{
  invoke(owner:object,args:unknown[],producer:Function,receiver?:unknown,host?:{initializerCalls:number}):unknown;
  commit(owner:object,render:string|null):void;
  disconnect(owner:object):void;
  render(owner:object):string|null;
  prepareCall(dispatch:Function,source?:unknown):((...args:unknown[])=>unknown)|null;
  checkpoint():{status:'frontier'|'observed_agreement';owners:number;failures:unknown[];evidence:any[];scope:string};
};
export function createReactStateHost(React:any):{
  protocol:'react_state_queue';
  invoke(options:{boundary:ReturnType<typeof createReactStateBoundary>;producer:Function;args:unknown[];receiver?:unknown}):unknown;
};
