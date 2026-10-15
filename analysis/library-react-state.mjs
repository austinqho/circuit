import {types} from 'node:util';
import {createLibraryProgram} from './library-program.mjs';

/** React owns its queue, retries and commits. This observer checks a rule at
 * actual calculation boundaries; its shadow capability consumes the recorded
 * call instead of executing an application callback again. The application
 * retains React's original pair and dispatch function.
 */
export function createReactStateBoundary({program,api,occurrencePrefix='react-state',executionContext=null,executionSource=null}) {
  if(!['useState','useReducer'].includes(api))throw new TypeError('state_api');
  const engine=createLibraryProgram(program),owners=new WeakMap(),dispatchers=new WeakMap(),states=[],evidence=[],failures=[];
  let sequence=0,valueSequence=0;
  const values=new WeakMap();
  const identity=value=>{
    const kind=value===null?'null':typeof value;
    if(value===null||!['object','function'].includes(kind))return {kind,value:typeof value==='number'?(Number.isNaN(value)?'NaN':Object.is(value,-0)?'-0':value):value};
    if(!values.has(value))values.set(value,`${occurrencePrefix}:value:${++valueSequence}`);
    return {kind,identity:values.get(value)};
  };
  const fail=(state,reason)=>failures.push({owner:state?.id??null,reason});
  function check(state,operation,args,actual,callback=null) {
    let calls=0;const predictedArgs=args.slice();
    if(callback){
      const shadow=function(...received){
        calls++;
        if(calls!==1||this!==callback.receiver||received.length!==callback.args.length||received.some((value,index)=>!Object.is(value,callback.args[index])))throw Error('state_callback_arguments_mismatch');
        if(callback.threw)throw callback.value;
        return callback.value;
      };
      engine.grantCallback(shadow);predictedArgs[callback.slot]=shadow;
    }
    let predicted,threw=false;
    try{predicted=engine.invoke([operation,predictedArgs]);}catch(error){predicted=error;threw=true;}
    if(callback&&calls!==1)fail(state,'state_callback_count_mismatch');
    if(threw!==Boolean(actual.threw)||!Object.is(predicted,actual.value))fail(state,'state_rule_outcome_mismatch');
  }
  function calculate(state,operation,args,slot,callback,receiver,actualArgs,request=null) {
    const id=`${state.id}:calculation:${++sequence}`,outcome={threw:false};
    const work=()=>Reflect.apply(callback,receiver,actualArgs);
    try{outcome.value=executionContext?executionContext.run({kind:'callback_invocation',occurrence:id,callback:`${state.id}:${operation}`,ordinal:sequence,source:executionSource},work):work();return outcome.value;}
    catch(error){outcome.threw=true;outcome.value=error;throw error;}
    finally{
      check(state,operation,args,outcome,{slot,receiver,args:actualArgs,...outcome});
      const row={id,kind:'state_calculation',owner:state.id,operation,request,render:state.render,
        callback:identity(callback),arguments:actualArgs.map(identity),outcome:outcome.threw?'throw':'return',value:identity(outcome.value)};
      evidence.push(row);if(!outcome.threw)state.products.push({id,value:outcome.value,request});
    }
  }
  return Object.freeze({
    invoke(owner,args,producer,receiver=undefined,{initializerCalls=1}={}){
      let state=owners.get(owner);
      if(!state){state={id:`${occurrencePrefix}:owner:${++sequence}`,mounted:false,render:null,products:[],reducerCache:new WeakMap(),initialized:false};owners.set(owner,state);states.push(state);}
      const render=state.render=`${state.id}:render:${++sequence}`,native=args.slice(),first=!state.initialized;
      if(args.length>(api==='useState'?1:3)||api==='useReducer'&&typeof args[0]!=='function'){
        fail(state,'state_inputs_unsupported');return Reflect.apply(producer,receiver,args);
      }
      let initializationCount=0;
      const initialSlot=api==='useState'?0:2,initializer=args[initialSlot];
      const hasInitializer=api==='useState'?typeof initializer==='function':initializer!==undefined;
      if(hasInitializer&&typeof initializer==='function'&&!types.isProxy(initializer))native[initialSlot]=new Proxy(initializer,{apply(target,receiver,actualArgs){initializationCount++;return calculate(state,'initialize',args,initialSlot,target,receiver,actualArgs)}});
      else if(hasInitializer){fail(state,'state_initializer_unsupported');return Reflect.apply(producer,receiver,args);}
      if(api==='useReducer'){
        const reducer=args[0];if(types.isProxy(reducer)){fail(state,'state_reducer_proxy_unsupported');return Reflect.apply(producer,receiver,args);}
        let wrapped=state.reducerCache.get(reducer);
        if(!wrapped){wrapped=new Proxy(reducer,{apply(target,receiver,actualArgs){
          const token=state.actions?.get(actualArgs[1]),action=token?token.value:actualArgs[1];
          return calculate(state,'update',[actualArgs[0],action,reducer],2,target,receiver,[actualArgs[0],action],token?.id??null);
        }});state.reducerCache.set(reducer,wrapped);}
        native[0]=wrapped;
      }
      let pair;
      try{pair=Reflect.apply(producer,receiver,native);}catch(error){fail(state,'state_hook_threw');throw error;}
      if(!Array.isArray(pair)||pair.length!==2||typeof pair[1]!=='function'){fail(state,'state_pair_invalid');return pair;}
      if(initializationCount!==(first&&hasInitializer?initializerCalls:0))fail(state,'state_initializer_count_mismatch');
      if(first&&!hasInitializer)check(state,'initialize',args,{value:pair[0]});
      if(state.dispatch&&state.dispatch!==pair[1])fail(state,'state_dispatch_identity_changed');
      if(first&&hasInitializer&&!state.products.some(row=>Object.is(row.value,pair[0])))fail(state,'state_initial_value_unmatched');
      state.initialized=true;state.dispatch=pair[1];dispatchers.set(pair[1],state);
      const previous=state.lastValue;
      if(state.hasValue)check(state,'compare',[previous,pair[0]],{value:Object.is(previous,pair[0])});
      state.lastValue=pair[0];state.hasValue=true;
      const candidates=state.products.filter(row=>Object.is(row.value,pair[0])).map(row=>row.id);
      evidence.push({id:render,kind:'state_read',owner:state.id,value:identity(pair[0]),dispatch:identity(pair[1]),value_candidates:candidates,
        reason:'Actual hook result in this render attempt. Equal values identify candidates, not a proven update-to-commit cause.'});
      return pair;
    },
    commit(owner,render){const state=owners.get(owner);if(!state)return;
      state.mounted=true;evidence.push({kind:'state_render_committed',owner:state.id,render});},
    disconnect(owner){const state=owners.get(owner);if(!state)return;state.mounted=false;evidence.push({kind:'state_owner_disconnected',owner:state.id});},
    render(owner){return owners.get(owner)?.render??null;},
    prepareCall(dispatch,source=null){
      const state=dispatchers.get(dispatch);if(!state)return null;
      return function(...args){
        const id=`${state.id}:request:${++sequence}`,action=args[0],native=args.slice();
        evidence.push({id,kind:'state_update_requested',owner:state.id,source,action:identity(action),connected:state.mounted,
          reason:'The original React dispatcher was called. This does not establish a committed update.'});
        if(api==='useReducer'){
          state.actions??=new WeakMap();const envelope={};state.actions.set(envelope,{id,value:action});native[0]=envelope;
        }else if(typeof action==='function'){
          if(types.isProxy(action)){fail(state,'state_updater_proxy_unsupported');return Reflect.apply(dispatch,this,args);}
          native[0]=new Proxy(action,{apply(target,receiver,values){return calculate(state,'update',[values[0],action],1,target,receiver,values,id)}});
        }else {check(state,'update',[state.lastValue,action],{value:action});state.products.push({id,value:action,request:id});}
        const result=Reflect.apply(dispatch,this,native);
        if(result!==undefined)fail(state,'state_dispatch_result_mismatch');
        return result;
      };
    },
    checkpoint(){return {status:failures.length?'frontier':'observed_agreement',owners:states.length,failures:structuredClone(failures),evidence:structuredClone(evidence),
      scope:'Actual state initialization, update calculation, owner reads and host commits. Scheduling priority, skipped/rebased queue membership and causal selection of equal values remain unproven.'};},
  });
}

/** The parallel marker initializer observes React's mount rehearsal separately
 * from the initializer under test. A layout marker records actual commits of
 * this render, including Strict Mode reconnects; a render return is not commit.
 */
export function createReactStateHost(React){
  if(React.version!=='18.3.1')throw new TypeError('state_host_version');
  return Object.freeze({protocol:'react_state_queue',invoke({boundary,producer,args,receiver}){
    const marker=React.useRef(null);if(!marker.current)marker.current={initializerCalls:0};
    React.useState(()=>{marker.current.initializerCalls++;return null});
    const pair=boundary.invoke(marker,args,producer,receiver,marker.current),render=boundary.render(marker);
    React.useLayoutEffect(()=>{boundary.commit(marker,render)});
    React.useLayoutEffect(()=>()=>boundary.disconnect(marker),[]);
    return pair;
  }});
}
