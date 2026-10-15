import {checkReactDescriptorCommit} from './react-descriptor-commit.mjs';
import {validateReactExecutionRule} from './react-execution-rule.mjs';
export function createReactElementEvidenceSession({fingerprint,entries,rendererKnown=()=>false}) {
 const descriptions=new Map();
 const byKey=new Map(entries.filter(entry=>entry.element_rule).map(entry=>[entry.key,entry])),seen=new Set(),byResult=new Map(),factories=new Map(),lazyOrigins=new Map();
 return {join(record){
  if(record?.kind==='react_descriptor_commit'){
    const result=checkReactDescriptorCommit(record,descriptions.get(record.description_observation_id),{fingerprint,session:record.session,rendererKnown:rendererKnown(record)});
    if(result.status==='resolved'){
      if(seen.has(record.observation_id))return {status:'unresolved',reason:'duplicate_descriptor_commit',runtime_observed:false};
      seen.add(record.observation_id);
    }
    return result;
  }

  const fail=reason=>({schema:'producttrace.react-element-join.v1',status:'unresolved',reason,runtime_observed:false,source:null,runtime:null,observation_id:record?.observation_id});
  if(record?.schema!=='producttrace.react-element-observation.v1' || record.kind!=='react_element'
   || record.runtime_observed!==true || record.map_fingerprint!==fingerprint || typeof record.session!=='string' || !record.session)return fail('invalid_element_observation');
  const scoped=value=>typeof value==='string' && value.startsWith(record.session+':') && value!==record.session+':';
  if(!scoped(record.observation_id) || record.occurrence_id!==record.observation_id+':occurrence'
   || !Array.isArray(record.evidence_ids) || !record.evidence_ids.includes(record.observation_id)
   || !record.evidence_ids.every(scoped))return fail('element_occurrence_required');
  const entry=byKey.get(record.manifest_key),program=entry?.element_rule;
  const factory=program?.kind==='element_factory',factoryCall=factory&&Boolean(entry.factory_producer_call_id);
  const rule=factory?program.construction:program;
  if(!entry || entry.source_call_id!==record.source_call_id || entry.semantic_id!==record.semantic_id
   || !entry.package_verification_sha256 || !validateReactExecutionRule(program).valid || !['element_construction','element_clone','element_factory','lazy_component'].includes(program.kind))return fail('element_source_rule_required');
  if(program.kind==='lazy_component'){
   if(record.frontier)return fail(record.frontier);
   if(seen.has(record.observation_id))return fail('duplicate_element_observation');
   const token=value=>value&&scoped(value.identity)&&['null','undefined','object','function','string','number','boolean','symbol','bigint'].includes(value.kind)
     &&(value.encoding==='redacted'?value.value===null&&!['null','string','boolean'].includes(value.kind)
       :value.encoding==='primitive'&&(value.kind==='null'?value.value===null:['string','number','boolean'].includes(value.kind)&&typeof value.value===value.kind&&(value.kind!=='number'||Number.isFinite(value.value))));
   if(!token(record.result))return fail('lazy_result_value_required');
   let runtime;
   if(record.operation==='returned'){
    const loader=record.inputs?.[program.loader_argument];
    if(record.marker!=='react.lazy'||record.result.kind!=='object'||!token(loader)||loader.identity===record.result.identity||program.creation!=='store')return fail('lazy_allocation_required');
    if([...lazyOrigins.values()].some(origin=>origin.lazy_identity===record.result.identity))return fail('lazy_allocation_identity_reused');
    lazyOrigins.set(record.observation_id,{session:record.session,lazy_identity:record.result.identity,loader_identity:loader.identity,
      source_call_id:entry.source_call_id,loader_kind:loader.kind,loader:structuredClone(loader),value:structuredClone(record.result),source_id:entry.lazy_loader_source_id});
    runtime={claim:'observed_lazy_allocation',lazy_identity:record.result.identity,loader_invoked:false};
   }else{
    const origin=lazyOrigins.get(record.creation_observation_id);
    if(!origin||origin.session!==record.session||origin.source_call_id!==entry.source_call_id||origin.lazy_identity!==record.lazy_identity
      ||origin.loader_identity!==record.loader_identity||origin.loader_kind!=='function')return fail('lazy_loader_origin_unobserved');
    if(!entry.lazy_loader_source_id||record.source_id!==entry.lazy_loader_source_id||origin.source_id!==record.source_id)return fail('lazy_loader_source_unproven');
    if(['loader_returned','loader_threw'].includes(record.operation)){
     if(!Array.isArray(record.arguments)||record.arguments.length)return fail('lazy_loader_completion_required');
     for(const value of [origin.loader,origin.value])if(value.identity===record.result.identity&&['kind','encoding','value'].some(key=>!Object.is(value[key],record.result[key])))return fail('lazy_value_identity_conflict');
     if(origin.loader_observation)return fail('duplicate_lazy_loader_observation');
     origin.loader_observation={observation_id:record.observation_id,outcome:record.operation==='loader_returned'?'returned':'threw',
       result:structuredClone(record.result),thenable_protocol:record.thenable_protocol||null,
       settlement_frontier:record.settlement_frontier||null};
     runtime={claim:'observed_lazy_loader_completion',creation_observation_id:record.creation_observation_id,lazy_identity:record.lazy_identity,
       source_id:record.source_id,outcome:origin.loader_observation.outcome,result:structuredClone(record.result),
       thenable_settlement_observed:false,module_selection_observed:false,captured_values_observed:false,
       settlement_frontier:origin.loader_observation.settlement_frontier};
    }else if(['loader_fulfilled','loader_rejected'].includes(record.operation)){
     const loader=origin.loader_observation;
     if(!loader||loader.outcome!=='returned'||loader.observation_id!==record.loader_observation_id
       ||loader.thenable_protocol!=='native_promise.v1'||loader.result.identity!==record.thenable_identity)
       return fail('lazy_native_promise_loader_required');
     if(origin.settlement_observation)return fail('duplicate_lazy_settlement');
     if(!token(record.result))return fail('lazy_settlement_value_required');
     if(record.operation==='loader_fulfilled'&&record.result.identity===record.thenable_identity)
       return fail('lazy_promise_self_resolution_invalid');
     if([origin.loader,origin.value].some(value=>value.identity===record.result.identity
       &&['kind','encoding','value'].some(key=>!Object.is(value[key],record.result[key]))))return fail('lazy_value_identity_conflict');
     origin.settlement_observation={observation_id:record.observation_id,
       outcome:record.operation==='loader_fulfilled'?'fulfilled':'rejected',result:structuredClone(record.result)};
     runtime={claim:'observed_lazy_loader_settlement',creation_observation_id:record.creation_observation_id,
       loader_observation_id:record.loader_observation_id,lazy_identity:record.lazy_identity,source_id:record.source_id,
       thenable_identity:record.thenable_identity,outcome:origin.settlement_observation.outcome,
       result:structuredClone(record.result),thenable_settlement_observed:true,module_selection_observed:false,
       captured_values_observed:false};
    }else return fail('lazy_loader_completion_required');
   }
   seen.add(record.observation_id);
   return {schema:'producttrace.react-element-join.v1',status:'resolved',reason:null,observation_id:record.observation_id,runtime_observed:true,
     source:{source_call_id:entry.source_call_id,semantic_id:entry.semantic_id},runtime:{...runtime,host_commit_proven:false}};
  }
  if(record.operation!=='returned')return fail(record.operation==='threw'?'element_call_or_argument_threw':'element_operation_unsupported');
  if(record.frontier)return fail(record.frontier);
  if(seen.has(record.observation_id))return fail('duplicate_element_observation');
  const encoded=value=>value && scoped(value.identity) && ['null','undefined','object','function','string','number','boolean','symbol','bigint'].includes(value.kind)
   && (value.encoding==='primitive' ? value.kind==='null'?value.value===null:['string','boolean','number'].includes(value.kind)
      && typeof value.value===value.kind && (value.kind!=='number'||Number.isFinite(value.value))
     :value.encoding==='redacted' && value.value===null && !['null','string','boolean'].includes(value.kind));
  if(factory&&!factoryCall){
   const type=record.inputs?.[program.type_argument];
   if(!encoded(type)||!encoded(record.result)||record.result.kind!=='function'||program.allocation!=='per_call'||program.creation_callbacks!=='store')return fail('element_factory_result_required');
   const inputs=new Map();
   for(const value of [...Object.values(record.inputs),record.result]){
    if(!encoded(value))return fail('element_value_invalid');
    const previous=inputs.get(value.identity);
    if(previous&&['kind','encoding','value'].some(key=>!Object.is(previous[key],value[key])))return fail('element_value_identity_conflict');
    inputs.set(value.identity,value);
   }
   if(factories.has(record.result.identity))return fail('element_factory_allocation_conflict');
   if(type.identity===record.result.identity)return fail('element_factory_type_identity_conflict');
   seen.add(record.observation_id);factories.set(record.result.identity,{session:record.session,observation_id:record.observation_id,source_call_id:entry.source_call_id,type:structuredClone(type)});
   return {schema:'producttrace.react-element-join.v1',status:'resolved',reason:null,observation_id:record.observation_id,runtime_observed:true,
    source:{source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,type_argument:program.type_argument},
    runtime:{claim:'observed_element_factory',function_identity:record.result.identity,type:structuredClone(type),bound_type_proven:false,renderer_execution_proven:false,host_commit_proven:false}};
  }
  const factoryOrigin=factoryCall&&encoded(record.target)?factories.get(record.target.identity):null;
  if(factoryCall&&(!factoryOrigin||record.target.kind!=='function'||factoryOrigin.session!==record.session||factoryOrigin.source_call_id!==entry.factory_producer_call_id))return fail('element_factory_origin_unobserved');
  const fields=record.fields,inputs=record.inputs,clone=rule.kind==='element_clone',original=clone?inputs?.[rule.element_argument]:null;
  const origin=clone&&encoded(original)?byResult.get(original.identity):null;
  if(clone && (!origin || origin.session!==record.session))return fail('element_clone_origin_unobserved');
  const type=factoryCall?factoryOrigin.type:clone?origin.type:inputs?.[rule.type_argument];
  if(record.result?.kind!=='object' || !encoded(record.result) || record.marker!==rule.marker
   || fields?.['$$typeof']?.kind!=='symbol' || !encoded(fields['$$typeof'])
   || !encoded(type) || !encoded(fields?.type) || !(fields.type.identity===type.identity || (clone||factoryCall)&&type.kind===fields.type.kind&&(type.kind==='undefined'||type.encoding==='primitive'&&fields.type.encoding==='primitive'&&Object.is(type.value,fields.type.value)))
   || !encoded(fields.props) || fields.props.kind!=='object' || !encoded(fields.key) || !['null','string'].includes(fields.key.kind)
   || !encoded(fields.ref) || !encoded(fields._owner) || rule.callbacks_at_creation!=='store')return fail('element_description_input_mismatch');
  const expectedProperties=entry.element_property_inputs||[],propertyInputs=record.property_inputs??[];
  if(!Array.isArray(expectedProperties)||!Array.isArray(propertyInputs)||propertyInputs.length!==expectedProperties.length)
    return fail('element_property_input_observation_required');
  const expectedOutputs=[...new Set(expectedProperties.filter(row=>row.target==='props').map(row=>row.name))];
  const propertyOutputs=record.property_outputs??{};
  if(!propertyOutputs||typeof propertyOutputs!=='object'||Array.isArray(propertyOutputs)
    ||Object.keys(propertyOutputs).length!==expectedOutputs.length
    ||expectedOutputs.some(name=>!Object.hasOwn(propertyOutputs,name)))return fail('element_property_output_observation_required');
  const propertyRelations=[];
  for(const [index,expected] of expectedProperties.entries()){
    const observed=propertyInputs[index];
    if(!observed||observed.input_index!==expected.input_index||observed.name!==expected.name
      ||observed.target!==expected.target||observed.source_id!==expected.source_id
      ||Boolean(observed.argument_value)!==Boolean(expected.argument_value)||!encoded(observed.value))
      return fail('element_property_input_mismatch');
    const output=expected.target==='props'?propertyOutputs[expected.name]:fields[expected.target];
    if(!encoded(output))return fail('element_property_output_mismatch');
    propertyRelations.push({source_id:expected.source_id,input_index:expected.input_index,name:expected.name,target:expected.target,
      input:structuredClone(observed.value),output:structuredClone(output),same_value:observed.value.identity===output.identity});
  }
  const values=new Map();
  for(const value of [record.result,...Object.values(inputs),...Object.values(fields),
    ...propertyRelations.flatMap(row=>[row.input,row.output]),...(factoryCall?[record.target]:[])]){
   if(!encoded(value))return fail('element_value_invalid');
   const previous=values.get(value.identity);
   if(previous && (previous.kind!==value.kind || previous.encoding!==value.encoding || !Object.is(previous.value,value.value)))return fail('element_value_identity_conflict');
   values.set(value.identity,value);
  }
  if(byResult.has(record.result.identity))return fail('element_result_allocation_conflict');
  seen.add(record.observation_id);
  byResult.set(record.result.identity,{session:record.session,observation_id:record.observation_id,type:structuredClone(fields.type)});
  descriptions.set(record.observation_id,structuredClone(record));
  return {schema:'producttrace.react-element-join.v1',status:'resolved',reason:null,observation_id:record.observation_id,runtime_observed:true,
   source:{source_call_id:entry.source_call_id,semantic_id:entry.semantic_id,...(factoryCall?{factory_producer_call_id:entry.factory_producer_call_id}:clone?{element_argument:rule.element_argument}:{type_argument:rule.type_argument})},
   runtime:{claim:clone?'observed_cloned_element_description':'observed_element_description',...(clone?{original_description_observation_id:origin.observation_id}:{}),...(factoryCall?{factory_observation_id:factoryOrigin.observation_id}:{}),type:structuredClone(fields.type),props:structuredClone(fields.props),key:structuredClone(fields.key),ref:structuredClone(fields.ref),owner:structuredClone(fields._owner),
    property_input_relations:propertyRelations,property_input_relations_proven:propertyRelations.length>0&&propertyRelations.every(row=>row.same_value),
    renderer_execution_proven:false,host_commit_proven:false,component_invocation_proven:false}};
 }};
}
