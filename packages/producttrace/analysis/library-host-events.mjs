import {types} from 'node:util';
import {createLibraryProgram} from './library-program.mjs';

/** Replay an owned registration protocol at independently observed host events.
 * The program is a private factory returning an event handler. It receives
 * [event, registrationArguments]; it can invoke only shadow callbacks whose
 * results were already recorded by the real library. A host event is never
 * inferred from the application callback whose execution is being checked.
 */
export function createHostEventBoundary({program,occurrencePrefix='host-event',executionContext=null,executionSource=null,callbackArguments=[0],nullableCallbackArguments=[],callbackReturnArguments=[0],stableCallbackArguments=[],objectRefArguments=[],dependencyArgument=1}) {
  const {arity}=validateHostEventLayout({callbackArguments,nullableCallbackArguments,callbackReturnArguments,stableCallbackArguments,objectRefArguments,dependencyArgument});
  const states=new WeakMap(),all=[],failures=[],evidence=[];let sequence=0,valueSequence=0;
  const values=new WeakMap();
  const identify=value=>{const kind=value===null?'null':typeof value;
    if(value===null||!['object','function'].includes(kind))return {kind};
    if(!values.has(value))values.set(value,`${occurrencePrefix}:value:${++valueSequence}`);
    return {kind,identity:values.get(value)};
  };
  const fail=(state,reason)=>failures.push({owner:state?.id??null,reason});
  const get=owner=>{
    if(!owner||!['object','function'].includes(typeof owner))throw new TypeError('host_event_owner');
    let state=states.get(owner);
    if(!state){
      const engine=createLibraryProgram(program),handler=engine.invoke([]);
      if(!engine.canInvoke(handler))throw new TypeError('host_event_program_factory');
      state={id:`${occurrencePrefix}:owner:${++sequence}`,engine,handler,calls:[],pending:null,replay:null,registrations:0,callbackCalls:0,dependencyLength:null,callbackCache:new WeakMap(),refCache:new WeakMap()};
      states.set(owner,state);all.push(state);
    }
    return state;
  };
  const replay=(state,event,args=[])=>{
    const observed=state.calls.splice(0),frame={observed,index:0};state.replay=frame;
    try {
      const result=state.engine.invokeCallable(state.handler,[event,args]);
      if(result!==undefined)fail(state,'host_event_rule_must_return_undefined');
      if(frame.index!==observed.length)fail(state,'host_event_callback_count_mismatch');
    }catch(error){fail(state,String(error.message));}
    finally{state.replay=null;}
    evidence.push({kind:'host_event_checked',owner:state.id,event,callbacks:observed.length,
      reason:'An independent host lifecycle observation triggered replay; callback execution was recorded separately.'});
  };
  const pair=(state,original,source,depth=0,observeReturn=true,sources=new Set([source]))=>{
    const capability={},shadow=function(...args){
      const frame=state.replay,call=frame?.observed[frame.index++];
      if(!call||call.capability!==capability)throw Error('host_event_callback_order_mismatch');
      if(call.receiver!==this||args.length!==call.args.length||args.some((value,index)=>!Object.is(value,call.args[index])))
        throw Error('host_event_callback_arguments_mismatch');
      if(call.threw)throw call.value;
      return call.predicted;
    };
    state.engine.grantCallback(shadow);
    const actual=new Proxy(original,{apply(target,receiver,args){
      const call={capability,args,receiver,threw:false};state.calls.push(call);
      const invoke=event=>{call.execution_id=event?.id??null;return Reflect.apply(target,receiver,args)};
      try{
        const value=executionContext?executionContext.run({kind:'callback_invocation',occurrence:source,callback:source,ordinal:state.callbackCalls++,source:executionSource},invoke):invoke(null);
        call.value=value;call.predicted=value;
        if(typeof value==='function'&&depth===0&&observeReturn){const child=pair(state,value,`${source}:returned`,1);call.predicted=child.shadow;return child.actual;}
        return value;
      }catch(error){call.threw=true;call.value=error;throw error;}
      finally{evidence.push({kind:'host_callback_execution',owner:state.id,registration:sources.size===1?[...sources][0]:null,registration_candidates:[...sources],callback:source,execution_id:call.execution_id??null,
        role:depth?'returned_callback':'registered_callback',callback_value:identify(original),arguments:args.map(identify),result:identify(call.value),outcome:call.threw?'throw':'return'});}
    }});
    return {actual,shadow,sources};
  };
  const referencePair=(state,original,source)=>{
    const known=state.refCache.get(original);if(known)return known;
    const capability={},write=function(value){
      const frame=state.replay,observed=frame?.observed[frame.index++];
      if(!observed||observed.capability!==capability||!Object.is(observed.value,value))throw Error('host_ref_write_mismatch');
      return undefined;
    };
    state.engine.grantCallback(write);
    const shadow=Object.freeze({write}),actual=new Proxy(original,{set(target,key,value){
      if(key!=='current')fail(state,'host_ref_property_unsupported');
      const descriptor=Object.getOwnPropertyDescriptor(target,key);
      if(!descriptor||!('value'in descriptor)||!descriptor.writable)fail(state,'host_ref_descriptor_changed');
      const result=Reflect.set(target,key,value,target);
      state.calls.push({capability,value});
      if(!result)fail(state,'host_ref_write_failed');
      evidence.push({kind:'host_ref_write',owner:state.id,registration:source,property:String(key),
        value:identify(value),reason:'Observed the actual library assignment through its private reference argument; the application retains the original ref object.'});
      return result;
    }});
    const pair={actual,shadow};state.refCache.set(original,pair);return pair;
  };
  return Object.freeze({
    register(owner,args,producer,receiver=undefined){
      const state=get(owner),source=`${state.id}:registration:${++state.registrations}`;
      if(state.pending)fail(state,'registration_during_unfinished_host_event');
      // The independent host declares callback positions and the dependency
      // list. Snapshot its slots without evaluating accessors or proxies.
      // Referenced values retain identity; their internals are never traversed.
      let valid=Array.isArray(args)&&args.length<=arity;
      const functions=[];
      for(const index of callbackArguments){const value=args[index];
        if(nullableCallbackArguments.includes(index)&&(value===null||value===undefined))continue;
        if(objectRefArguments.includes(index)&&value&&typeof value==='object'&&!types.isProxy(value)){
          const descriptor=Object.getOwnPropertyDescriptor(value,'current');
          if(Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(value).length===1&&descriptor&&'value'in descriptor&&descriptor.writable)continue;
        }
        if(typeof value!=='function'||types.isProxy(value)||functions.includes(value)){valid=false;break;}functions.push(value);
      }
      let deps=args[dependencyArgument];
      if(deps!==undefined&&deps!==null){
        valid&&=!types.isProxy(deps)&&Array.isArray(deps)&&deps.length<=64;
        if(valid&&state.dependencyLength!==null&&state.dependencyLength!==deps.length)valid=false;
        if(valid){state.dependencyLength=deps.length;const copy=[];for(let index=0;index<deps.length;index++){
          const descriptor=Object.getOwnPropertyDescriptor(deps,String(index));
          if(!descriptor||!('value'in descriptor)){valid=false;break;}copy.push(descriptor.value);
        }deps=copy;}
      }
      if(!valid){fail(state,'host_event_registration_inputs_unsupported');return Reflect.apply(producer,receiver,args);}
      const actualArgs=[...args],predictedArgs=[...args];predictedArgs[dependencyArgument]=deps;
      for(const index of callbackArguments){
        if(objectRefArguments.includes(index)&&args[index]&&typeof args[index]==='object'){
          const reference=referencePair(state,args[index],source);actualArgs[index]=reference.actual;predictedArgs[index]=reference.shadow;continue;
        }
        if(typeof args[index]!=='function')continue;
        let cache=state.callbackCache.get(args[index]);if(!cache){cache=new Map();state.callbackCache.set(args[index],cache);}
        let callback=stableCallbackArguments.includes(index)?cache.get(index):null;
        if(callback)callback.sources.add(source);
        else {callback=pair(state,args[index],`${source}:argument:${index}`,0,callbackReturnArguments.includes(index),new Set([source]));
          if(stableCallbackArguments.includes(index))cache.set(index,callback);}
        actualArgs[index]=callback.actual;predictedArgs[index]=callback.shadow;
      }
      let value;
      const actual=()=>Reflect.apply(producer,receiver,actualArgs);
      try{value=executionContext?executionContext.run({kind:'library_invocation',occurrence:source,source:executionSource},actual):actual();}
      catch(error){fail(state,'registration_threw');throw error;}
      replay(state,'register',predictedArgs);
      if(value!==undefined)fail(state,'host_registration_result_unsupported');
      return value;
    },
    begin(owner,event){const state=get(owner);if(!['commit','disconnect'].includes(event))throw new TypeError('host_event_kind');
      if(state.pending)fail(state,'overlapping_host_events');state.pending=event;},
    flush(owner){const state=get(owner);if(!state.pending){fail(state,'host_event_missing');return;}
      const event=state.pending;state.pending=null;replay(state,event);},
    checkpoint(){const pending=all.some(state=>state.pending||state.calls.length);return {
      status:failures.length||pending?'frontier':'observed_agreement',observation_mode:'host_events',owners:all.length,
      failures:structuredClone([...failures,...(pending?[{reason:'host_event_observation_incomplete'}]:[])]),evidence:structuredClone(evidence),
    };},
  });
}

export function validateHostEventLayout({callbackArguments=[0],nullableCallbackArguments=[],callbackReturnArguments=[0],stableCallbackArguments=[],objectRefArguments=[],dependencyArgument=1}={}) {
  const indices=value=>Array.isArray(value)&&new Set(value).size===value.length&&value.every(index=>Number.isInteger(index)&&index>=0&&index<16);
  if(!indices(callbackArguments)||!callbackArguments.length||!Number.isInteger(dependencyArgument)||dependencyArgument<0||dependencyArgument>=16||callbackArguments.includes(dependencyArgument)
    ||![nullableCallbackArguments,callbackReturnArguments,stableCallbackArguments,objectRefArguments].every(value=>indices(value)&&value.every(index=>callbackArguments.includes(index))))throw new TypeError('host_event_callback_layout');
  const arity=Math.max(dependencyArgument,...callbackArguments)+1;
  if(callbackArguments.length+1!==arity)throw new TypeError('host_event_unobserved_argument_layout');
  return {arity,callbackArguments,nullableCallbackArguments,callbackReturnArguments,stableCallbackArguments,objectRefArguments,dependencyArgument};
}
