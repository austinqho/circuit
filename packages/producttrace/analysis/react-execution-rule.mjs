export {planReactClassUpdate} from './react-class-update-plan.mjs';
export {planReactClassOperation} from './react-class-plan.mjs';
export {planReactLegacyRender} from './react-legacy-render-plan.mjs';
export {planReactLegacyUnmount} from './react-legacy-unmount-plan.mjs';
export {planReactHostLookup} from './react-host-plan.mjs';
export {planReactServerString,planReactLegacyServerStream,planReactReadableStream,planReactPipeableStream} from './react-server-plan.mjs';
export {planElementConstruction,planElementClone,planElementFactory} from './react-element-plan.mjs';
export {planReactLazyStep} from './react-lazy-plan.mjs';
export {planReactRootOperation} from './react-root-plan.mjs';
import {validateReactExecutionRule} from './react-execution-validate.mjs';
export {validateReactExecutionRule};

/** Describe one external-store boundary. Snapshot calls can also happen during
 * consistency checks; this is not a prediction of their total count or commits. */
export function planExternalStore(rule,{args=[],event='render',environment='client',previous=null,
  strictDevelopment=false,observation=null}={}) {
  if(!validateReactExecutionRule(rule).valid || rule.kind!=='external_store')return {status:'unresolved',reason:'external_store_rule_required'};
  if(!Array.isArray(args) || !['render','commit','notify','unmount'].includes(event)
      || !['client','server','hydrate'].includes(environment))return {status:'unresolved',reason:'external_store_inputs_required'};
  const result=operations=>({status:'planned',operations,runtime_observed:false});
  const subscribe=args[rule.subscribe_argument],getSnapshot=args[rule.snapshot_argument];
  if(event==='render') {
    const getter=environment==='client'?getSnapshot:args[rule.server_snapshot_argument];
    return typeof getter==='function'?result([{operation:'read_snapshot',callback:getter,arguments:[]}])
      :{status:'unresolved',reason:environment==='client'?'snapshot_callback_required':'server_snapshot_callback_required'};
  }
  if(environment==='server')return result([]);
  if(previous && (typeof previous.subscribe!=='function' || typeof previous.hasCleanup!=='boolean'))return {status:'unresolved',reason:'previous_subscription_required'};
  const cleanup=previous?.hasCleanup?[{operation:'cleanup'}]:[];
  if(event==='unmount')return result(cleanup);
  if(event==='commit') {
    if(typeof subscribe!=='function')return {status:'unresolved',reason:'subscribe_callback_required'};
    if(previous && rule.resubscribe==='subscribe_identity' && Object.is(previous.subscribe,subscribe))return result([]);
    const setup={operation:'subscribe',callback:subscribe,phase:rule.subscription_phase,listener_arguments:1};
    // Strict rehearsal cleanup is conditional on the real subscription result.
    return result([...cleanup,setup,...(!previous && strictDevelopment && rule.strict_mount_rehearsal
      ?[{operation:'cleanup_if_returned'},setup]:[])]);
  }
  if(typeof getSnapshot!=='function')return {status:'unresolved',reason:'snapshot_callback_required'};
  const plan=result([{operation:'read_snapshot',callback:getSnapshot,arguments:[]}]);
  if(observation) {
    if(!['returned','threw'].includes(observation.outcome) || !Object.hasOwn(observation,'previousValue')
      || observation.outcome==='returned' && !Object.hasOwn(observation,'value'))return {status:'unresolved',reason:'snapshot_observation_required'};
    plan.request_update=observation.outcome==='threw'?rule.snapshot_throw==='request_update'
      :!(rule.comparison==='Object.is'?Object.is(observation.previousValue,observation.value):observation.previousValue===observation.value);
    plan.commit_proven=false;
  }
  return plan;
}

/** Providers are evidence supplied in nearest-first order, not objects whose
 * getters the predictor may inspect. Unknown ancestry cannot justify a default. */
