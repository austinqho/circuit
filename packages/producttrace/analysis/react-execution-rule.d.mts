interface HookRule {
  schema:'producttrace.react-execution-rule.v1';
  callback_argument:number;
  dependencies_argument:number;
  owner:'mounted_hook';
  comparison:'Object.is';
}
export type ReactExecutionRule = {schema:'producttrace.react-execution-rule.v1';kind:'class_update';member:'setState'|'forceUpdate';updater_member:'enqueueSetState'|'enqueueForceUpdate';payload_argument:number|null;completion_argument:number;validate_payload:boolean;result:'undefined'|'updater_result';updater_arguments:('instance'|'payload'|'completion'|'member')[];calculation_arguments:('state'|'props')[];completion_arguments:('state'|'props')[];callback_receiver:'instance'|'undefined';merge:'shallow'|'replace';nullish:'previous'|'replace';force:boolean} | {schema:'producttrace.react-execution-rule.v1';kind:'class_component';props_argument:number;context_argument:number;updater_argument:number;updater_default:'falsy'|'nullish';refs:'shared_empty'|'fresh_empty';pure:boolean;render_method:'render'|'componentDidMount';props_field:'props'|'context';state_field:'state'|'context';comparison:'Object.is'|'strict_equal';custom_should_update:'first'|'after_default';default_update:'always'|'shallow_props_state'} | {schema:'producttrace.react-execution-rule.v1';kind:'pipeable_server_stream';element_argument:number;options_argument:number;callback_timing:'asynchronous'|'synchronous';result:'object'|'string';pipe_count:1|2;pipe_result:'destination'|'undefined';abort:'forward_reason'|'ignore';shell_callback:'shell'|'all_tasks';all_callback:'all_tasks'|'shell';callback_arguments:number[];effects:'none'|'invoke'} | {schema:'producttrace.react-execution-rule.v1';kind:'readable_server_stream';element_argument:number;options_argument:number;callback_timing:'synchronous'|'deferred';result:'object'|'string';resolve_at:'shell'|'all_tasks';all_ready:'all_tasks'|'shell';cancel:'abort'|'ignore';cancel_reason:'ignore'|'forward';signal:'future_abort_event'|'ignore';preaborted_signal:'ignore'|'abort';effects:'none'|'invoke'} | {schema:'producttrace.react-execution-rule.v1';kind:'legacy_render';argument:number;element_argument:number;callback_argument:number;parent_argument:number|null;mode:'render'|'hydrate';initial_flush:'flush_sync'|'deferred';updates:'schedule'|'always_flush';result:'first_child_state_node'|'undefined';callback_receiver:'public_instance'|'undefined';callback_arguments:number[];parent_context:'none'|'parent_instance'} | {schema:'producttrace.react-execution-rule.v1';kind:'legacy_unmount';argument:number;container_node_types:number[];comment_marker:string;root_kind:'legacy'|'any';flush:'flush_sync'|'deferred';present_result:boolean;absent_result:boolean} | {schema:'producttrace.react-execution-rule.v1';kind:'host_lookup';argument:number;nullish:'null'|'throw';element_node_type:1|3;instance_source:'current_fiber'|'provided_fiber';host_tags:number[];traversal:'depth_first'|'reverse';empty:'null'|'throw';detached:'throw'|'null';portals:'include'|'skip'} | {schema:'producttrace.react-execution-rule.v1';kind:'legacy_server_stream';element_argument:number;options_argument:number;output:'hydratable'|'static';ready:'all_tasks'|'shell';browser:'throw'|'render';destroy:'abort'|'ignore';callback_timing:'synchronous'|'deferred';effects:'none'|'invoke';result:'object'|'string'} | {schema:'producttrace.react-execution-rule.v1';kind:'server_string';element_argument:number;options_argument:number;output:'hydratable'|'static';suspension:'fallback'|'wait';outside_boundary:'throw'|'fallback';callback_timing:'synchronous'|'deferred';effects:'none'|'invoke';result:'string'|'promise'} | {schema:'producttrace.react-execution-rule.v1';kind:'dom_root';mode:'create'|'hydrate';container_argument:number;children_argument:number|null;options_argument:number;container_node_types:number[];render_argument:number;render_after_unmount:'throw'|'schedule';unmount_timing:'synchronous'|'scheduled';repeat_unmount:'noop'|'throw'} | {schema:'producttrace.react-execution-rule.v1';kind:'lazy_component';loader_argument:number;creation:'store'|'invoke';settlement:'first'|'last';module_property:'default'|'named';pending:'throw'|'return';retry_loader_error:boolean} | {schema:'producttrace.react-execution-rule.v1';kind:'element_factory';type_argument:number;allocation:'per_call'|'shared';creation_callbacks:'store'|'invoke';construction:ReactExecutionRule} | {schema:'producttrace.react-execution-rule.v1';kind:'test_scope';callback_argument:number;callback_arguments:number[];development:'invoke'|'throw_before_callback';production:'invoke'|'throw_before_callback';callback_timing:'synchronous'|'deferred';result:'thenable'|'callback_result';callback_exceptions:'propagate'|'wrap';completion:'outermost_queue_drain'|'callback_return'} | {schema:"producttrace.react-execution-rule.v1";kind:"element_clone";element_argument:number;config_argument:number;children_start:number;reserved_props:string[];children_policy:"replace"|"retain";default_policy:"supplied_undefined"|"all_undefined";ref_owner:"replace_on_ref"|"preserve";marker:string;callbacks_at_creation:"store"|"invoke"} | {schema:"producttrace.react-execution-rule.v1";kind:"element_construction";type_argument:number;config_argument:number;children_start:number;reserved_props:string[];children_policy:"replace"|"retain";default_policy:"undefined"|"always";marker:string;callbacks_at_creation:"store"|"invoke"} | {schema:"producttrace.react-execution-rule.v1";kind:"children_collection";children_argument:number;callback_argument:number;receiver_argument:number;normalize_empty:boolean;leaf_types:string[];leaf_markers:string[];traversal:"depth_first"|"reverse";index_start:0|1;element_children:"opaque"|"descend";only_marker:string} | {schema:"producttrace.react-execution-rule.v1";kind:"debug_value";value_argument:number;formatter_argument:number;development:"delegate"|"ignore";production:"delegate"|"ignore";renderer_formatter:"ignore"|"invoke";renderer_result:"undefined"|"value"} | {schema:'producttrace.react-execution-rule.v1';kind:'portal_description';children_argument:number;container_argument:number;key_argument:number;children_field:'children'|'containerInfo';container_field:'children'|'containerInfo';marker:string;children_at_creation:'store'|'invoke'} | {schema:'producttrace.react-execution-rule.v1';kind:'boundary_type';value_type:'symbol'|'function';marker:string;element_marker:string;type_property:'type'|'props';construction_invokes:boolean;child_inputs:('children'|'fallback')[];renderer:{tag:7|8|12|13;input:'children'|'props';selection:'suspense_state'|'children';strict_render_mask:0|8;strict_effect_mask:0|16};fragment:null|{key_match:'key_or_index'|'index_only';type_tag:7|8;ref:'ignore'|'attach';extra_props:'ignore'|'forward'};profiler:null|{callback:'onRender'|'onCommit';phase:'layout_commit'|'passive_commit';profile_mask:2|8;update_mask:4|8;arguments:('id'|'phase'|'actualDuration'|'treeBaseDuration'|'actualStartTime'|'commitTime')[];mount_phase:'mount'|'update';update_phase:'mount'|'update';nested_phase:'nested-update'|'update';result:'ignore'|'forward'}} | {schema:'producttrace.react-execution-rule.v1';kind:'component_wrapper';allocation:'per_call'|'shared';marker:string;component_argument:number;component_field:'render'|'type';compare_argument:number|null;compare_field:'compare'|null;missing_compare:'null'|'undefined';callbacks_at_creation:'none'|'invoke';render_ref:null|{argument:number;field:'ref'|'stateNode';fiber_tag:11|14|15}} | {schema:'producttrace.react-execution-rule.v1';kind:'deferred_value';owner:'mounted_hook';value_argument:number;comparison:'Object.is'|'strict_equal';mount:'input'|'previous';urgent:'input'|'previous';nonurgent:'input'|'previous';schedule_changed:boolean} | {schema:'producttrace.react-execution-rule.v1';kind:'transition_hook';owner:'mounted_hook';pending_index:number;start_index:number;retain_start:boolean;start_rule:ReactExecutionRule} | {schema:'producttrace.react-execution-rule.v1';kind:'id_allocation';owner:'mounted_hook';retain_on_update:boolean;client_marker:string;server_marker:string;local_marker:string;separator:string;radix:number} | {schema:'producttrace.react-execution-rule.v1';kind:'external_store';subscribe_argument:number;snapshot_argument:number;server_snapshot_argument:number;
  subscription_phase:'passive'|'layout';comparison:'Object.is'|'strict_equal';resubscribe:'subscribe_identity'|'every_commit';strict_mount_rehearsal:boolean;
  snapshot_throw:'request_update'|'ignore';notification_arguments:'ignored'} | {schema:'producttrace.react-execution-rule.v1';kind:'imperative_handle';ref_argument:number;factory_argument:number;dependencies_argument:number;
  phase:'layout'|'passive'|'insertion';skip_null_ref:boolean;include_ref_dependency:boolean;comparison:'Object.is'|'strict_equal';
  object_property:string;cleanup_value:'null'|'undefined';strict_mount_rehearsal:boolean;callback_ref_return:'ignore'} | {schema:'producttrace.react-execution-rule.v1';kind:'context_binding';mode:'create'|'read';
  default_argument:number;matching:'identity';selection:'nearest'|'farthest';undefined_provider:'value'|'default';
  function_value:'store';change_comparison:'Object.is'|'strict_equal'} | {schema:'producttrace.react-execution-rule.v1';kind:'ref_cell';
  allocation:'per_call'|'mounted_hook';initial:'null'|'argument';argument:number;property:string;function_input:'store';
  write_scheduling:'none';sealed:{development:boolean;production:boolean}} | {schema:'producttrace.react-execution-rule.v1';kind:'element_predicate';
  argument:number;input_kind:'object'|'function';exclude_null:boolean;marker_property:string;marker_symbol:string;
  comparison:'strict_equal';result:'boolean';property_access:'ordinary_get'} | {schema:'producttrace.react-execution-rule.v1';kind:'synchronous_scope';
  callback_argument:number;callback_arguments:number[];missing_callback:'required'|'skip_falsy';result:'undefined'|'callback_result';
  exceptions:'propagate'|'callback_or_flush_error';transition_context:'new'|'clear'|'preserve';scheduling:'transition'|'sync_flush'|'legacy_batch';async_continuation:'outside_scope'} | {schema:'producttrace.react-execution-rule.v1';kind:'state_queue';
  initial_argument:number;initializer_argument:number;initializer_mode:'if_function'|'if_provided';
  update_mode:'functional_or_replace'|'reducer';reducer_argument:number|null;owner:'mounted_hook';comparison:'Object.is'} | {schema:'producttrace.react-execution-rule.v1';kind:'literal_export';
  values:{development:string;production:string};callbacks:'none';scheduling:'none'} | HookRule & (
  {kind:'retained_callback';result:'callback_identity'} |
  {kind:'memo_value';result:'cached_value'} |
  {kind:'commit_effect';result:'cleanup_or_void';phase:'passive'|'layout'|'insertion';strict_mount_rehearsal:boolean}
);
export declare function validateReactExecutionRule(rule:unknown): {valid:boolean;reason:string|null};
export declare function planRefCell(rule:ReactExecutionRule,input:{args:unknown[];previous?:{owner?:string;reference:object}|null;
  owner?:string|null;build?:string;cacheAvailable?:boolean}):
  {status:'unresolved';reason:string} | {status:'planned';operation:'retain';reference:object;runtime_observed:false} |
  {status:'planned';operation:'allocate';property:string;initial_value:unknown;sealed:boolean;writable:true;enumerable:true;runtime_observed:false};
