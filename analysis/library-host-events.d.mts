import type {LibraryProgram} from './library-program.mjs';
export function createHostEventBoundary(options:{program:LibraryProgram;occurrencePrefix?:string;executionContext?:unknown;executionSource?:unknown;callbackArguments?:number[];nullableCallbackArguments?:number[];callbackReturnArguments?:number[];stableCallbackArguments?:number[];objectRefArguments?:number[];dependencyArgument?:number}):{
  register(owner:object,args:unknown[],producer:Function,receiver?:unknown):unknown;
  begin(owner:object,event:'commit'|'disconnect'):void;
  flush(owner:object):void;
  checkpoint():{status:'frontier'|'observed_agreement';observation_mode:'host_events';owners:number;failures:unknown[];evidence:unknown[]};
};