export function planContextBinding(rule,{args=[],member=null,requestedContext,providers=[],chainComplete=false,
  defaultValue,defaultKnown=false}={}) {
  const validation=validateReactExecutionRule(rule);
  if(!validation.valid || rule.kind!=='context_binding')return {status:'unresolved',reason:validation.reason||'context_rule_required'};
  if(rule.mode==='create' && member!=='Consumer')return Array.isArray(args)?{status:'planned',operation:'allocate_context',
    default_value:args[rule.default_argument],runtime_observed:false}:{status:'unresolved',reason:'context_arguments_required'};
  if(requestedContext==null || !Array.isArray(providers))return {status:'unresolved',reason:'context_identity_required'};
  if(rule.selection==='farthest' && !chainComplete)return {status:'unresolved',reason:'context_ancestry_incomplete'};
  const matching=providers.filter(provider=>provider.context===requestedContext);
  const selected=rule.selection==='nearest'?matching[0]:matching.at(-1);
  if(!selected && !chainComplete)return {status:'unresolved',reason:'context_ancestry_incomplete'};
  const usesDefault=!selected || selected.value===undefined && rule.undefined_provider==='default';
  return {status:'planned',operation:usesDefault?'read_default':'read_provider',provider:selected||null,
    value_known:usesDefault?defaultKnown:true,...(!usesDefault || defaultKnown?{value:usesDefault?defaultValue:selected.value}:{}),runtime_observed:false};
}

export function contextValueChanged(rule,previous,next) {
  if(!validateReactExecutionRule(rule).valid || rule.kind!=='context_binding')return null;
  return !(rule.change_comparison==='Object.is'?Object.is(previous,next):previous===next);
}

/** Plan successful client commits without invoking a factory, ref callback, or
 * setter. Exceptions and interrupted commits need their own runtime evidence. */
export function planImperativeHandle(rule,{args=[],previous=null,event='commit',environment='client',strictDevelopment=false}={}) {
  if(!validateReactExecutionRule(rule).valid || rule.kind!=='imperative_handle')return {status:'unresolved',reason:'imperative_handle_rule_required'};
  if(!['client','server'].includes(environment) || !['commit','unmount'].includes(event))return {status:'unresolved',reason:'imperative_handle_phase_required'};
  const result=operations=>({status:'planned',phase:rule.phase,operations,runtime_observed:false});
  if(environment==='server')return result([]);
  if(!Array.isArray(args))return {status:'unresolved',reason:'imperative_handle_inputs_required'};
  const ref=args[rule.ref_argument],factory=args[rule.factory_argument],deps=args[rule.dependencies_argument];
  const validRef=value=>value==null || typeof value==='object' || typeof value==='function';
  if(!validRef(ref) || previous && (!validRef(previous.ref) || typeof previous.attached!=='boolean'
      || previous.attached && previous.ref==null || previous.dependencies!=null && !Array.isArray(previous.dependencies))
      || deps!=null && !Array.isArray(deps))return {status:'unresolved',reason:'imperative_handle_inputs_required'};
  const write=(target,value)=>typeof target==='function'?{operation:'callback_ref',target,value}
    :{operation:'write_ref',target,property:rule.object_property,value};
  const cleanup=state=>state?.attached?[write(state.ref,rule.cleanup_value==='null'?null:undefined)]:[];
  if(event==='unmount')return result(cleanup(previous));
  if(previous && Array.isArray(previous.dependencies) && Array.isArray(deps) && previous.dependencies.length!==deps.length)
    return {status:'unresolved',reason:'dependency_arity_changed'};
  const equal=rule.comparison==='Object.is'?Object.is:(left,right)=>left===right;
  const retain=previous && Array.isArray(previous.dependencies) && Array.isArray(deps)
    && deps.every((value,index)=>equal(value,previous.dependencies[index]))
    && (!rule.include_ref_dependency || equal(ref,previous.ref));
  if(retain)return result([]);
  const operations=cleanup(previous);
  if(ref==null && rule.skip_null_ref)return result(operations);
  if(typeof factory!=='function')return {status:'unresolved',reason:'imperative_handle_factory_required'};
  const setup=[{operation:'invoke_factory',callback:factory,arguments:[]}];
  if(ref!=null)setup.push(write(ref,{kind:'factory_result'}));
  operations.push(...setup);
  if(!previous && strictDevelopment && rule.strict_mount_rehearsal)
    operations.push(...cleanup({ref,attached:ref!=null}),...setup);
  return result(operations);
}

