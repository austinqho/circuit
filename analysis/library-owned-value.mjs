import {validateLibraryProgram} from './library-program.mjs';
import {createLibraryBoundary} from './library-boundary.mjs';

/** Replay a stateful value API in a host-attested slot. The program bootstraps
 * one private closure per owner; each real API call invokes that closure with
 * the same arguments. The existing boundary checks results, aliases and throws.
 * Only checker-declared callback positions receive capabilities. Their actual
 * outcomes are recorded once; replay never executes application code again.
 * Owner identity alone does not establish render commit or rollback.
 */
export function createOwnedValueBoundary({producer,program,captureOwner,captureGeneration=null,callbackArguments=[],dataReadEvidence=false,accessorObservation='reject',occurrencePrefix='owned-value',executionContext=null,executionSource=null}) {
  if(typeof producer!=='function'||typeof captureOwner!=='function')throw new TypeError('owned_value_host');
  if(captureGeneration!==null&&typeof captureGeneration!=='function')throw new TypeError('owned_generation_host');
  if(executionContext!==null&&(typeof executionContext.run!=='function'||typeof executionContext.current!=='function'))throw new TypeError('execution_context_host');
  const format=validateLibraryProgram(program);
  if(!format.valid)throw new TypeError(format.errors.join(','));
  program=structuredClone(program);
  const owners=new WeakMap(),states=[],failures=[],evidence=[],identities=new WeakMap();
  let ownerSequence=0,generationSequence=0,callSequence=0,valueSequence=0;
  const identity=value=>{
    if(value===null||!['object','function'].includes(typeof value))return {kind:value===null?'null':typeof value};
    if(!identities.has(value))identities.set(value,`${occurrencePrefix}:value:${++valueSequence}`);
    return {kind:typeof value,identity:identities.get(value)};
  };
  return Object.freeze({
    invoke(args,{receiver=undefined}={}) {
      if(!Array.isArray(args)||args.length>64)throw new TypeError('boundary_arguments');
      const occurrence=`${occurrencePrefix}:${++callSequence}`;
      let owner,generation;
      try{owner=captureOwner(args);generation=captureGeneration?captureGeneration(args):owner;}catch{}
      if(!owner||!['object','function'].includes(typeof owner)||!generation||!['object','function'].includes(typeof generation)) {
        failures.push({occurrence,reason:!owner||!['object','function'].includes(typeof owner)?'mounted_owner_unavailable':'cache_generation_unavailable'});
        const call=()=>Reflect.apply(producer,receiver,args);
        return executionContext?executionContext.run({kind:'library_invocation',occurrence,source:executionSource},call):call();
      }
      let owned=owners.get(owner);
      if(!owned){owned={id:`${occurrencePrefix}:owner:${++ownerSequence}`,generations:new WeakMap()};owners.set(owner,owned);}
      let state=owned.generations.get(generation);
      if(!state) {
        const id=`${owned.id}:generation:${++generationSequence}`;
        // This private factory never calls the library. Its returned proxy is
        // used only inside Tracer, so the application receives its real value
        // with unchanged identity. It reuses the same interpreter and observer
        // as ordinary returned-closure contracts, rather than another evaluator.
        const boundary=createLibraryBoundary({producer:()=>function(...values){return Reflect.apply(producer,this,values)},
          // The first call only creates a private replay closure. Suppress its
          // execution event; later invocations represent the actual owned API.
          executionSource,executionContext:executionContext?{
            current:()=>executionContext.current(),
            run(event,work){
              const frame=state?.frames.get(event.occurrence);
              if(!frame)return work(null);
              return executionContext.run({...event,occurrence:frame.occurrence},record=>{
                if(event.kind==='library_invocation')frame.executionId=record?.id??null;
                return work(record);
              });
            },
          }:null,
          program,dataReadEvidence,accessorObservation,callbackArguments:[],returnedCallbackArguments:callbackArguments,returnedResultMode:'value',occurrencePrefix:id,
          onOccurrence(event){if(state?.active){state.active.boundaryOccurrence??=event.occurrence;state.frames.set(event.occurrence,state.active)}}});
        state={id,owner:owned.id,boundary,invoke:boundary.invoke([]),calls:0,frames:new Map()};
        owned.generations.set(generation,state);states.push(state);
      }
      state.calls++;
      const frame={boundaryOccurrence:null,occurrence,executionId:null},previousFrame=state.active;state.active=frame;
      try {
        const result=Reflect.apply(state.invoke,receiver,args);
        evidence.push({schema:'producttrace.library-owned-value.v1',occurrence,boundary_occurrence:frame.boundaryOccurrence,execution_id:frame.executionId,owner:state.owner,generation:state.id,kind:'returned_value',value:identity(result),
          reason:'The actual API returned this value in the host-attested slot. Persistent program replay checks its observed value graph; this does not prove a commit or explain outside writes.'});
        return result;
      } catch(error) {
        evidence.push({schema:'producttrace.library-owned-value.v1',occurrence,boundary_occurrence:frame.boundaryOccurrence,execution_id:frame.executionId,owner:state.owner,generation:state.id,kind:'thrown_value',value:identity(error),
          reason:'The actual API threw in this slot. Replay checks the same outcome and preserves the original thrown value.'});
        throw error;
      } finally {state.active=previousFrame;}
    },
    checkpoint() {
      const reports=states.map(state=>({owner:state.owner,generation:state.id,api_calls:state.calls,bootstrap_calls:1,...state.boundary.checkpoint()}));
      const status=failures.length||reports.some(row=>row.status!=='observed_agreement')?'frontier':'observed_agreement';
      return {status,observation_mode:'owned_values',calls:callSequence,owners:ownerSequence,generations:reports.length,failures:structuredClone(failures),reports,
        evidence:structuredClone([...evidence,...reports.flatMap(row=>row.evidence.map(item=>({...item,owner:row.owner,generation:row.generation})))].map(row=>({...row,status})))};
    },
  });
}
