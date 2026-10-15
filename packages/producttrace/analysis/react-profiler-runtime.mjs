import {validateReactExecutionRule} from './react-execution-rule.mjs';

/** The six public onRender arguments come from committed renderer fields.
 * commitTime and nested-update are renderer observations, not clocks or update
 * causes reconstructed from browser timing. Ordinary production has no profile
 * state and therefore does not satisfy this program's invocation guard. */
export function interpretReactProfilerCommit(rule,snapshot){
  const p=rule?.profiler;
  if(!p||!snapshot||snapshot.tag!==rule.renderer.tag||snapshot.fresh!==true
    ||snapshot.profile_state!==true||typeof snapshot.mounted!=='boolean'||typeof snapshot.nested!=='boolean'
    ||!Number.isSafeInteger(snapshot.mode)||!Number.isSafeInteger(snapshot.flags)
    ||!(snapshot.mode&p.profile_mask)||!(snapshot.flags&p.update_mask))return null;
  const phase=snapshot.nested?p.nested_phase:snapshot.mounted?p.update_phase:p.mount_phase;
  const values={...snapshot,phase:{encoding:'primitive',value:phase}};
  return {callback:p.callback,phase:p.phase,arguments:p.arguments.map(key=>values[key]),result:p.result};
}

/** Observe original callback bodies, then match a unique invocation to React's
 * mandatory callback at a fresh Profiler commit. More than one call makes the
 * function identity ambiguous; it stays tainted until a new recording context.
 * This deliberately abstains when application code also invokes onRender. */