/** Retain the cell, not a cached value of its mutable current property. */
export function planRefCell(rule,{args,previous=null,owner=null,build='development',cacheAvailable=true}={}) {
  const validation=validateReactExecutionRule(rule);
  if(!validation.valid || rule.kind!=='ref_cell' || !Array.isArray(args))return {status:'unresolved',reason:validation.reason||'ref_inputs_required'};
  if(!['development','production'].includes(build))return {status:'unresolved',reason:'ref_build_required'};
  if(rule.allocation==='mounted_hook' && (typeof owner!=='string' || !owner))return {status:'unresolved',reason:'ref_hook_owner_required'};
  if(rule.allocation==='mounted_hook' && previous && previous.owner!==owner)return {status:'unresolved',reason:'ref_hook_owner_mismatch'};
  if(rule.allocation==='mounted_hook' && cacheAvailable && previous) {
    if(!previous.reference || typeof previous.reference!=='object')return {status:'unresolved',reason:'previous_ref_required'};
    return {status:'planned',operation:'retain',reference:previous.reference,runtime_observed:false};
  }
  return {status:'planned',operation:'allocate',property:rule.property,initial_value:rule.initial==='null'?null:args[rule.argument],
    sealed:rule.sealed[build],writable:true,enumerable:true,runtime_observed:false};
}

/** Describe the read before interpreting its outcome. This never reads an
 * application property: accessors and proxies must run only in the real call. */
export function planElementPredicate(rule,{args,propertyRead}={}) {
  const validation=validateReactExecutionRule(rule);
  if(!validation.valid || rule.kind!=='element_predicate' || !Array.isArray(args))return {status:'unresolved',reason:validation.reason||'predicate_inputs_required'};
  const input=args[rule.argument];
  if(typeof input!==rule.input_kind || rule.exclude_null && input===null)return {status:'predicted',outcome:'returned',value:false,runtime_observed:false};
  if(!propertyRead)return {status:'planned',operation:'get',target:input,property:rule.marker_property,may_invoke_user_code:true,runtime_observed:false};
  if(!['returned','threw'].includes(propertyRead.outcome))return {status:'unresolved',reason:'property_read_outcome_required'};
  if(propertyRead.outcome==='threw')return {status:'predicted',outcome:'threw',value:propertyRead.value,runtime_observed:false};
  return {status:'predicted',outcome:'returned',value:propertyRead.value===Symbol.for(rule.marker_symbol),runtime_observed:false};
}

/** Returns a conditional prediction, never a runtime observation. */
export function predictRetainedCallback(rule, {args, previous = null, cacheAvailable = true}) {
  const validation = validateReactExecutionRule(rule);
  if (!validation.valid || rule.kind!=='retained_callback') return {status:'unresolved', reason:validation.reason||'wrong_rule_kind'};
  if (!Array.isArray(args) || typeof args[rule.callback_argument] !== 'function') {
    return {status:'unresolved', reason:'callback_input_unresolved'};
  }
  if (previous && typeof previous.callback !== 'function') return {status:'unresolved', reason:'previous_callback_identity_required'};
  const callback = args[rule.callback_argument];
  const dependencies = args[rule.dependencies_argument];
  if (dependencies != null && !Array.isArray(dependencies)) return {status:'unresolved', reason:'invalid_dependencies'};
  // React warns about a variable-length tuple. Never interpret its prefix
  // comparison as a valid program-level retention guarantee.
  if (previous && Array.isArray(previous.dependencies) && Array.isArray(dependencies)
      && previous.dependencies.length !== dependencies.length) return {status:'unresolved', reason:'dependency_arity_changed'};
  const retain = Boolean(cacheAvailable && previous && Array.isArray(previous.dependencies) && Array.isArray(dependencies)
    && dependencies.every((value,index) => Object.is(value, previous.dependencies[index])));
  return {status:'predicted', operation:retain ? 'retain' : 'store',
    callback:retain ? previous.callback : callback,
    dependencies:dependencies == null ? null : dependencies.slice(), runtime_observed:false};
}


