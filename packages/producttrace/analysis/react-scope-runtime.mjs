/** Shared observer, embedded into the browser runtime by scripts/build.mjs.
 * It calls only the original application/library functions; it never executes a
 * prediction. No getter, thenable inspection, or async continuation is needed.
 */
export function createReactScopeObserver(config) {
  let active=null;
  const tagged=new WeakMap();
  const identity=value=>{
    const entry=tagged.get(value);if(!entry)return null;
    const context=config.context?.()||'default';
    if(entry.context!==context){entry.context=context;entry.identity=config.id('callback_identity');entry.observations=new Map();}
    return entry;
  };
  const tagSource=(sourceId,value,readers,inferredName)=>{
    if(typeof value!=='function')return value;
    if(inferredName && !value.name)Object.defineProperty(value,'name',{value:inferredName,configurable:true});
    let entry=tagged.get(value);if(!entry){entry={sources:new Map()};tagged.set(value,entry);}
    entry.sources.set(sourceId,readers);return value;
  };
  // Other observers can resolve the same original function object. Tags name
  // source, never imply that a function was invoked or that its render committed.
  const describeSource=(value,candidates)=>{
    if(typeof value!=='function')return null;
    const tag=identity(value),matches=(candidates||[]).filter(row=>tag?.sources.has(row.source_id));
    if(matches.length!==1)return null;
    const sourceId=matches[0].source_id;let observation=tag.observations.get(sourceId);
    if(!observation) {
      observation=config.id('callback_source');
      try {config.observeOrigin?.({source_id:sourceId,callback_identity_id:tag.identity,observation_id:observation});
        tag.observations.set(sourceId,observation);}catch(_){return null;}
    }
    return {source_id:sourceId,callback_identity_id:tag.identity,source_observation_id:observation};
  };
  const call=(key,run,onCompletion,sourceFrameId)=>{
    const entry=config.entry(key);
    if(!config.enabled() || !(entry?.scope_rule || entry?.predicate_rule || entry?.children_rule))return run();
    const parent=active,values=[];
    const snapshot=value=>{
      let row=values.find(row=>Object.is(row.value,value));
      if(!row){row={value,id:(typeof value==='function'?identity(value)?.identity:null)||config.id('scope_value')};values.push(row);}
      return {identity:row.id,truthy:Boolean(value),kind:value===null?'null':typeof value,...config.encode(value)};
    };
    const scope={scope_id:config.id('scope'),parent_scope_id:parent?.data.scope_id||null,
      ...(sourceFrameId?{source_frame_id:sourceFrameId}:{}),
      action_occurrence_id:config.action?.()||null,inputs:{},callbacks:[],outcome:'pending'};
    const frame={key,entry,data:scope,snapshot,closed:false,parent,active_callback_id:null};active=frame;
    let result;
    try {result=run();scope.outcome='returned';scope.result=snapshot(result);return result;}
    catch(error){result=error;scope.outcome='threw';scope.result=snapshot(error);throw error;}
    finally {
      frame.closed=true;active=parent;
      // Recorder failure must not replace an application result or exception.
      try{if(config.enabled()){
        config.observe(key,result,scope.outcome==='threw'?'threw':'invoked',scope);
        onCompletion?.(scope);
      }}catch(_){}
    }
  };
  const argument=(key,index,value,readers)=>{
    const frame=active;
    if(!frame || frame.key!==key || frame.closed)return value;
    frame.data.inputs[index]=frame.snapshot(value);
    const callbackRule=frame.entry.scope_rule || (['map','forEach'].includes(frame.entry.children_member)?frame.entry.children_rule:null);
    if(!callbackRule || index!==callbackRule.callback_argument || typeof value!=='function')return value;
    let sourceId=frame.entry.scope_callback_source_id||null,sourceObservation=null,captureReaders=readers;
    if(!sourceId) {
      const tag=identity(value),candidates=(frame.entry.scope_callback_candidates||[]).filter(row=>tag?.sources.has(row.source_id));
      if(candidates.length===1) {
        sourceId=candidates[0].source_id;captureReaders=tag.sources.get(sourceId);
        sourceObservation=tag.observations.get(sourceId);
        if(!sourceObservation) {
          sourceObservation=config.id('callback_source');
          try {
            config.observeOrigin?.({source_id:sourceId,callback_identity_id:tag.identity,observation_id:sourceObservation});
            tag.observations.set(sourceId,sourceObservation);
          } catch(_) {sourceObservation=null;}
        }
      }
    }
    return function(){
      if(frame.closed)return value.apply(this,arguments);
      const invocation={invocation_id:config.id('scope_callback'),source_id:sourceId,
        source_observation_id:sourceObservation,callback_identity_id:frame.data.inputs[index].identity,
        ...(frame.entry.children_rule?{receiver:frame.snapshot(this)}:{}),arguments:Array.from(arguments,frame.snapshot),captured_values:config.captures?.(captureReaders)||[],outcome:'pending'};
      frame.data.callbacks.push(invocation);
      const previousCallback=frame.active_callback_id;frame.active_callback_id=invocation.invocation_id;
      try {const result=value.apply(this,arguments);invocation.outcome='returned';invocation.result=frame.snapshot(result);return result;}
      catch(error){invocation.outcome='threw';invocation.result=frame.snapshot(error);throw error;}
      finally {frame.active_callback_id=previousCallback;}
    };
  };
  // Read the original callee once, before its arguments. This records identity
  // without replacing the stable function returned by the renderer.
  const target=(key,value)=>{
    const frame=active;
    if(frame && frame.key===key && !frame.closed && frame.entry.transition_hook_call_id)
      frame.data.transition_target=config.describeTarget?.(value,frame.entry)||null;
    return value;
  };
  // State and other renderer observers use this only while application code is
  // dynamically inside the exact callback. Nested scopes retain every callback
  // occurrence, innermost first, so a later checker can distinguish containment
  // from the scheduling policy that ultimately won.
  const currentScopes=()=>{
    const scopes=[];
    for(let frame=active;frame;frame=frame.parent)if(!frame.closed&&frame.active_callback_id&&frame.entry.scope_rule)scopes.push({
      scope_id:frame.data.scope_id,callback_invocation_id:frame.active_callback_id,
      scheduling:frame.entry.scope_rule.kind==='test_scope'?'test_queue':frame.entry.scope_rule.scheduling,
    });
    return scopes;
  };
  return {scopeCall:call,scopeArgument:argument,scopeTarget:target,tagSource,describeSource,currentScopes};
}