export function createReactProfilerObserver(config){
  let context=null,functions=new WeakMap(),inputs=new WeakMap();
  // A failed recorder sink cannot replace the application's result or error.
  // Missing receipts will make the downstream join abstain.
  const emit=record=>{try{config.observe(record);}catch{}};
  const own=(object,key)=>{const d=object&&Object.getOwnPropertyDescriptor(object,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
  const refresh=()=>{const next=config.context();if(next!==context){context=next;functions=new WeakMap();inputs=new WeakMap();}};
  return {
    define(entry,factory,name){
      let fn;
      fn=factory((args,body)=>{
        if(!config.enabled())return body();refresh();
        let state=functions.get(fn);if(!state){state={entry,calls:[],tainted:false};functions.set(fn,state);}
        const call={id:config.id('profiler_callback'),args:Array.from(args),outcome:'running'};
        if(state.calls.length>=2)state.tainted=true;else state.calls.push(call);
        emit({operation:'callback_started',observation_id:call.id,manifest_key:entry.key,
          callback_identity:config.identity(fn),callback_source_id:entry.callback_source_id,
          arguments:call.args.map(config.value)});
        try {const result=body();call.outcome='returned';return result;}
        catch(error){call.outcome='threw';throw error;}
        finally {emit({operation:'callback_finished',observation_id:config.id('profiler_callback_end'),
          invocation_id:call.id,manifest_key:entry.key,callback_identity:config.identity(fn),
          callback_source_id:entry.callback_source_id,outcome:call.outcome});}
      });
      if(name&&!fn.name)Object.defineProperty(fn,'name',{value:name,configurable:true});
      return fn;
    },
    created(entry,element,origin){
      if(!config.enabled()||!entry.boundary_rule?.profiler)return;refresh();
      const props=own(element,'props'),fn=own(props,entry.boundary_rule.profiler.callback);
      if(!props||typeof fn!=='function')return;
      const rows=inputs.get(props)||[];if(rows.length<64)rows.push({entry,fn,origin});else rows.overflow=true;inputs.set(props,rows);
    },
    commit(root,renderer){
      if(!config.enabled())return;refresh();
      if(renderer?.rendererPackageName!=='react-dom'||![0,1].includes(renderer.bundleType)
        ||!['18.3.1','18.3.1-next-f1338f8080-20240426'].includes(renderer.version))return;
      // An old fiber can retain Update flags. Require its absence from the
      // preceding tree; flags on a reused bailout are not a fresh invocation.
      const collect=start=>{const seen=new Set(),todo=start?[start]:[];while(todo.length&&seen.size<20000){const f=todo.pop();if(seen.has(f))continue;seen.add(f);if(f.child)todo.push(f.child);if(f.sibling)todo.push(f.sibling);}return todo.length?null:seen;};
      const current=root?.current,previous=collect(current?.alternate),tree=collect(current);
      if(!current?.alternate||!previous||!tree)return;
      for(const fiber of tree){
        const rows=inputs.get(own(fiber,'memoizedProps'));if(!rows?.length)continue;
        const item=rows[0],state=functions.get(item.fn),calls=state?.calls||[];
        if(!state)continue;
        if(rows.length!==1||calls.length>1)state.tainted=true;
        const call=calls.length===1?calls[0]:null,props=own(fiber,'memoizedProps');
        const snapshot={tag:fiber.tag,mode:fiber.mode,flags:fiber.flags,fresh:!previous.has(fiber),
          profile_state:typeof own(fiber.stateNode,'effectDuration')==='number',mounted:fiber.alternate!==null,
          nested:call?.args[1]==='nested-update',id:config.value(own(props,'id')),
          actualDuration:config.value(fiber.actualDuration),treeBaseDuration:config.value(fiber.treeBaseDuration),
          actualStartTime:config.value(fiber.actualStartTime),commitTime:call?config.value(call.args[5]):null};
        const program=config.interpret(item.entry.boundary_rule,snapshot);
        if(!program)continue;
        const identity=config.fiberIdentity(fiber),boundary=config.boundary(fiber);
        const matches=call&&call.outcome==='returned'&&state.entry.source_call_id===item.entry.source_call_id
          &&JSON.stringify(call.args.map(config.value))===JSON.stringify(program.arguments);
        const frontier=state.tainted?'profiler_callback_ambiguous':!call?'profiler_callback_body_unobserved'
          :!matches?'profiler_callback_program_disagrees':!identity||!boundary?'profiler_committed_boundary_required':null;
        emit({operation:'committed_callback',observation_id:config.id('profiler_commit'),
          manifest_key:item.entry.key,callback_manifest_key:state.entry.key,callback_source_id:state.entry.callback_source_id,
          callback_identity:config.identity(item.fn),invocation_id:call?.id||null,
          origin_observation_id:item.origin,boundary_observation_id:boundary?.observation_id||null,
          renderer:identity,renderer_build:{package:renderer.rendererPackageName,version:renderer.version,bundle_type:renderer.bundleType},snapshot,program,frontier});
        // A reused function must produce a new body receipt at its next commit.
        state.calls=[];
      }
    },
  };
}

export function checkReactProfilerRecord(record,{fingerprint,entry,callbackEntry,start,end,boundary}){
  const fail=reason=>({status:'unresolved',reason,runtime_observed:false});
  if(!record||record.schema!=='producttrace.react-profiler.v1'||record.kind!=='react_profiler'
    ||record.runtime_observed!==true||record.map_fingerprint!==fingerprint||!record.session)return fail('profiler_context_required');
  const scoped=id=>typeof id==='string'&&id.startsWith(record.session+':')&&id.length>record.session.length+1;
  if(!scoped(record.observation_id)||!scoped(record.callback_identity)||record.occurrence_id!==record.observation_id+':occurrence'
    ||!record.evidence_ids?.includes(record.observation_id)||!record.evidence_ids.every(scoped)||entry?.key!==record.manifest_key)return fail('profiler_occurrence_required');
  if(record.operation==='callback_started'){
    if(entry.kind!=='profiler_callback'||entry.callback_source_id!==record.callback_source_id||!Array.isArray(record.arguments))return fail('profiler_callback_source_required');
  }else if(record.operation==='callback_finished'){
    if(start?.operation!=='callback_started'||start.session!==record.session||start.observation_id!==record.invocation_id
      ||start.manifest_key!==record.manifest_key||start.callback_identity!==record.callback_identity||start.callback_source_id!==record.callback_source_id
      ||!['returned','threw'].includes(record.outcome))return fail('profiler_callback_start_required');
  }else if(record.operation==='committed_callback'){
    if(record.frontier)return fail(record.frontier);
    if(!validateReactExecutionRule(entry.boundary_rule).valid||!entry.boundary_rule.profiler||entry.semantic_id!=='react/Profiler/18.3.1'
      ||callbackEntry?.kind!=='profiler_callback'||callbackEntry.key!==record.callback_manifest_key
      ||callbackEntry.source_call_id!==entry.source_call_id||callbackEntry.callback_source_id!==record.callback_source_id)return fail('profiler_rule_required');
    if(!start||start.session!==record.session||start.observation_id!==record.invocation_id||start.manifest_key!==record.callback_manifest_key
      ||start.callback_identity!==record.callback_identity||start.callback_source_id!==record.callback_source_id
      ||end?.invocation_id!==record.invocation_id||end.session!==record.session||end.outcome!=='returned')return fail('profiler_completed_callback_required');
    if(boundary?.status!=='resolved'||boundary.runtime.session!==record.session||boundary.source.source_call_id!==entry.source_call_id
      ||boundary.runtime.origin_observation_id!==record.origin_observation_id
      ||!['root_id','instance_id','mount_id','commit_id'].every(key=>record.renderer?.[key]===boundary.runtime.renderer[key]))return fail('profiler_boundary_required');
    if(record.renderer_build?.package!=='react-dom'||![0,1].includes(record.renderer_build.bundle_type)
      ||!['18.3.1','18.3.1-next-f1338f8080-20240426'].includes(record.renderer_build.version)
      ||record.snapshot?.tag!==boundary.runtime.renderer.tag||record.snapshot?.mode!==boundary.runtime.renderer.mode)return fail('profiler_renderer_required');
    const expected=interpretReactProfilerCommit(entry.boundary_rule,record.snapshot);
    if(!expected||JSON.stringify(expected)!==JSON.stringify(record.program)||JSON.stringify(expected.arguments)!==JSON.stringify(start.arguments))return fail('profiler_program_disagrees');
  }else return fail('profiler_operation_required');
  return {status:'resolved',reason:null,runtime_observed:true,source:{source_call_id:entry.source_call_id,callback_source_id:record.callback_source_id},
    runtime:{claim:record.operation==='committed_callback'?'unique_observed_callback_matches_profiler_commit':'observed_profiler_callback_body',
      operation:record.operation,session:record.session,invocation_id:record.invocation_id||record.observation_id,
      arguments:record.arguments||record.program?.arguments||null,renderer:record.renderer||null,
      phase:record.program?.phase||null,downstream_effects_proven:false}};
}