/** Effect obligations are plans; only recorded setup/cleanup calls prove effects. */
export function planEffectExecution(rule,{event,previous=null,next=null,environment='client',strictDevelopment=false,
  dependencyComparison='invalidate'}) {
  const result=(operations,frontier=null)=>({claim:'conditional_plan',runtime_observed:false,operations,frontier});
  const validation=validateReactExecutionRule(rule);
  if(!validation.valid || rule.kind!=='commit_effect')return result([],validation.reason||'wrong_rule_kind');
  if(!['client','server'].includes(environment))return result([],'execution_environment_unproven');
  if(environment==='server' || event==='render' || event==='abandon')return result([]);
  const identityKeys=['rootId','instanceId','mountId','slotId','renderId'];
  if([previous,next].filter(Boolean).some(snapshot=>identityKeys.some(key=>typeof snapshot[key]!=='string' || !snapshot[key])))
    return result([],'mounted_hook_identity_required');
  if(previous && next && identityKeys.slice(0,-1).some(key=>previous[key]!==next[key]))
    return result([],'different_hook_lifetimes_require_separate_plans');
  if(previous && previous.committed!==true)return result([],'previous_effect_commit_unproven');
  if(previous && !(typeof previous.cleanupId==='string' || previous.cleanupStatus==='none'))return result([],'previous_cleanup_result_unproven');
  const cleanup=previous?.cleanupId?[{kind:'cleanup',callbackId:previous.cleanupId,renderId:previous.renderId}]:[];
  if(event==='unmount')return result(cleanup);
  if(event!=='commit')return result([],'lifecycle_event_unsupported');
  if(!next || next.committed!==true || typeof next.callbackId!=='string')return result([],'next_effect_commit_or_callback_unproven');
  if(dependencyComparison==='equal')return result([]);
  if(!['invalidate','unknown'].includes(dependencyComparison))return result([],'dependency_comparison_invalid');
  const setup={kind:'setup',callbackId:next.callbackId,renderId:next.renderId};
  const operations=[...cleanup,setup];
  if(!previous && strictDevelopment && rule.strict_mount_rehearsal)operations.push({kind:'cleanup_returned_by',
    setupCallbackId:next.callbackId,renderId:next.renderId,condition:'setup returned a cleanup function'},{...setup});
  return result(operations.map(operation=>({...operation,condition:dependencyComparison==='unknown'
    ?'dependencies changed':operation.condition||'lifecycle event'})),dependencyComparison==='unknown'?'dependency_identity_unproven':null);
}


/** Decide whether to calculate; the interpreter never executes application code. */
export function predictMemoValue(rule,{args,previous=null,cacheAvailable=true}) {
  const check=validateReactExecutionRule(rule);
  if(!check.valid || rule.kind!=='memo_value')return {status:'unresolved',reason:check.reason||'wrong_rule_kind'};
  if(previous && !Object.hasOwn(previous,'value'))return {status:'unresolved',reason:'previous_value_required'};
  const choice=predictRetainedCallback({...rule,kind:'retained_callback',result:'callback_identity'},
    {args,previous,cacheAvailable});
  if(choice.status!=='predicted')return choice;
  return {status:'predicted',operation:choice.operation==='retain'?'retain':'calculate',
    callback:choice.callback,dependencies:choice.dependencies,
    ...(choice.operation==='retain'?{value:previous.value}:{}),runtime_observed:false};
}


/** The attested export's expected value, not an observation of the current module. */
export function predictLiteralExport(rule,{build}={}) {
  const check=validateReactExecutionRule(rule);
  if(!check.valid || rule.kind!=='literal_export')return {status:'unresolved',reason:check.reason||'wrong_rule_kind'};
  if(!['development','production'].includes(build) && rule.values.development!==rule.values.production) {
    return {status:'unresolved',reason:'literal_export_build_required'};
  }
  return {status:'predicted',value:rule.values[build==='production'?'production':'development'],callbacks:[],schedules:[],runtime_observed:false};
}


/** Describe which application callback React may call; never call it here. */
export function planStateInitialization(rule,{args}) {
  const check=validateReactExecutionRule(rule);
  if(!check.valid || rule.kind!=='state_queue' || !Array.isArray(args))return {status:'unresolved',reason:check.reason||'state_inputs_required'};
  const initial=args[rule.initial_argument],initializer=args[rule.initializer_argument];
  const invoke=rule.initializer_mode==='if_function'?typeof initializer==='function':initializer!==undefined;
  if(invoke && typeof initializer!=='function')return {status:'unresolved',reason:'initializer_not_callable'};
  return invoke?{status:'planned',operation:'invoke',callback:initializer,
    arguments:rule.initializer_mode==='if_function'?[]:[initial],runtime_observed:false}
    :{status:'planned',operation:'value',value:initial,runtime_observed:false};
}
export function planStateUpdate(rule,{state,action,reducer}) {
  const check=validateReactExecutionRule(rule);
  if(!check.valid || rule.kind!=='state_queue')return {status:'unresolved',reason:check.reason||'wrong_rule_kind'};
  const queue={queue_order:rule.queue_order,priority:rule.priority,commit:rule.commit,
    calculation_error:rule.calculation_error,unmounted_dispatch:rule.unmounted_dispatch};
  if(rule.update_mode==='reducer')return typeof reducer==='function'
    ?{status:'planned',operation:'invoke',callback:reducer,arguments:[state,action],...queue,runtime_observed:false}
    :{status:'unresolved',reason:'reducer_not_callable'};
  return typeof action==='function'?{status:'planned',operation:'invoke',callback:action,arguments:[state],...queue,runtime_observed:false}
    :{status:'planned',operation:'value',value:action,...queue,runtime_observed:false};
}