export declare function planElementPredicate(rule:ReactExecutionRule,input:{args:unknown[];propertyRead?:{outcome:'returned'|'threw';value:unknown}}):
  {status:'unresolved';reason:string} |
  {status:'planned';operation:'get';target:unknown;property:string;may_invoke_user_code:true;runtime_observed:false} |
  {status:'predicted';outcome:'returned'|'threw';value:unknown;runtime_observed:false};
export declare function predictRetainedCallback(rule:ReactExecutionRule,input:{args:unknown[];
  previous?:{callback:Function;dependencies?:unknown[]|null}|null;cacheAvailable?:boolean}):
  {status:'unresolved';reason:string}|{status:'predicted';operation:'retain'|'store';callback:Function;
  dependencies:unknown[]|null;runtime_observed:false};
export declare function planEffectExecution(rule:ReactExecutionRule,input:{event:string;
  previous?:Record<string,unknown>|null;next?:Record<string,unknown>|null;
  environment?:string;strictDevelopment?:boolean;dependencyComparison?:string}):
  {claim:'conditional_plan';runtime_observed:false;operations:Record<string,unknown>[];frontier:string|null};

export declare function predictMemoValue(rule:ReactExecutionRule,input:{args:unknown[];
  previous?:{callback:Function;value:unknown;dependencies?:unknown[]|null}|null;cacheAvailable?:boolean}):
  {status:'unresolved';reason:string}|{status:'predicted';operation:'retain'|'calculate';callback:Function;
  dependencies:unknown[]|null;value?:unknown;runtime_observed:false};

