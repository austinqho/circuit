import {validateReactExecutionRule} from './react-execution-rule.mjs';
/** Join recorded calls, not an inferred traversal of an opaque input object.
 * The real library owns traversal. Its inputs are never traversed a second time
 * by the observer, so getters and iterators keep their original behavior. */
export function checkReactChildrenEvidence(entry,record) {
 const fail=reason=>({status:'unresolved',reason});const rule=entry.children_rule,scope=record.scope;
 if(!validateReactExecutionRule(rule).valid || rule.kind!=='children_collection')return fail('children_rule_required');
 const scoped=value=>typeof value==='string' && typeof record.session==='string' && record.session && value.startsWith(record.session+':') && value.length>record.session.length+1;
 const encoded=value=>value && scoped(value.identity) && ['null','undefined','object','function','string','number','boolean','bigint','symbol'].includes(value.kind)
   && (value.encoding==='primitive'?value.kind==='null'?value.value===null:['string','number','boolean'].includes(value.kind)&&typeof value.value===value.kind&&(value.kind!=='number'||Number.isFinite(value.value))
   :value.encoding==='redacted'&&value.value===null&&!['null','string','boolean'].includes(value.kind));
 if(!scope || !scoped(record.observation_id)||!scoped(scope.scope_id)||!['returned','threw'].includes(scope.outcome)
   || !Array.isArray(scope.callbacks)||!encoded(scope.result)||!scope.inputs || typeof scope.inputs!=='object'
   || scope.result.kind!==record.result_kind || record.operation!==(scope.outcome==='threw'?'threw':'invoked'))return fail('children_call_evidence_required');
 if(Object.values(scope.inputs).some(value=>!encoded(value)))return fail('children_input_invalid');
 if(!['map','forEach','count','toArray','only'].includes(entry.children_member))return fail('children_member_required');
 const allowed=new Set((entry.scope_captures||[]).map(row=>row.binding_id));
 const callable=['map','forEach'].includes(entry.children_member),callback=scope.inputs[rule.callback_argument],receiver=scope.inputs[rule.receiver_argument];
 if(!callable && scope.callbacks.length)return fail('children_unexpected_callback');
 const ids=new Set(),values=new Map();let threw=false;
 const consistent=value=>{const identity=JSON.stringify([value.kind,value.encoding,value.value]);if(values.has(value.identity)&&values.get(value.identity)!==identity)return false;values.set(value.identity,identity);return true;};
 if(![...Object.values(scope.inputs),scope.result].every(consistent))return fail('children_value_identity_conflict');
 for(const [index,row] of scope.callbacks.entries()) {
  if(threw || !row || !scoped(row.invocation_id)||ids.has(row.invocation_id)||!entry.scope_callback_source_id
    ||row.source_id!==entry.scope_callback_source_id||!encoded(callback)||callback.kind!=='function'||row.callback_identity_id!==callback.identity
    ||!Array.isArray(row.arguments)||row.arguments.length!==2||row.arguments.some(value=>!encoded(value))
    ||row.arguments[1].encoding!=='primitive'||row.arguments[1].value!==index+rule.index_start
    ||!encoded(row.receiver)||!encoded(row.result)||!['returned','threw'].includes(row.outcome))return fail('children_callback_evidence_mismatch');
  if(![...row.arguments,row.receiver,row.result].every(consistent))return fail('children_value_identity_conflict');
  if(!Array.isArray(row.captured_values)||row.captured_values.some(value=>!value||!allowed.has(value.binding_id)||!['primitive','redacted'].includes(value.encoding)||(value.encoding==='redacted'?value.value!==null:value.value!==null&&!(['string','boolean'].includes(typeof value.value)||typeof value.value==='number'&&Number.isFinite(value.value)))))return fail('children_capture_binding_mismatch');
  // Exact receiver relation is admitted only when an object receiver was
  // supplied; sloppy callback boxing/default-global behavior stays explicit.
  if(receiver && ['object','function'].includes(receiver.kind) && row.receiver.identity!==receiver.identity)return fail('children_receiver_mismatch');
  if(row.outcome==='threw'){
   threw=true;if(scope.outcome!=='threw'||scope.result.identity!==row.result.identity)return fail('children_callback_throw_mismatch');
  }
  ids.add(row.invocation_id);
 }
 if(scope.outcome==='returned' && entry.children_member==='forEach' && scope.result.kind!=='undefined')return fail('children_for_each_result_mismatch');
 if(scope.outcome==='returned' && entry.children_member==='only' && scope.result.identity!==scope.inputs[rule.children_argument]?.identity)return fail('children_only_identity_mismatch');
 return {status:'resolved',claim:'observed_children_call_and_callbacks',member:entry.children_member,
   observed_callbacks:structuredClone(scope.callbacks),result:structuredClone(scope.result),outcome:scope.outcome,
   input_traversal_proven:false,result_keys_proven:false,
   callback_source_proven:scope.callbacks.length>0,frontier:'children_input_traversal_and_output_relation_unobserved'};
}