/** A test queue is a separate lifetime from its synchronous callback. Planning
 * requires a build and never runs the callback or inspects its thenable. */
export function planReactTestScope(rule,{args=[],build}={}) {
  if(!validateReactExecutionRule(rule).valid || rule.kind!=='test_scope' || !Array.isArray(args))return {status:'unresolved',reason:'test_scope_rule_required'};
  if(!['development','production'].includes(build))return {status:'unresolved',reason:'test_scope_build_required'};
  if(rule[build]==='throw_before_callback')return {status:'planned',operation:'throw_before_callback',callbacks:[],runtime_observed:false};
  return {status:'planned',operation:'invoke',callback:args[rule.callback_argument],arguments:rule.callback_arguments.map(index=>args[index]),
    timing:rule.callback_timing,result:rule.result,callback_exceptions:rule.callback_exceptions,completion:rule.completion,
    queue_drain_observed:false,runtime_observed:false};
}

/** Describe source argument forwarding without running a callback. */
export function planSynchronousScope(rule,{args}) {
  const check=validateReactExecutionRule(rule);
  if(!check.valid || rule.kind!=='synchronous_scope' || !Array.isArray(args))return {status:'unresolved',reason:check.reason||'scope_inputs_required'};
  return {status:'planned',callback:args[rule.callback_argument],arguments:rule.callback_arguments.map(index=>args[index]),
    missing_callback:rule.missing_callback,result:rule.result,scheduling:rule.scheduling,
    transition_context:rule.transition_context,async_continuation:rule.async_continuation,runtime_observed:false};
}

/** ID allocation needs authoritative renderer counters/tree identity. Never
 * recover them by guessing from a DOM string, or treat the result as an entity. */
export function planReactId(rule,{owner,previous=null,environment='client',prefix='',clientCounter,treeId,localIndex=0}={}) {
  if(!validateReactExecutionRule(rule).valid || rule.kind!=='id_allocation')return {status:'unresolved',reason:'id_rule_required'};
  if(typeof owner!=='string' || !owner || typeof prefix!=='string' || !['client','server','hydrate'].includes(environment))return {status:'unresolved',reason:'id_environment_required'};
  if(previous && (previous.owner!==owner || typeof previous.value!=='string'))return {status:'unresolved',reason:'id_owner_mismatch'};
  if(previous && rule.retain_on_update)return {status:'planned',operation:'retain',value:previous.value,runtime_observed:false};
  let suffix;
  if(environment==='client') {
    if(!Number.isSafeInteger(clientCounter) || clientCounter<0)return {status:'unresolved',reason:'id_client_counter_required'};
    suffix=rule.client_marker+clientCounter.toString(rule.radix);
  } else {
    if(typeof treeId!=='string' || !treeId || !Number.isSafeInteger(localIndex) || localIndex<0)return {status:'unresolved',reason:'id_tree_position_required'};
    suffix=rule.server_marker+treeId+(localIndex>0?rule.local_marker+localIndex.toString(rule.radix):'');
  }
  return {status:'planned',operation:'allocate',value:rule.separator+prefix+suffix+rule.separator,runtime_observed:false};
}

/** Validate the observed tuple shape without calling a getter or either function.
 * Pending is a snapshot; returning it does not prove which update committed. */
export function planTransitionResult(rule,{tuple,owner,previous=null}={}) {
  if(!validateReactExecutionRule(rule).valid || rule.kind!=='transition_hook')return {status:'unresolved',reason:'transition_hook_rule_required'};
  if(!Array.isArray(tuple) || typeof owner!=='string' || !owner)return {status:'unresolved',reason:'transition_tuple_required'};
  const pending=Object.getOwnPropertyDescriptor(tuple,String(rule.pending_index));
  const start=Object.getOwnPropertyDescriptor(tuple,String(rule.start_index));
  if(!pending || typeof pending.value!=='boolean' || !start || typeof start.value!=='function')return {status:'unresolved',reason:'transition_tuple_required'};
  if(previous && (previous.owner!==owner || typeof previous.start!=='function'))return {status:'unresolved',reason:'transition_owner_mismatch'};
  if(previous && rule.retain_start && previous.start!==start.value)return {status:'unresolved',reason:'transition_start_changed'};
  return {status:'planned',pending:pending.value,start:start.value,operation:previous && rule.retain_start?'retain':'store',runtime_observed:false};
}