export declare function predictLiteralExport(rule:ReactExecutionRule,input?:{build?:string}):
  {status:'unresolved';reason:string}|{status:'predicted';value:string;callbacks:never[];schedules:never[];runtime_observed:false};

export type ReactStatePlan = {status:'unresolved';reason:string} |
  {status:'planned';operation:'invoke';callback:Function;arguments:unknown[];runtime_observed:false} |
  {status:'planned';operation:'value';value:unknown;runtime_observed:false};
export declare function planStateInitialization(rule:ReactExecutionRule,input:{args:unknown[]}):ReactStatePlan;
export declare function planStateUpdate(rule:ReactExecutionRule,input:{state:unknown;action:unknown;reducer?:Function}):ReactStatePlan;

export declare function planSynchronousScope(rule:ReactExecutionRule,input:{args:unknown[]}):
  {status:'unresolved';reason:string}|{status:'planned';callback:unknown;arguments:unknown[];missing_callback:string;
  result:string;scheduling:string;transition_context:string;async_continuation:'outside_scope';runtime_observed:false};

export declare function planContextBinding(rule:ReactExecutionRule,input?:{args?:unknown[];member?:string|null;requestedContext?:unknown;
  providers?:Array<{context:unknown;value:unknown}>;chainComplete?:boolean;defaultValue?:unknown;defaultKnown?:boolean}):
  {status:'unresolved';reason:string}|{status:'planned';operation:'allocate_context';default_value:unknown;runtime_observed:false}|
  {status:'planned';operation:'read_default'|'read_provider';provider:{context:unknown;value:unknown}|null;value_known:boolean;value?:unknown;runtime_observed:false};
