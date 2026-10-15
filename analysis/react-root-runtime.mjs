/** Observe original root handles and method calls without replacing methods on
 * the root. The temporary call wrapper preserves receiver and argument order. */
export function createReactRootObserver(config) {
 let active=null,context=null,identities=new WeakMap(),roots=new WeakMap(),pending=new WeakMap(),recoverySources=new WeakMap();
 const snapshot=value=>{
  const reference=value!==null&&['object','function'].includes(typeof value);let id=reference?identities.get(value):null;
  if(!id){id=config.id('root_value');if(reference)identities.set(value,id);}
  return {identity:id,kind:value===null?'null':typeof value,...config.encode(value)};
 };
 const data=(object,name)=>{const property=Object.getOwnPropertyDescriptor(object,name);if(!property||!Object.hasOwn(property,'value'))throw Error('root data property unavailable');return property.value;};
 const inspect=object=>{
  try{const internal=data(object,'_internalRoot');
   if(internal===null)return {state:'unmounted'};
   const container=data(internal,'containerInfo');
   return {state:'active',internal:snapshot(internal),container:snapshot(container),renderer_root_id:config.rootId?.(internal)||null};
  }catch(_){return {state:'unobserved'};}
 };
 const call=(key,run)=>{
  const entry=config.entry(key);if(!config.enabled()||!entry?.root_rule)return run();
  const nextContext=config.context?.()||'default';if(nextContext!==context){context=nextContext;identities=new WeakMap();roots=new WeakMap();pending=new WeakMap();recoverySources=new WeakMap();}
  const previous=active,record={manifest_key:key,observation_id:config.id('root_operation'),method:entry.root_method||'create',inputs:{},operation:'returned'};
  const frame={key,entry,record,context,executing:false,args:[]};active=frame;
  try{const result=run();record.result=snapshot(result);
   if(record.method==='create'){
    record.after=inspect(result);record.methods={};
    try{const prototype=Object.getPrototypeOf(result);
     for(const name of ['render','unmount'])record.methods[name]=snapshot(data(prototype,name));
     roots.set(result,true);
     const options=frame.args[entry.root_rule.options_argument];
     try{const descriptor=options&&Object.getOwnPropertyDescriptor(options,entry.root_rule.recoverable_error_option),callback=descriptor?.value,source=recoverySources.get(callback);
      if(source&&source.key===key&&source.sourceId===entry.root_recovery_source_id){
       const registration={context,entry,record,root:result,internal:data(result,'_internalRoot')};source.registrations.push(registration);
       record.recovery_callback={source_id:source.sourceId,value:snapshot(callback)};
      }
     }catch(_){record.recovery_frontier='root_recovery_option_unobserved';}
     if(entry.root_rule.mode==='hydrate'&&entry.root_rule.children_argument!==null){
      const internal=data(result,'_internalRoot');pending.set(internal,[{entry,record,element:frame.args[entry.root_rule.children_argument],
       input:record.inputs[entry.root_rule.children_argument],context}]);
     }
    }catch(_){record.frontier='root_method_descriptors_unobserved';}
   }
   return result;
  }catch(error){record.operation='threw';record.result=snapshot(error);throw error;}
  finally{
   if(frame.receiver&&roots.has(frame.receiver)){
    record.after=inspect(frame.receiver);
    if(record.method==='render'&&record.operation==='returned'&&frame.internal){
     const rows=pending.get(frame.internal)||[];
     if(rows.length<64)rows.push({entry,record,element:frame.args[entry.root_rule.render_argument],input:record.inputs[entry.root_rule.render_argument],context});
     else rows.overflow=true;
     pending.set(frame.internal,rows);
    }
   }
   active=previous;try{if(config.enabled()&&(config.context?.()||'default')===frame.context)config.observe(record);}catch(_){}
  }
 };
 const argument=(key,index,value)=>{if(active?.key===key){active.args[index]=value;active.record.inputs[index]=snapshot(value);}return value;};
 const method=(key,receiver,name)=>{
  const frame=active;
  // Read the original method exactly once, before evaluating its arguments.
  const original=receiver[name];
  if(frame?.key===key){frame.receiver=receiver;frame.record.receiver=snapshot(receiver);frame.record.method_value=snapshot(original);
   frame.record.before=roots.has(receiver)?inspect(receiver):{state:'unobserved'};
   if(roots.has(receiver))try{frame.internal=data(receiver,'_internalRoot');}catch(_){}}
 return function(){
   if(frame?.key!==key)return Reflect.apply(original,receiver,arguments);
   frame.executing=true;try{return Reflect.apply(original,receiver,arguments);}finally{frame.executing=false;}
  };
 };
 const recovery=(key,sourceId,callback)=>{
  if(typeof callback!=='function')return callback;
  const source={key,sourceId,original:callback,registrations:[]};
  const wrapped=new Proxy(callback,{apply(target,thisArg,args){
   if(!config.enabled())return Reflect.apply(target,thisArg,args);
   const current=config.context?.()||'default',matches=source.registrations.filter(row=>row.context===current&&inspect(row.root).state==='active');
   const registration=matches.length===1?matches[0]:null,record={schema:'producttrace.react-root-recovery.v1',kind:'react_root_recovery',runtime_observed:true,
    observation_id:config.id('root_recovery'),manifest_key:registration?.entry.key||key,source_call_id:registration?.entry.source_call_id||null,
    semantic_id:registration?.entry.semantic_id||null,origin_observation_id:registration?.record.observation_id||null,
    callback_source_id:sourceId,callback_identity:snapshot(wrapped),arguments:Array.from(args,snapshot),receiver:snapshot(thisArg),operation:'returned',
    renderer_root_id:registration?config.rootId?.(registration.internal)||null:null,frontier:registration?null:matches.length>1?'root_recovery_origin_ambiguous':'root_recovery_origin_unobserved'};
   try{const result=Reflect.apply(target,thisArg,args);record.result=snapshot(result);return result;}
   catch(error){record.operation='threw';record.result=snapshot(error);throw error;}
   finally{try{config.observeRecovery?.(record);}catch(_){}}
  }});
  recoverySources.set(wrapped,source);return wrapped;
 };
 const committed=(root,commitId)=>{
  // This observes a commit inside the original method. A root.render return,
  // a later commit, or work done while evaluating arguments supplies no link.
  if(!config.enabled())return;
  const current=data(root,'current'),currentElement=data(data(current,'memoizedState'),'element'),rootId=config.rootId?.(root)||null;
  if(active?.executing&&active.internal===root&&(config.context?.()||'default')===active.context)
   (active.record.commits||(active.record.commits=[])).push({commit_id:commitId,renderer_root_id:rootId,empty_tree:data(current,'child')===null});
  const rows=pending.get(root);if(!rows)return;
  const matches=rows.filter(row=>row.context===(config.context?.()||'default')&&row.element===currentElement);
  for(const row of matches)config.observeCommit?.({schema:'producttrace.react-root-commit.v1',kind:'react_root_commit',runtime_observed:true,
   operation:'committed',observation_id:config.id('root_commit'),origin_observation_id:row.record.observation_id,
   manifest_key:row.entry.key,source_call_id:row.entry.source_call_id,semantic_id:row.entry.semantic_id,
   input_identity:row.input?.identity||null,renderer_root_id:rootId,commit_id:commitId,empty_tree:data(current,'child')===null,
   frontier:rows.overflow||matches.length!==1?'root_commit_origin_ambiguous':null});
  pending.delete(root);
 };
 const cleanup=(observationId,owner,sourceCallId)=>{
  // The lifecycle reader independently checks this cleanup against its setup.
  // Here we only retain its nesting inside this exact root operation.
  if(!config.enabled()||!active?.executing||!active.internal||(config.context?.()||'default')!==active.context
    ||config.rootId?.(active.internal)!==owner.root_id)return null;
  (active.record.cleanups||(active.record.cleanups=[])).push({observation_id:observationId,root_id:owner.root_id,instance_id:owner.instance_id,mount_id:owner.mount_id,source_call_id:sourceCallId});
  return active.record.observation_id;
 };
 return {rootCall:call,rootArgument:argument,rootMethod:method,rootRecovery:recovery,rootCommitted:committed,rootCleanup:cleanup};
}