/** Render urgency must come from renderer evidence, never from elapsed time or
 * whether values differ. This planner does not execute a callback-valued input. */
export function planDeferredValue(rule,{args,owner,previous=null,urgency=null}={}) {
  if(!validateReactExecutionRule(rule).valid || rule.kind!=='deferred_value')return {status:'unresolved',reason:'deferred_value_rule_required'};
  if(!Array.isArray(args) || typeof owner!=='string' || !owner)return {status:'unresolved',reason:'deferred_input_required'};
  if(previous && (previous.owner!==owner || !Object.hasOwn(previous,'value')))return {status:'unresolved',reason:'deferred_owner_mismatch'};
  if(previous && !['urgent','nonurgent'].includes(urgency))return {status:'unresolved',reason:'render_urgency_unobserved'};
  const input=args[rule.value_argument],selection=previous?rule[urgency]:rule.mount;
  if(selection==='previous' && !previous)return {status:'unresolved',reason:'previous_deferred_value_required'};
  const equal=previous && (rule.comparison==='Object.is'?Object.is(input,previous.value):input===previous.value);
  return {status:'planned',selection,value:selection==='input'?input:previous.value,
    schedule_deferred:Boolean(previous && urgency==='urgent' && !equal && rule.schedule_changed),runtime_observed:false};
}

/** Describe only construction. The renderer's later callbacks, comparisons and
 * commits are separate operations; storing a component never executes it here. */
export function planComponentWrapper(rule,{args}={}) {
  if(!validateReactExecutionRule(rule).valid || rule.kind!=='component_wrapper')return {status:'unresolved',reason:'component_wrapper_rule_required'};
  if(!Array.isArray(args))return {status:'unresolved',reason:'wrapper_arguments_required'};
  const fields={[rule.component_field]:args[rule.component_argument]};
  if(rule.compare_field)fields[rule.compare_field]=args[rule.compare_argument]===undefined
    ?rule.missing_compare==='null'?null:undefined:args[rule.compare_argument];
  return {status:'planned',allocation:rule.allocation,marker:Symbol.for(rule.marker),fields,
    callback_operations:rule.callbacks_at_creation==='none'?[]:[{argument:rule.component_argument}],runtime_observed:false};
}

/** Boundary exports are values used in element descriptions, not call targets.
 * This predicts construction metadata only; the renderer owns their execution.
 */
export function predictBoundaryType(rule) {
  const check=validateReactExecutionRule(rule);
  if(!check.valid || rule.kind!=='boundary_type')return {status:'unresolved',reason:check.reason||'wrong_rule_kind'};
  return {status:'predicted',value_type:rule.value_type,value:Symbol.for(rule.marker),element_marker:Symbol.for(rule.element_marker),
    type_property:rule.type_property,construction_invokes:rule.construction_invokes,child_inputs:[...rule.child_inputs],renderer_execution_proven:false};
}

/** The key may invoke user coercion code. A pure plan only predicts primitive
 * keys; it never coerces an application object just to learn its display key. */
export function planPortalDescription(rule,{args=[]}={}) {
 if(!validateReactExecutionRule(rule).valid || rule.kind!=='portal_description')return {status:'unresolved',reason:'portal_rule_required'};
 const key=args[rule.key_argument];
 if(key!=null && !['string','number','boolean','bigint'].includes(typeof key))return {status:'unresolved',reason:'portal_key_coercion_required'};
 return {status:'planned',marker:rule.marker,key:key==null?null:String(key),
 fields:{[rule.children_field]:args[rule.children_argument],[rule.container_field]:args[rule.container_argument]},
 children_operation:rule.children_at_creation,container_validation:'requires_observed_library_result',renderer_execution_proven:false};
}

/** The normal renderer and an inspection dispatcher are different execution
 * contexts. A returned undefined alone cannot identify which dispatcher ran. */