export declare function contextValueChanged(rule:ReactExecutionRule,previous:unknown,next:unknown):boolean|null;

export declare function planImperativeHandle(rule:ReactExecutionRule,input?:{args?:unknown[];previous?:{ref:unknown;dependencies?:unknown[]|null;attached:boolean}|null;
  event?:string;environment?:string;strictDevelopment?:boolean}):{status:'unresolved';reason:string}|
  {status:'planned';phase:string;operations:Record<string,unknown>[];runtime_observed:false};

export declare function planExternalStore(rule:ReactExecutionRule,input?:{args?:unknown[];event?:string;environment?:string;
  previous?:{subscribe:Function;hasCleanup:boolean}|null;strictDevelopment?:boolean;
  observation?:{outcome:'returned'|'threw';previousValue:unknown;value?:unknown}|null}):
  {status:'unresolved';reason:string}|{status:'planned';operations:Record<string,unknown>[];runtime_observed:false;request_update?:boolean;commit_proven?:false};

export declare function planReactId(rule:ReactExecutionRule,input?:{owner?:string;previous?:{owner:string;value:string}|null;
  environment?:string;prefix?:string;clientCounter?:number;treeId?:string;localIndex?:number}):
  {status:'unresolved';reason:string}|{status:'planned';operation:'retain'|'allocate';value:string;runtime_observed:false};

export declare function planTransitionResult(rule:ReactExecutionRule,input?:{tuple?:unknown;owner?:string;previous?:{owner:string;start:Function}|null}):
  {status:'unresolved';reason:string}|{status:'planned';pending:boolean;start:Function;operation:'retain'|'store';runtime_observed:false};

