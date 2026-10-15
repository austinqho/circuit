import {validateReactExecutionRule} from './react-execution-validate.mjs';
/** Describe the public class method and its queued callback protocol without
 * executing an updater, enumerating state, or claiming a queue was processed. */
export function planReactClassUpdate(rule,{args=[],instance,updaterResult,operation='call',role,state,props}={}) {
 if(!validateReactExecutionRule(rule).valid||rule.kind!=='class_update'||!Array.isArray(args))return {status:'unresolved',reason:'class_update_rule_required'};
 const payload=rule.payload_argument===null?undefined:args[rule.payload_argument],completion=args[rule.completion_argument];
 if(operation==='call'){
  if(rule.validate_payload&&payload!=null&&!['object','function'].includes(typeof payload))return {status:'planned',operation:'throw',reason:'invalid_partial_state'};
  const values={instance,payload,completion,member:rule.member};return {status:'planned',operation:'enqueue_call',member:rule.updater_member,args:rule.updater_arguments.map(key=>values[key]),
   result:rule.result==='undefined'?undefined:updaterResult,queue_execution_proven:false,commit_proven:false};
 }
 if(operation==='callback'){
  if(!['calculation','completion'].includes(role)||role==='calculation'&&rule.payload_argument===null)return {status:'unresolved',reason:'class_update_callback_role_required'};
  const values={state,props};return {status:'planned',args:(role==='calculation'?rule.calculation_arguments:rule.completion_arguments).map(key=>values[key]),
   receiver:rule.callback_receiver==='instance'?instance:undefined,merge:rule.merge,nullish:rule.nullish,force:rule.force,queue_execution_proven:false,commit_proven:false};
 }
 return {status:'unresolved',reason:'class_update_operation_unknown'};
}