export function planDebugValue(rule,{args=[],build,dispatcher}={}) {
 const check=validateReactExecutionRule(rule);
 if(!check.valid || rule.kind!=='debug_value')return {status:'unresolved',reason:check.reason||'debug_value_rule_required'};
 if(!['development','production'].includes(build))return {status:'unresolved',reason:'debug_build_required'};
 const mode=rule[build];
 if(mode==='ignore')return {status:'planned',operation:'return',value:undefined,callbacks:[],schedules:[]};
 const argumentsToDispatcher=[args[rule.value_argument],args[rule.formatter_argument]];
 if(dispatcher!=='standard_renderer')return {status:'planned',operation:'delegate',arguments:argumentsToDispatcher,
   return_from_dispatcher:true,throws_from_dispatcher:true,formatter_invocation:'dispatcher_defined',schedules:'dispatcher_defined'};
 return {status:'planned',operation:'return',value:rule.renderer_result==='undefined'?undefined:args[rule.value_argument],
   callbacks:rule.renderer_formatter==='invoke'?[{callback:args[rule.formatter_argument],arguments:[args[rule.value_argument]]}]:[],schedules:[]};
}

/** Bounded oracle/planning interpreter for data-property arrays and element
 * descriptions. It never invokes application callbacks or iterators. Runtime
 * observations must not call this on live children to infer a traversal. */
export function planChildrenTraversal(rule,{args=[],method}={}) {
 const check=validateReactExecutionRule(rule);
 if(!check.valid || rule.kind!=='children_collection')return {status:'unresolved',reason:check.reason||'children_rule_required'};
 if(!['map','forEach','count','toArray','only'].includes(method))return {status:'unresolved',reason:'children_method_required'};
 const children=args[rule.children_argument],leaves=[];let frontier=null,budget=1024;
 const data=(value,key)=>{try{let owner=value,depth=0;
  while(owner!==null){if(++depth>64){frontier='children_prototype_budget';return undefined;}
   const property=Object.getOwnPropertyDescriptor(owner,key);
   if(property){if(!Object.hasOwn(property,'value')){frontier='children_accessor_unobserved';return undefined;}return property.value;}
   owner=Object.getPrototypeOf(owner);
  }return undefined;
 }catch{frontier='children_descriptor_unobserved';return undefined;}};
 const marker=value=>value && typeof value==='object'?data(value,'$$typeof'):null;
 if(method==='only')return marker(children)===Symbol.for(rule.only_marker)
   ?{status:'planned',operation:'return',value:children,callbacks:[]}
   :frontier?{status:'unresolved',reason:frontier}:{status:'planned',operation:'throw',reason:'single_element_required',callbacks:[]};
 const seen=new Set();
 const walk=value=>{
  if(frontier)return;if(--budget<0){frontier='children_traversal_budget';return;}
  if(rule.normalize_empty && (value===undefined || typeof value==='boolean'))value=null;
  if(value===null || rule.leaf_types.includes(typeof value)){leaves.push(value);return;}
  if(value && typeof value==='object'){
   const type=marker(value);if(frontier)return;
   if(typeof type==='symbol' && rule.leaf_markers.includes(Symbol.keyFor(type))){
    if(rule.element_children==='opaque'){leaves.push(value);return;}
    const props=data(value,'props');walk(props?data(props,'children'):undefined);return;
   }
   if(Array.isArray(value)){
    if(seen.has(value)){frontier='children_cycle';return;}seen.add(value);
    const length=data(value,'length');if(!Number.isSafeInteger(length)||length<0||length>budget){frontier='children_traversal_budget';return;}
    const indices=Array.from({length},(_,i)=>i);if(rule.traversal==='reverse')indices.reverse();
    for(const i of indices)walk(data(value,String(i)));seen.delete(value);return;
   }
   frontier='children_iterable_or_object_unresolved';
  }
 };
 if(children!=null)walk(children);
 if(frontier)return {status:'unresolved',reason:frontier};
 const callbacks=['map','forEach'].includes(method)?leaves.map((value,index)=>({callback:args[rule.callback_argument],
   receiver:args[rule.receiver_argument],arguments:[value,index+rule.index_start]})):[];
 return {status:'planned',operation:'traverse',leaves,callbacks,
   ...(method==='count'?{value:leaves.length}:method==='forEach'?{value:undefined}:{}),
   result_frontier:['map','toArray'].includes(method)?'mapped_result_flattening_and_keys_unproven':null};
}
