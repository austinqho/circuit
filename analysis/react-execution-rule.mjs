export {planReactClassUpdate} from './react-class-update-plan.mjs';
export {planReactClassOperation} from './react-class-plan.mjs';
export {planReactLegacyRender} from './react-legacy-render-plan.mjs';
export {planReactLegacyUnmount} from './react-legacy-unmount-plan.mjs';
export {planReactHostLookup} from './react-host-plan.mjs';
export {planReactServerString,planReactLegacyServerStream,planReactReadableStream,planReactPipeableStream} from './react-server-plan.mjs';
export {planElementConstruction,planElementClone,planElementFactory} from './react-element-plan.mjs';
export {planReactLazyStep} from './react-lazy-plan.mjs';
export {planReactRootOperation} from './react-root-plan.mjs';
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
