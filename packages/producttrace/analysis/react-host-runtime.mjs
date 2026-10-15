/** Observe the original lookup without rereading application nodeType getters.
 * Renderer-owned snapshots are supplied separately; unknown objects abstain. */
export function createReactHostObserver(config) {
 let active=null;
 const prepare=frame=>{
  frame.record.input=frame.snapshot(frame.args[frame.entry.host_rule.argument]);
  try{frame.inspection=config.inspect?.(frame.args[frame.entry.host_rule.argument],frame.snapshot,frame.entry.host_rule,frame.args);
   if(frame.inspection?.evidence)frame.record.lookup=frame.inspection.evidence;
   else frame.record.frontier='host_input_context_unobserved';
  }catch(_){frame.record.frontier='host_input_context_unobserved';}
 };
 const call=(key,run)=>{
  const entry=config.entry(key);if(!config.enabled()||!entry?.host_rule)return run();
  const previous=active,values=[];
  const snapshot=value=>{let row=values.find(row=>Object.is(row.value,value));if(!row){row={value,id:config.id('host_value')};values.push(row);}
   return {identity:row.id,kind:value===null?'null':typeof value,...config.encode(value)};};
  const action=config.action?.();
  const record={manifest_key:key,observation_id:config.id('host_lookup'),operation:'returned',inputs:{},
   action:action?{action_occurrence_id:action.action_occurrence_id,callback_observation_id:action.callback_observation_id}:null};
  const frame={key,entry,record,args:[],snapshot,context:config.context?.()||'default'};active=frame;
  if(entry.host_argument_count===0)prepare(frame);
  try{const result=run();record.result=snapshot(result);return result;}
  catch(error){record.operation='threw';record.result=snapshot(error);throw error;}
  finally{active=previous;try{
    if(frame.inspection?.complete){try{frame.record.lookup.after=frame.inspection.complete();}catch(_){frame.record.frontier='host_completion_unobserved';}}
    if(frame.inspection?.unchanged&&!frame.inspection.unchanged())record.frontier='host_commit_changed_during_lookup';
    if(config.enabled()&&(config.context?.()||'default')===frame.context)config.observe(record);
   }catch(_){};}
 };
 const argument=(key,index,value)=>{const frame=active;if(frame?.key===key){frame.args[index]=value;frame.record.inputs[index]=frame.snapshot(value);
   if(index===frame.entry.host_argument_count-1)prepare(frame);}return value;};
 return {hostCall:call,hostArgument:argument};
}
