import {validateReactExecutionRule,planReactHostLookup,planReactLegacyUnmount,planReactLegacyRender} from './react-execution-rule.mjs';
export function createReactHostEvidenceSession({fingerprint,entries,resolveAction}) {
 const indexed=new Map(entries.filter(row=>row.host_rule).map(row=>[row.key,row])),seen=new Set();
 return {join(record){
  const fail=reason=>({schema:'producttrace.react-host-join.v1',status:'unresolved',reason,runtime_observed:false,source:null,runtime:null});
  const scoped=id=>typeof record?.session==='string'&&record.session.length>0&&typeof id==='string'&&id.startsWith(record.session+':')&&id.length>record.session.length+1;
  if(record?.schema!=='producttrace.react-host-observation.v1'||record.kind!=='react_host'||record.runtime_observed!==true||record.map_fingerprint!==fingerprint
   ||!scoped(record.observation_id)||record.occurrence_id!==record.observation_id+':occurrence'||!Array.isArray(record.evidence_ids)||!record.evidence_ids.includes(record.observation_id)||!record.evidence_ids.every(scoped))return fail('invalid_host_observation');
  const entry=indexed.get(record.manifest_key),rule=entry?.host_rule;
  if(!entry||record.source_call_id!==entry.source_call_id||record.semantic_id!==entry.semantic_id||!entry.package_verification_sha256
    ||!validateReactExecutionRule(rule).valid||!['host_lookup','legacy_unmount','legacy_render'].includes(rule.kind))return fail('host_source_rule_required');
  if(record.frontier)return fail(record.frontier);if(seen.has(record.observation_id))return fail('duplicate_host_observation');
  const token=value=>value&&scoped(value.identity)&&['object','function','undefined','null','string','number','boolean','symbol','bigint'].includes(value.kind)
   &&(value.encoding==='redacted'?value.value===null:value.encoding==='primitive'&&(value.kind==='null'?value.value===null:['string','number','boolean'].includes(value.kind)&&typeof value.value===value.kind&&(value.kind!=='number'||Number.isFinite(value.value))));
  if(!token(record.input)||!token(record.result)||!record.inputs||Object.keys(record.inputs).length!==entry.host_argument_count||!Object.values(record.inputs).every(token))return fail('host_values_required');
  const input=record.inputs[rule.argument];if(input?input.identity!==record.input.identity:record.input.kind!=='undefined')return fail('host_argument_identity_mismatch');
  const lookup=record.lookup,values=[record.input,record.result,...Object.values(record.inputs)];
  if(rule.kind==='legacy_render'){
   if(!lookup||lookup.kind!=='legacy_render'||lookup.container_identity!==record.input.identity||record.input.kind!=='object'
    ||lookup.basis!=='react-devtools-commit.v1'||![1,9,11].includes(lookup.nodeType)||!Number.isSafeInteger(lookup.commit_floor)||lookup.commit_floor<0)return fail('legacy_render_container_required');
   const element=record.inputs[rule.element_argument],after=lookup.after;
   if(!token(element)||!token(lookup.element)||lookup.element.identity!==element.identity)return fail('legacy_render_element_required');
   if(!after||after.state!=='committed'||!token(after.element)||after.element.identity!==element.identity||!token(after.public_instance)||!token(after.root)||after.root.kind!=='object'
    ||after.root.identity===record.input.identity||!/^react-root:[1-9][0-9]*$/.test(after.renderer_root_id)||!/^react-commit:[1-9][0-9]*$/.test(after.commit_id)
    ||Number(after.commit_id.split(':')[1])<=lookup.commit_floor||after.first_child_tag!==null&&(!Number.isInteger(after.first_child_tag)||after.first_child_tag<0||after.first_child_tag>30))return fail('legacy_render_commit_unconfirmed');
   if(after.first_child_tag===null&&after.public_instance.kind!=='null')return fail('legacy_render_empty_result_mismatch');
   if(rule.parent_argument!==null){const parent=record.inputs[rule.parent_argument];
    if(!token(parent)||parent.kind!=='object'||lookup.parent?.identity!==parent.identity||!/^react-root:[1-9][0-9]*$/.test(lookup.parent?.root_id))return fail('legacy_render_parent_required');
   }else if(lookup.parent!==null)return fail('legacy_render_unexpected_parent');
   const descriptions=new Map();for(const value of [...values,lookup.element,after.element,after.root,after.public_instance]){const previous=descriptions.get(value.identity);if(previous&&['kind','encoding','value'].some(key=>!Object.is(previous[key],value[key])))return fail('host_value_identity_conflict');descriptions.set(value.identity,value);}
   const plan=planReactLegacyRender(rule,{args:Array.from({length:entry.host_argument_count},(_,index)=>record.inputs[index]),rootState:'unobserved',publicInstance:after.public_instance,parentValid:rule.parent_argument===null||!!lookup.parent});
   if(plan.status!=='planned'||record.operation!=='returned'||plan.result?.identity!==record.result.identity)return fail('legacy_render_result_mismatch');
   const action=record.action?resolveAction?.(record.action):null;if(record.action&&!action)return fail('host_action_unconfirmed');
   seen.add(record.observation_id);
   return {schema:'producttrace.react-host-join.v1',status:'resolved',reason:null,runtime_observed:true,
    source:{source_call_id:entry.source_call_id,semantic_id:entry.semantic_id},runtime:{claim:'observed_legacy_element_commit_and_public_result',
     result:structuredClone(record.result),element:structuredClone(element),root_id:after.renderer_root_id,commit_id:after.commit_id,action:action?structuredClone(action):null,
     callback_completion_proven:false,hydration_reuse_proven:false,parent_context_propagation_proven:false,component_body_execution_proven:false}};
  }
  if(rule.kind==='legacy_unmount'){
   if(!lookup||lookup.kind!=='legacy_unmount'||lookup.container_identity!==record.input.identity||record.input.kind!=='object'
      ||lookup.basis!=='react-devtools-commit.v1'||![1,9,11].includes(lookup.nodeType))return fail('legacy_unmount_container_required');
   const before=lookup.before,after=lookup.after;
   if(!before||!after||!['legacy','absent'].includes(before.state))return fail('legacy_unmount_root_required');
   const plan=planReactLegacyUnmount(rule,{args:Array.from({length:entry.host_argument_count},(_,index)=>record.inputs[index]),nodeType:lookup.nodeType,rootKind:before.state==='legacy'?'legacy':'none'});
   if(plan.status!=='planned'||record.operation!=='returned'||record.result.kind!=='boolean'||record.result.encoding!=='primitive'||record.result.value!==plan.result)return fail('legacy_unmount_result_mismatch');
   if(before.state==='legacy'){
    if(!token(before.root)||before.root.kind!=='object'||before.root.identity===record.input.identity||!token(after.root)||after.root.identity!==before.root.identity
      ||after.root.kind!==before.root.kind||after.root.encoding!==before.root.encoding||after.root.value!==before.root.value
      ||typeof before.renderer_root_id!=='string'||!/^react-root:[1-9][0-9]*$/.test(before.renderer_root_id)||after.renderer_root_id!==before.renderer_root_id
      ||!/^react-commit:[1-9][0-9]*$/.test(before.commit_id)||!/^react-commit:[1-9][0-9]*$/.test(after.commit_id)
      ||Number(after.commit_id.split(':')[1])<=Number(before.commit_id.split(':')[1])||after.state!=='unmounted'||after.empty_root!==true)return fail('legacy_unmount_commit_unconfirmed');
   }else if(after.state!=='absent'||before.root!==undefined||after.root!==undefined)return fail('legacy_unmount_absence_unconfirmed');
   const descriptions=new Map();for(const value of [...values,...(before.root?[before.root,after.root]:[])]){const previous=descriptions.get(value.identity);if(previous&&['kind','encoding','value'].some(key=>!Object.is(previous[key],value[key])))return fail('host_value_identity_conflict');descriptions.set(value.identity,value);}
   const action=record.action?resolveAction?.(record.action):null;if(record.action&&!action)return fail('host_action_unconfirmed');
   seen.add(record.observation_id);
   return {schema:'producttrace.react-host-join.v1',status:'resolved',reason:null,runtime_observed:true,
    source:{source_call_id:entry.source_call_id,semantic_id:entry.semantic_id},runtime:{claim:before.state==='legacy'?'observed_legacy_root_unmount':'observed_legacy_unmount_noop',
     result:structuredClone(record.result),action:action?structuredClone(action):null,root_id:before.renderer_root_id||null,
     empty_root_commit:before.state==='legacy'?after.commit_id:null,cleanup_completion_proven:false,downstream_effect_proven:false}};
  }

  if(!lookup||!['nullish','native_node','current_class','unmounted_class'].includes(lookup.kind))return fail('host_lookup_context_required');
  if(lookup.kind==='nullish'&&!['null','undefined'].includes(record.input.kind))return fail('host_nullish_input_mismatch');
  if(lookup.kind==='native_node'&&(record.input.kind!=='object'||!Number.isInteger(lookup.nodeType)))return fail('host_native_input_mismatch');
  if(['current_class','unmounted_class'].includes(lookup.kind)){
   if(record.input.kind!=='object'||lookup.input_identity!==record.input.identity||lookup.basis!=='react-devtools-commit.v1')return fail('host_class_origin_required');
   let count=0;const visited=new Set();
   const visit=(node,depth=0)=>{if(visited.has(node)||++count>2000||depth>100)throw Error();visited.add(node);if(!node||!Array.isArray(node.children)||typeof node.complete!=='boolean')throw Error();if(node.value){if(!token(node.value))throw Error();values.push(node.value);}node.children.forEach(child=>visit(child,depth+1));};
   try{if(lookup.kind==='current_class')visit(lookup.tree);}catch(_){return fail('host_tree_values_required');}
  }
  const descriptions=new Map();for(const value of values){const previous=descriptions.get(value.identity);if(previous&&['kind','encoding','value'].some(key=>!Object.is(previous[key],value[key])))return fail('host_value_identity_conflict');descriptions.set(value.identity,value);}
  const rawInput=record.input.kind==='null'?null:record.input.kind==='undefined'?undefined:record.input;
  const plan=planReactHostLookup(rule,{input:rawInput,nodeType:lookup.nodeType,mounted:lookup.kind==='current_class'?true:lookup.kind==='unmounted_class'?false:undefined,currentTree:lookup.tree});
  if(plan.status!=='planned')return fail(plan.reason||'host_selection_unresolved');
  if(plan.operation==='throw')return fail('host_throw_origin_unobserved');
  if(record.operation!=='returned'||(plan.value===null?record.result.kind!=='null':!token(plan.value)||plan.value.identity!==record.result.identity))return fail('host_selected_result_mismatch');
  const action=record.action?resolveAction?.(record.action):null;if(record.action&&!action)return fail('host_action_unconfirmed');
  seen.add(record.observation_id);
  return {schema:'producttrace.react-host-join.v1',status:'resolved',reason:null,runtime_observed:true,
   source:{source_call_id:entry.source_call_id,semantic_id:entry.semantic_id},runtime:{claim:'observed_host_selection',selection:plan.selection||'nullish',
    result:structuredClone(record.result),action:action?structuredClone(action):null,host_effect_proven:false}};
 }};
}