export declare function planDeferredValue(rule:ReactExecutionRule,input?:{args?:unknown[];owner?:string;previous?:{owner:string;value:unknown}|null;urgency?:string|null}):{status:'unresolved';reason:string}|{status:'planned';selection:string;value:unknown;schedule_deferred:boolean;runtime_observed:false};

export declare function planComponentWrapper(rule:ReactExecutionRule,input?:{args?:unknown[]}):{status:'unresolved';reason:string}|{status:'planned';allocation:string;marker:symbol;fields:Record<string,unknown>;callback_operations:{argument:number}[];runtime_observed:false};

export declare function predictBoundaryType(rule:ReactExecutionRule):{status:'unresolved';reason:string}|{status:'predicted';value_type:string;value:symbol;element_marker:symbol;type_property:string;construction_invokes:boolean;child_inputs:string[];renderer_execution_proven:false};

export declare function planPortalDescription(rule:ReactExecutionRule,input?:{args?:unknown[]}):{status:'unresolved';reason:string}|{status:'planned';marker:string;key:string|null;fields:Record<string,unknown>;children_operation:string;container_validation:'requires_observed_library_result';renderer_execution_proven:false};

export function planDebugValue(rule:ReactExecutionRule, input?:{args?:unknown[];build?:string;dispatcher?:string}):Record<string,unknown>;

export function planChildrenTraversal(rule:ReactExecutionRule, input?:{args?:unknown[];method?:string}):Record<string,unknown>;

export function planElementConstruction(rule:ReactExecutionRule, args?:unknown[]):Record<string,unknown>;

export function planElementClone(rule:ReactExecutionRule,args?:unknown[],options?:{owner?:unknown}):Record<string,unknown>;

export function planReactTestScope(rule:ReactExecutionRule,inputs?:{args?:unknown[];build?:"development"|"production"}):Record<string,unknown>;

export function planElementFactory(rule:ReactExecutionRule,inputs?:{args?:unknown[];invocation?:unknown[]}):Record<string,unknown>;

export function planReactLazyStep(rule:ReactExecutionRule,inputs?:{state?:{status:string;value:unknown};event?:string;value?:unknown}):Record<string,unknown>;

export function planReactRootOperation(rule:ReactExecutionRule,inputs?:{operation?:string;state?:string;args?:unknown[];containerNodeType?:number}):Record<string,unknown>;

export declare function planReactServerString(rule:ReactExecutionRule,input?:{args?:unknown[];suspended?:boolean;boundary?:boolean;fatal?:boolean}):Record<string,unknown>;

export declare function planReactLegacyServerStream(rule:ReactExecutionRule,input?:{args?:unknown[];environment?:'node'|'browser';operation?:string}):Record<string,unknown>;

export declare function planReactHostLookup(rule:ReactExecutionRule,input?:{input?:unknown;args?:unknown[];nodeType?:number;currentTree?:Record<string,unknown>;providedTree?:Record<string,unknown>;mounted?:boolean}):Record<string,unknown>;

export function planReactLegacyUnmount(rule:ReactExecutionRule,input?:{args?:unknown[];nodeType?:number;nodeValue?:string;rootKind?:'legacy'|'concurrent'|'none'}):Record<string,unknown>;

export function planReactLegacyRender(rule:ReactExecutionRule,input?:{args?:unknown[];rootState?:'initial'|'existing'|'unobserved';publicInstance?:unknown;parentValid?:boolean}):Record<string,unknown>;

export function planReactReadableStream(rule:ReactExecutionRule,input?:{args?:unknown[];operation?:'create'|'cancel'|'signal';preaborted?:boolean;reason?:unknown}):Record<string,unknown>;

export function planReactPipeableStream(rule:ReactExecutionRule,input?:{args?:unknown[];operation?:'create'|'pipe'|'abort';pipeCount?:number;destination?:unknown;reason?:unknown}):Record<string,unknown>;

export function planReactClassOperation(rule:ReactExecutionRule,input?:Record<string,unknown>):Record<string,unknown>;

export function planReactClassUpdate(rule:ReactExecutionRule,input?:Record<string,unknown>):Record<string,unknown>;
