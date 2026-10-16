// Validates React execution rules. Kept separate from react-execution-rule.mjs so
// the per-API plan modules can use it without an import cycle.
/**
 * Executable rule vocabulary. Descriptive behavior notes are not programs.
 * Adding a vocabulary entry requires an interpreter, real-library oracle, and
 * a tracing test; an unknown instruction fails closed instead of being ignored.
 */
const KEYS = ['schema','kind','callback_argument','dependencies_argument','owner','comparison','result'];
export function validateReactExecutionRule(rule) {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return {valid:false, reason:'rule_required'};
  if(rule.kind==='legacy_render'){
    const keys=['schema','kind','argument','element_argument','callback_argument','parent_argument','mode','initial_flush','updates','result','callback_receiver','callback_arguments','parent_context'];
    const index=value=>Number.isSafeInteger(value)&&value>=0&&value<16;
    if(Object.keys(rule).length!==keys.length||Object.keys(rule).some(key=>!keys.includes(key)))return {valid:false,reason:'unexpected_or_missing_rule_field'};
    if(rule.schema!=='producttrace.react-execution-rule.v1'||![rule.argument,rule.element_argument,rule.callback_argument].every(index)||rule.parent_argument!==null&&!index(rule.parent_argument)
      ||!['render','hydrate'].includes(rule.mode)||!['flush_sync','deferred'].includes(rule.initial_flush)||!['schedule','always_flush'].includes(rule.updates)
      ||!['first_child_state_node','undefined'].includes(rule.result)||!['public_instance','undefined'].includes(rule.callback_receiver)
      ||!Array.isArray(rule.callback_arguments)||rule.callback_arguments.length>4||!rule.callback_arguments.every(index)||!['none','parent_instance'].includes(rule.parent_context))return {valid:false,reason:'unsupported_legacy_render'};
    return {valid:true,reason:null};
  }
  if(rule.kind==='legacy_unmount'){

    const keys=['schema','kind','argument','container_node_types','comment_marker','root_kind','flush','present_result','absent_result'];
    if(Object.keys(rule).length!==keys.length||Object.keys(rule).some(key=>!keys.includes(key)))return {valid:false,reason:'unexpected_or_missing_rule_field'};
    if(rule.schema!=='producttrace.react-execution-rule.v1'||!Number.isSafeInteger(rule.argument)||rule.argument<0||rule.argument>15
      ||!Array.isArray(rule.container_node_types)||!rule.container_node_types.length||rule.container_node_types.length>12||!rule.container_node_types.every(value=>Number.isInteger(value)&&value>0&&value<16)
      ||typeof rule.comment_marker!=='string'||!['legacy','any'].includes(rule.root_kind)||!['flush_sync','deferred'].includes(rule.flush)
      ||typeof rule.present_result!=='boolean'||typeof rule.absent_result!=='boolean')return {valid:false,reason:'unsupported_legacy_unmount'};
    return {valid:true,reason:null};
  }
  if(rule.kind==='host_lookup'){
    const keys=['schema','kind','argument','nullish','element_node_type','instance_source','host_tags','traversal','empty','detached','portals'];
    if(Object.keys(rule).length!==keys.length||Object.keys(rule).some(key=>!keys.includes(key)))return {valid:false,reason:'unexpected_or_missing_rule_field'};
    if(rule.schema!=='producttrace.react-execution-rule.v1'||!Number.isSafeInteger(rule.argument)||rule.argument<0||rule.argument>15
      ||!['null','throw'].includes(rule.nullish)||![1,3].includes(rule.element_node_type)||!['current_fiber','provided_fiber'].includes(rule.instance_source)
      ||!Array.isArray(rule.host_tags)||!rule.host_tags.length||rule.host_tags.length>8||!rule.host_tags.every(value=>Number.isInteger(value)&&value>=0&&value<=30)
      ||!['depth_first','reverse'].includes(rule.traversal)||!['null','throw'].includes(rule.empty)||!['throw','null'].includes(rule.detached)||!['include','skip'].includes(rule.portals))return {valid:false,reason:'unsupported_host_lookup'};
    return {valid:true,reason:null};
  }
  if(rule.kind==='class_update'){
    const keys=['schema','kind','member','updater_member','payload_argument','completion_argument','validate_payload','result','updater_arguments','calculation_arguments','completion_arguments','callback_receiver','merge','nullish','force'];
    const index=value=>Number.isSafeInteger(value)&&value>=0&&value<8,sequence=(values,allowed)=>Array.isArray(values)&&values.length<=4&&values.every(value=>allowed.includes(value));
    if(Object.keys(rule).length!==keys.length||Object.keys(rule).some(key=>!keys.includes(key)))return {valid:false,reason:'unexpected_or_missing_rule_field'};
    if(rule.schema!=='producttrace.react-execution-rule.v1'||!['setState','forceUpdate'].includes(rule.member)||!['enqueueSetState','enqueueForceUpdate'].includes(rule.updater_member)
      ||!(rule.payload_argument===null||index(rule.payload_argument))||!index(rule.completion_argument)||typeof rule.validate_payload!=='boolean'||!['undefined','updater_result'].includes(rule.result)
      ||!sequence(rule.updater_arguments,['instance','payload','completion','member'])||!sequence(rule.calculation_arguments,['state','props'])||!sequence(rule.completion_arguments,['state','props'])
      ||!['instance','undefined'].includes(rule.callback_receiver)||!['shallow','replace'].includes(rule.merge)||!['previous','replace'].includes(rule.nullish)||typeof rule.force!=='boolean')return {valid:false,reason:'unsupported_class_update'};
    return {valid:true,reason:null};
  }
  if(rule.kind==='class_component'){
    const keys=['schema','kind','props_argument','context_argument','updater_argument','updater_default','refs','pure','render_method','props_field','state_field','comparison','custom_should_update','default_update'];
    const index=value=>Number.isSafeInteger(value)&&value>=0&&value<16;
    if(Object.keys(rule).length!==keys.length||Object.keys(rule).some(key=>!keys.includes(key)))return {valid:false,reason:'unexpected_or_missing_rule_field'};
    if(rule.schema!=='producttrace.react-execution-rule.v1'||![rule.props_argument,rule.context_argument,rule.updater_argument].every(index)||!['falsy','nullish'].includes(rule.updater_default)
      ||!['shared_empty','fresh_empty'].includes(rule.refs)||typeof rule.pure!=='boolean'||!['render','componentDidMount'].includes(rule.render_method)
      ||!['props','context'].includes(rule.props_field)||!['state','context'].includes(rule.state_field)||!['Object.is','strict_equal'].includes(rule.comparison)
      ||!['first','after_default'].includes(rule.custom_should_update)||!['always','shallow_props_state'].includes(rule.default_update))return {valid:false,reason:'unsupported_class_component'};
    return {valid:true,reason:null};
  }
  if(rule.kind==='pipeable_server_stream'){

    const keys=['schema','kind','element_argument','options_argument','callback_timing','result','pipe_count','pipe_result','abort','shell_callback','all_callback','callback_arguments','effects'];
    const index=value=>Number.isSafeInteger(value)&&value>=0&&value<16;
    if(Object.keys(rule).length!==keys.length||Object.keys(rule).some(key=>!keys.includes(key)))return {valid:false,reason:'unexpected_or_missing_rule_field'};
    if(rule.schema!=='producttrace.react-execution-rule.v1'||![rule.element_argument,rule.options_argument].every(index)||!['asynchronous','synchronous'].includes(rule.callback_timing)
      ||!['object','string'].includes(rule.result)||![1,2].includes(rule.pipe_count)||!['destination','undefined'].includes(rule.pipe_result)||!['forward_reason','ignore'].includes(rule.abort)
      ||!['shell','all_tasks'].includes(rule.shell_callback)||!['all_tasks','shell'].includes(rule.all_callback)||!Array.isArray(rule.callback_arguments)||rule.callback_arguments.length>4||!rule.callback_arguments.every(index)
      ||!['none','invoke'].includes(rule.effects))return {valid:false,reason:'unsupported_pipeable_server_stream'};
    return {valid:true,reason:null};
  }
  if(rule.kind==='readable_server_stream'){

    const keys=['schema','kind','element_argument','options_argument','callback_timing','result','resolve_at','all_ready','cancel','cancel_reason','signal','preaborted_signal','effects'];
    const index=value=>Number.isSafeInteger(value)&&value>=0&&value<16;
    if(Object.keys(rule).length!==keys.length||Object.keys(rule).some(key=>!keys.includes(key)))return {valid:false,reason:'unexpected_or_missing_rule_field'};
    if(rule.schema!=='producttrace.react-execution-rule.v1'||![rule.element_argument,rule.options_argument].every(index)||!['synchronous','deferred'].includes(rule.callback_timing)
      ||!['object','string'].includes(rule.result)||!['shell','all_tasks'].includes(rule.resolve_at)||!['all_tasks','shell'].includes(rule.all_ready)||!['abort','ignore'].includes(rule.cancel)
      ||!['ignore','forward'].includes(rule.cancel_reason)||!['future_abort_event','ignore'].includes(rule.signal)||!['ignore','abort'].includes(rule.preaborted_signal)||!['none','invoke'].includes(rule.effects))return {valid:false,reason:'unsupported_readable_server_stream'};
    return {valid:true,reason:null};
  }
  if(rule.kind==='legacy_server_stream'){

    const keys=['schema','kind','element_argument','options_argument','output','ready','browser','destroy','callback_timing','effects','result'];
    if(Object.keys(rule).length!==keys.length||Object.keys(rule).some(key=>!keys.includes(key)))return {valid:false,reason:'unexpected_or_missing_rule_field'};
    if(rule.schema!=='producttrace.react-execution-rule.v1'||![rule.element_argument,rule.options_argument].every(value=>Number.isSafeInteger(value)&&value>=0&&value<16)
      ||!['hydratable','static'].includes(rule.output)||!['all_tasks','shell'].includes(rule.ready)||!['throw','render'].includes(rule.browser)
      ||!['abort','ignore'].includes(rule.destroy)||!['synchronous','deferred'].includes(rule.callback_timing)||!['none','invoke'].includes(rule.effects)||!['object','string'].includes(rule.result))return {valid:false,reason:'unsupported_legacy_server_stream'};
    return {valid:true,reason:null};
  }
  if(rule.kind==='server_string'){
    const keys=['schema','kind','element_argument','options_argument','output','suspension','outside_boundary','callback_timing','effects','result'];
    if(Object.keys(rule).length!==keys.length||Object.keys(rule).some(key=>!keys.includes(key)))return {valid:false,reason:'unexpected_or_missing_rule_field'};
    if(rule.schema!=='producttrace.react-execution-rule.v1'||![rule.element_argument,rule.options_argument].every(value=>Number.isSafeInteger(value)&&value>=0&&value<16)
      ||!['hydratable','static'].includes(rule.output)||!['fallback','wait'].includes(rule.suspension)||!['throw','fallback'].includes(rule.outside_boundary)
      ||!['synchronous','deferred'].includes(rule.callback_timing)||!['none','invoke'].includes(rule.effects)||!['string','promise'].includes(rule.result))return {valid:false,reason:'unsupported_server_string'};
    return {valid:true,reason:null};
  }
  if(rule.kind==='dom_root'){
    const keys=['schema','kind','mode','container_argument','children_argument','options_argument','identifier_prefix_option','recoverable_error_option','container_node_types','render_argument','render_after_unmount','unmount_timing','repeat_unmount'];
    const index=value=>Number.isSafeInteger(value)&&value>=0&&value<16;
    if(Object.keys(rule).length!==keys.length||Object.keys(rule).some(key=>!keys.includes(key)))return {valid:false,reason:'unexpected_or_missing_rule_field'};
    if(rule.schema!=='producttrace.react-execution-rule.v1'||!['create','hydrate'].includes(rule.mode)
      ||![rule.container_argument,rule.options_argument,rule.render_argument].every(index)||rule.children_argument!==null&&!index(rule.children_argument)
      ||rule.identifier_prefix_option!=='identifierPrefix'||rule.recoverable_error_option!=='onRecoverableError'
      ||!Array.isArray(rule.container_node_types)||rule.container_node_types.length>12||!rule.container_node_types.every(index)
      ||!['throw','schedule'].includes(rule.render_after_unmount)||!['synchronous','scheduled'].includes(rule.unmount_timing)
      ||!['noop','throw'].includes(rule.repeat_unmount))return {valid:false,reason:'unsupported_dom_root'};
    return {valid:true,reason:null};
  }
  if(rule.kind==='lazy_component') {
    const keys=['schema','kind','loader_argument','creation','settlement','module_property','pending','retry_loader_error'];
    if(Object.keys(rule).length!==keys.length || Object.keys(rule).some(key=>!keys.includes(key)))return {valid:false,reason:'unexpected_or_missing_rule_field'};
    if(rule.schema!=='producttrace.react-execution-rule.v1'||!Number.isSafeInteger(rule.loader_argument)||rule.loader_argument<0||rule.loader_argument>15
      ||!['store','invoke'].includes(rule.creation)||!['first','last'].includes(rule.settlement)||!['default','named'].includes(rule.module_property)
      ||!['throw','return'].includes(rule.pending)||typeof rule.retry_loader_error!=='boolean')return {valid:false,reason:'unsupported_lazy_component'};
    return {valid:true,reason:null};
  }
  if(rule.kind==='element_factory') {
    const keys=['schema','kind','type_argument','allocation','creation_callbacks','construction'];
    if(Object.keys(rule).length!==keys.length || Object.keys(rule).some(key=>!keys.includes(key)))return {valid:false,reason:'unexpected_or_missing_rule_field'};
    if(rule.schema!=='producttrace.react-execution-rule.v1' || !Number.isSafeInteger(rule.type_argument) || rule.type_argument<0 || rule.type_argument>15
      || !['per_call','shared'].includes(rule.allocation) || !['store','invoke'].includes(rule.creation_callbacks)
      || rule.construction?.kind!=='element_construction' || !validateReactExecutionRule(rule.construction).valid)return {valid:false,reason:'unsupported_element_factory'};
    return {valid:true,reason:null};
  }
  if(rule.kind==='element_clone') {
    const keys=['schema','kind','element_argument','config_argument','children_start','reserved_props','children_policy','default_policy','ref_owner','marker','callbacks_at_creation'];
    if(Object.keys(rule).length!==keys.length || Object.keys(rule).some(key=>!keys.includes(key)))return {valid:false,reason:'unexpected_or_missing_rule_field'};
    if(rule.schema!=='producttrace.react-execution-rule.v1'
      || ![rule.element_argument,rule.config_argument,rule.children_start].every(index=>Number.isSafeInteger(index)&&index>=0&&index<16)
      || new Set([rule.element_argument,rule.config_argument,rule.children_start]).size!==3
      || !Array.isArray(rule.reserved_props)||rule.reserved_props.some(name=>typeof name!=='string')
      || !['replace','retain'].includes(rule.children_policy)||!['supplied_undefined','all_undefined'].includes(rule.default_policy)
      || !['replace_on_ref','preserve'].includes(rule.ref_owner)||typeof rule.marker!=='string'||!['store','invoke'].includes(rule.callbacks_at_creation))return {valid:false,reason:'unsupported_element_clone'};
    return {valid:true,reason:null};
  }
  if(rule.kind==='element_construction') {
    const keys=['schema','kind','type_argument','config_argument','children_start','reserved_props','children_policy','default_policy','owner','marker','callbacks_at_creation'];
    if(Object.keys(rule).length!==keys.length || Object.keys(rule).some(key=>!keys.includes(key)))return {valid:false,reason:'unexpected_or_missing_rule_field'};
    if(rule.schema!=='producttrace.react-execution-rule.v1'
      || ![rule.type_argument,rule.config_argument,rule.children_start].every(index=>Number.isSafeInteger(index)&&index>=0&&index<16)
      || new Set([rule.type_argument,rule.config_argument,rule.children_start]).size!==3
      || !Array.isArray(rule.reserved_props)||rule.reserved_props.some(name=>typeof name!=='string')
      || !['replace','retain'].includes(rule.children_policy)||!['undefined','always'].includes(rule.default_policy)
      || !rule.owner||Object.keys(rule.owner).sort().join(',')!=='development,production'
      || rule.owner.development!=='current_render_owner_or_null_outside_renderer'||rule.owner.production!=='null'
      || typeof rule.marker!=='string'||!['store','invoke'].includes(rule.callbacks_at_creation))return {valid:false,reason:'unsupported_element_construction'};
    return {valid:true,reason:null};
  }
  if(rule.kind==='children_collection') {
    const keys=['schema','kind','children_argument','callback_argument','receiver_argument','normalize_empty','leaf_types','leaf_markers','traversal','index_start','element_children','only_marker'];
    if(Object.keys(rule).length!==keys.length || Object.keys(rule).some(key=>!keys.includes(key)))return {valid:false,reason:'unexpected_or_missing_rule_field'};
    if(rule.schema!=='producttrace.react-execution-rule.v1'
      || ![rule.children_argument,rule.callback_argument,rule.receiver_argument].every(index=>Number.isSafeInteger(index)&&index>=0&&index<16)
      || new Set([rule.children_argument,rule.callback_argument,rule.receiver_argument]).size!==3
      || typeof rule.normalize_empty!=='boolean' || !['depth_first','reverse'].includes(rule.traversal)
      || ![0,1].includes(rule.index_start) || !['opaque','descend'].includes(rule.element_children)
      || !Array.isArray(rule.leaf_types) || rule.leaf_types.some(x=>!['string','number','function','symbol','bigint'].includes(x))
      || !Array.isArray(rule.leaf_markers) || rule.leaf_markers.some(x=>typeof x!=='string')
      || typeof rule.only_marker!=='string')return {valid:false,reason:'unsupported_children_collection'};
    return {valid:true,reason:null};
  }
  if(rule.kind==='debug_value') {
    const keys=['schema','kind','value_argument','formatter_argument','development','production','renderer_formatter','renderer_result'];
    if(Object.keys(rule).length!==keys.length || Object.keys(rule).some(key=>!keys.includes(key)))return {valid:false,reason:'unexpected_or_missing_rule_field'};
    if(rule.schema!=='producttrace.react-execution-rule.v1'
      || ![rule.value_argument,rule.formatter_argument].every(index=>Number.isSafeInteger(index)&&index>=0&&index<16)
      || rule.value_argument===rule.formatter_argument || !['delegate','ignore'].includes(rule.development)
      || !['delegate','ignore'].includes(rule.production) || !['ignore','invoke'].includes(rule.renderer_formatter)
      || !['undefined','value'].includes(rule.renderer_result))return {valid:false,reason:'unsupported_debug_value'};
    return {valid:true,reason:null};
  }
  if(rule.kind==='portal_description') {
    const keys=['schema','kind','children_argument','container_argument','key_argument','children_field','container_field','marker','children_at_creation'];
    if(Object.keys(rule).length!==keys.length || Object.keys(rule).some(key=>!keys.includes(key)))return {valid:false,reason:'unexpected_or_missing_rule_field'};
    if(rule.schema!=='producttrace.react-execution-rule.v1'
      || ![rule.children_argument,rule.container_argument,rule.key_argument].every(index=>Number.isSafeInteger(index)&&index>=0&&index<16)
      || new Set([rule.children_argument,rule.container_argument,rule.key_argument]).size!==3
      || !['children','containerInfo'].includes(rule.children_field) || !['children','containerInfo'].includes(rule.container_field)
      || typeof rule.marker!=='string' || !rule.marker || !['store','invoke'].includes(rule.children_at_creation))return {valid:false,reason:'unsupported_portal_description'};
    return {valid:true,reason:null};
  }
  if(rule.kind==='boundary_type') {
    const keys=['schema','kind','value_type','marker','element_marker','type_property','construction_invokes','child_inputs','renderer','fragment','profiler'];
    if(Object.keys(rule).length!==keys.length || Object.keys(rule).some(key=>!keys.includes(key)))return {valid:false,reason:'unexpected_or_missing_rule_field'};
    if(rule.schema!=='producttrace.react-execution-rule.v1' || !['symbol','function'].includes(rule.value_type)
      || !['marker','element_marker'].every(key=>typeof rule[key]==='string' && rule[key].length>0)
      || !['type','props'].includes(rule.type_property) || typeof rule.construction_invokes!=='boolean'
      || !Array.isArray(rule.child_inputs) || !rule.child_inputs.length || new Set(rule.child_inputs).size!==rule.child_inputs.length
      || rule.child_inputs.some(input=>!['children','fallback'].includes(input)))return {valid:false,reason:'unsupported_boundary_type_semantics'};
    const renderer=rule.renderer;
    if(!renderer||Object.keys(renderer).sort().join(',')!=='input,selection,strict_effect_mask,strict_render_mask,tag'
      ||![7,8,12,13].includes(renderer.tag)||!['children','props'].includes(renderer.input)
      ||!['suspense_state','children'].includes(renderer.selection)||![0,8].includes(renderer.strict_render_mask)
      ||![0,16].includes(renderer.strict_effect_mask))return {valid:false,reason:'unsupported_boundary_renderer_semantics'};
    if(rule.fragment!==null){
      const fragment=rule.fragment;
      if(!fragment||Object.keys(fragment).sort().join(',')!=='extra_props,key_match,ref,type_tag'
        ||!['key_or_index','index_only'].includes(fragment.key_match)||![7,8].includes(fragment.type_tag)
        ||!['ignore','attach'].includes(fragment.ref)||!['ignore','forward'].includes(fragment.extra_props))return {valid:false,reason:'unsupported_fragment_semantics'};
    }
    if(rule.profiler!==null){
      const p=rule.profiler;
      if(!p||Object.keys(p).sort().join(',')!=='arguments,callback,mount_phase,nested_phase,phase,profile_mask,result,update_mask,update_phase'
        ||!['onRender','onCommit'].includes(p.callback)||!['layout_commit','passive_commit'].includes(p.phase)
        ||![2,8].includes(p.profile_mask)||![4,8].includes(p.update_mask)
        ||!Array.isArray(p.arguments)||p.arguments.length!==6||p.arguments.some(a=>!['id','phase','actualDuration','treeBaseDuration','actualStartTime','commitTime'].includes(a))
        ||!['mount','update'].includes(p.mount_phase)||!['mount','update'].includes(p.update_phase)
        ||!['nested-update','update'].includes(p.nested_phase)||!['ignore','forward'].includes(p.result))return {valid:false,reason:'unsupported_profiler_semantics'};
    }
    return {valid:true,reason:null};
  }
  if(rule.kind==='component_wrapper') {
    const keys=['schema','kind','allocation','marker','component_argument','component_field','compare_argument','compare_field','missing_compare','callbacks_at_creation','render_ref'];
    if(Object.keys(rule).length!==keys.length || Object.keys(rule).some(key=>!keys.includes(key)))return {valid:false,reason:'unexpected_or_missing_rule_field'};
    const index=value=>Number.isSafeInteger(value) && value>=0 && value<16;
    if(rule.schema!=='producttrace.react-execution-rule.v1' || !['per_call','shared'].includes(rule.allocation)
      || typeof rule.marker!=='string' || !rule.marker || !index(rule.component_argument)
      || !['render','type'].includes(rule.component_field) || !(rule.compare_argument===null || index(rule.compare_argument))
      || !(rule.compare_field===null || rule.compare_field==='compare') || (rule.compare_argument===null)!==(rule.compare_field===null)
      || !['null','undefined'].includes(rule.missing_compare) || !['none','invoke'].includes(rule.callbacks_at_creation))return {valid:false,reason:'unsupported_component_wrapper_semantics'};
    if(rule.render_ref!==null && (!rule.render_ref || Object.keys(rule.render_ref).sort().join(',')!=='argument,fiber_tag,field'
      || !index(rule.render_ref.argument) || !['ref','stateNode'].includes(rule.render_ref.field)
      || ![11,14,15].includes(rule.render_ref.fiber_tag)))return {valid:false,reason:'unsupported_wrapper_ref_semantics'};
    return {valid:true,reason:null};
  }
  if(rule.kind==='deferred_value') {
    const keys=['schema','kind','owner','value_argument','comparison','mount','urgent','nonurgent','schedule_changed'];
    if(Object.keys(rule).length!==keys.length || Object.keys(rule).some(key=>!keys.includes(key)))return {valid:false,reason:'unexpected_or_missing_rule_field'};
    if(rule.schema!=='producttrace.react-execution-rule.v1' || rule.owner!=='mounted_hook'
      || !Number.isSafeInteger(rule.value_argument) || rule.value_argument<0 || rule.value_argument>15
      || !['Object.is','strict_equal'].includes(rule.comparison) || !['input','previous'].includes(rule.mount)
      || !['input','previous'].includes(rule.urgent) || !['input','previous'].includes(rule.nonurgent)
      || typeof rule.schedule_changed!=='boolean')return {valid:false,reason:'unsupported_deferred_value_semantics'};
    return {valid:true,reason:null};
  }
  if(rule.kind==='transition_hook') {
    const keys=['schema','kind','owner','pending_index','start_index','retain_start','start_rule'];
    if(Object.keys(rule).length!==keys.length || Object.keys(rule).some(key=>!keys.includes(key)))return {valid:false,reason:'unexpected_or_missing_rule_field'};
    if(rule.schema!=='producttrace.react-execution-rule.v1' || rule.owner!=='mounted_hook'
      || ![rule.pending_index,rule.start_index].every(index=>Number.isSafeInteger(index) && index>=0 && index<16)
      || rule.pending_index===rule.start_index || typeof rule.retain_start!=='boolean'
      || rule.start_rule?.kind!=='synchronous_scope' || !validateReactExecutionRule(rule.start_rule).valid)return {valid:false,reason:'unsupported_transition_hook_semantics'};
    return {valid:true,reason:null};
  }
  if(rule.kind==='id_allocation') {
    const keys=['schema','kind','owner','retain_on_update','client_marker','server_marker','local_marker','separator','radix'];
    if(Object.keys(rule).length!==keys.length || Object.keys(rule).some(key=>!keys.includes(key)))return {valid:false,reason:'unexpected_or_missing_rule_field'};
    if(rule.schema!=='producttrace.react-execution-rule.v1' || rule.owner!=='mounted_hook' || typeof rule.retain_on_update!=='boolean'
      || !['client_marker','server_marker','local_marker','separator'].every(key=>typeof rule[key]==='string' && rule[key].length===1)
      || !Number.isSafeInteger(rule.radix) || rule.radix<2 || rule.radix>36)return {valid:false,reason:'unsupported_id_allocation_semantics'};
    return {valid:true,reason:null};
  }
  if(rule.kind==='external_store') {
    const keys=['schema','kind','subscribe_argument','snapshot_argument','server_snapshot_argument','subscription_phase','comparison','resubscribe','strict_mount_rehearsal','snapshot_throw','notification_arguments'];
    const index=value=>Number.isSafeInteger(value) && value>=0 && value<16;
    if(Object.keys(rule).length!==keys.length || Object.keys(rule).some(key=>!keys.includes(key)))return {valid:false,reason:'unexpected_or_missing_rule_field'};
    if(rule.schema!=='producttrace.react-execution-rule.v1' || ![rule.subscribe_argument,rule.snapshot_argument,rule.server_snapshot_argument].every(index)
      || new Set([rule.subscribe_argument,rule.snapshot_argument,rule.server_snapshot_argument]).size!==3
      || !['passive','layout'].includes(rule.subscription_phase) || !['Object.is','strict_equal'].includes(rule.comparison)
      || !['subscribe_identity','every_commit'].includes(rule.resubscribe) || typeof rule.strict_mount_rehearsal!=='boolean'
      || !['request_update','ignore'].includes(rule.snapshot_throw) || rule.notification_arguments!=='ignored')return {valid:false,reason:'unsupported_external_store_semantics'};
    return {valid:true,reason:null};
  }
  if(rule.kind==='imperative_handle') {
    const keys=['schema','kind','ref_argument','factory_argument','dependencies_argument','phase','skip_null_ref','include_ref_dependency','comparison','object_property','cleanup_value','strict_mount_rehearsal','callback_ref_return'];
    const index=value=>Number.isSafeInteger(value) && value>=0 && value<16;
    if(Object.keys(rule).length!==keys.length || Object.keys(rule).some(key=>!keys.includes(key)))return {valid:false,reason:'unexpected_or_missing_rule_field'};
    if(rule.schema!=='producttrace.react-execution-rule.v1' || ![rule.ref_argument,rule.factory_argument,rule.dependencies_argument].every(index)
      || new Set([rule.ref_argument,rule.factory_argument,rule.dependencies_argument]).size!==3
      || !['layout','passive','insertion'].includes(rule.phase) || typeof rule.skip_null_ref!=='boolean'
      || typeof rule.include_ref_dependency!=='boolean' || !['Object.is','strict_equal'].includes(rule.comparison)
      || typeof rule.object_property!=='string' || !rule.object_property || !['null','undefined'].includes(rule.cleanup_value)
      || typeof rule.strict_mount_rehearsal!=='boolean' || rule.callback_ref_return!=='ignore')return {valid:false,reason:'unsupported_imperative_handle_semantics'};
    return {valid:true,reason:null};
  }
  if(rule.kind==='context_binding') {
    const keys=['schema','kind','mode','default_argument','matching','selection','undefined_provider','function_value','change_comparison'];
    if(Object.keys(rule).length!==keys.length || Object.keys(rule).some(key=>!keys.includes(key)))return {valid:false,reason:'unexpected_or_missing_rule_field'};
    if(rule.schema!=='producttrace.react-execution-rule.v1' || !['create','read'].includes(rule.mode)
      || !Number.isSafeInteger(rule.default_argument) || rule.default_argument<0 || rule.default_argument>15
      || rule.matching!=='identity' || !['nearest','farthest'].includes(rule.selection)
      || !['value','default'].includes(rule.undefined_provider) || rule.function_value!=='store'
      || !['Object.is','strict_equal'].includes(rule.change_comparison))return {valid:false,reason:'unsupported_context_binding_semantics'};
    return {valid:true,reason:null};
  }
  if(rule.kind==='ref_cell') {
    const keys=['schema','kind','allocation','initial','argument','property','function_input','write_scheduling','sealed'];
    if(Object.keys(rule).length!==keys.length || Object.keys(rule).some(key=>!keys.includes(key)))return {valid:false,reason:'unexpected_or_missing_rule_field'};
    if(rule.schema!=='producttrace.react-execution-rule.v1' || !['per_call','mounted_hook'].includes(rule.allocation)
      || !['null','argument'].includes(rule.initial) || !Number.isSafeInteger(rule.argument) || rule.argument<0 || rule.argument>15
      || typeof rule.property!=='string' || !rule.property || rule.function_input!=='store'
      || rule.write_scheduling!=='none' || !rule.sealed || Object.keys(rule.sealed).sort().join(',')!=='development,production'
      || !Object.values(rule.sealed).every(value=>typeof value==='boolean'))return {valid:false,reason:'unsupported_ref_cell_semantics'};
    return {valid:true,reason:null};
  }
  if(rule.kind==='element_predicate') {
    const keys=['schema','kind','argument','input_kind','exclude_null','marker_property','marker_symbol','comparison','result','property_access'];
    if(Object.keys(rule).length!==keys.length || Object.keys(rule).some(key=>!keys.includes(key)))return {valid:false,reason:'unexpected_or_missing_rule_field'};
    if(rule.schema!=='producttrace.react-execution-rule.v1' || !Number.isSafeInteger(rule.argument) || rule.argument<0 || rule.argument>15
      || !['object','function'].includes(rule.input_kind) || typeof rule.exclude_null!=='boolean'
      || typeof rule.marker_property!=='string' || !rule.marker_property || typeof rule.marker_symbol!=='string' || !rule.marker_symbol
      || rule.comparison!=='strict_equal' || rule.result!=='boolean' || rule.property_access!=='ordinary_get')return {valid:false,reason:'unsupported_element_predicate_semantics'};
    return {valid:true,reason:null};
  }
  if(rule.kind==='test_scope') {
    const keys=['schema','kind','callback_argument','callback_arguments','development','production','callback_timing','result','callback_exceptions','completion'];
    const index=value=>Number.isSafeInteger(value) && value>=0 && value<16;
    if(Object.keys(rule).length!==keys.length || Object.keys(rule).some(key=>!keys.includes(key)))return {valid:false,reason:'unexpected_or_missing_rule_field'};
    if(rule.schema!=='producttrace.react-execution-rule.v1' || !index(rule.callback_argument)
      || !Array.isArray(rule.callback_arguments) || rule.callback_arguments.length>8 || !rule.callback_arguments.every(index)
      || !['invoke','throw_before_callback'].includes(rule.development) || !['invoke','throw_before_callback'].includes(rule.production)
      || !['synchronous','deferred'].includes(rule.callback_timing) || !['thenable','callback_result'].includes(rule.result)
      || !['propagate','wrap'].includes(rule.callback_exceptions) || !['outermost_queue_drain','callback_return'].includes(rule.completion))return {valid:false,reason:'unsupported_test_scope_semantics'};
    return {valid:true,reason:null};
  }
  if(rule.kind==='synchronous_scope') {
    const keys=['schema','kind','callback_argument','callback_arguments','missing_callback','result','exceptions','scheduling','transition_context','async_continuation'];
    const index=value=>Number.isSafeInteger(value) && value>=0 && value<16;
    if(Object.keys(rule).length!==keys.length || Object.keys(rule).some(key=>!keys.includes(key)))return {valid:false,reason:'unexpected_or_missing_rule_field'};
    if(rule.schema!=='producttrace.react-execution-rule.v1' || !index(rule.callback_argument)
      || !Array.isArray(rule.callback_arguments) || rule.callback_arguments.length>8 || !rule.callback_arguments.every(index)
      || !['required','skip_falsy'].includes(rule.missing_callback) || !['undefined','callback_result'].includes(rule.result)
      || !['propagate','callback_or_flush_error'].includes(rule.exceptions) || !['transition','sync_flush','legacy_batch'].includes(rule.scheduling)
      || !['new','clear','preserve'].includes(rule.transition_context) || rule.async_continuation!=='outside_scope')return {valid:false,reason:'unsupported_synchronous_scope_semantics'};
    return {valid:true,reason:null};
  }
  if(rule.kind==='state_queue') {
    const keys=['schema','kind','initial_argument','initializer_argument','initializer_mode','update_mode','reducer_argument','owner','comparison',
      'queue_order','priority','dispatch_identity','commit','calculation_error','unmounted_dispatch','strict_mode'];
    if(Object.keys(rule).length!==keys.length || Object.keys(rule).some(key=>!keys.includes(key)))return {valid:false,reason:'unexpected_or_missing_rule_field'};
    const index=value=>Number.isSafeInteger(value) && value>=0 && value<16;
    if(rule.schema!=='producttrace.react-execution-rule.v1' || !index(rule.initial_argument) || !index(rule.initializer_argument)
      || !['if_function','if_provided'].includes(rule.initializer_mode)
      || !['functional_or_replace','reducer'].includes(rule.update_mode)
      || (rule.update_mode==='reducer'?!index(rule.reducer_argument):rule.reducer_argument!==null)
      || rule.owner!=='mounted_hook' || rule.comparison!=='Object.is'
      || rule.queue_order!=='dispatch_order'||rule.priority!=='lane_rebase'||rule.dispatch_identity!=='stable_per_mount'
      ||rule.commit!=='successful_render_only'||rule.calculation_error!=='propagate_without_commit'
      ||rule.unmounted_dispatch!=='ignore_without_commit'||rule.strict_mode!=='development_replay')return {valid:false,reason:'unsupported_state_queue_semantics'};
    return {valid:true,reason:null};
  }
  if(rule.kind==='literal_export') {
    const keys=['schema','kind','values','callbacks','scheduling'];
    if(Object.keys(rule).length!==keys.length || Object.keys(rule).some(key=>!keys.includes(key))) {
      return {valid:false,reason:'unexpected_or_missing_rule_field'};
    }
    if(rule.schema!=='producttrace.react-execution-rule.v1' || !rule.values || Object.keys(rule.values).sort().join(',')!=='development,production'
      || !Object.values(rule.values).every(value=>typeof value==='string')
      || rule.callbacks!=='none' || rule.scheduling!=='none')return {valid:false,reason:'unsupported_literal_export_semantics'};
    return {valid:true,reason:null};
  }
  const keys=rule.kind==='commit_effect'?[...KEYS,'phase','strict_mount_rehearsal']:KEYS;
  if (Object.keys(rule).length !== keys.length || Object.keys(rule).some(key => !keys.includes(key))) {
    return {valid:false, reason:'unexpected_or_missing_rule_field'};
  }
  if (rule.schema !== 'producttrace.react-execution-rule.v1' || !['retained_callback','commit_effect','memo_value'].includes(rule.kind)) {
    return {valid:false, reason:'unsupported_rule_instruction'};
  }
  if (![rule.callback_argument,rule.dependencies_argument].every(index => Number.isSafeInteger(index) && index >= 0 && index < 16)
      || rule.callback_argument === rule.dependencies_argument) return {valid:false, reason:'invalid_argument_slots'};
  if (rule.owner !== 'mounted_hook' || rule.comparison !== 'Object.is'
      || rule.result !== (rule.kind==='commit_effect'?'cleanup_or_void':rule.kind==='memo_value'?'cached_value':'callback_identity')) {
    return {valid:false, reason:'unsupported_rule_semantics'};
  }
  if(rule.kind==='commit_effect' && (!['passive','layout','insertion'].includes(rule.phase)
    || typeof rule.strict_mount_rehearsal!=='boolean'))return {valid:false,reason:'invalid_effect_phase'};
  return {valid:true, reason:null};
}
