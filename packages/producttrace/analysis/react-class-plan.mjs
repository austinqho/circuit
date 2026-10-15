import {validateReactExecutionRule} from './react-execution-validate.mjs';
/** Interpret source/version-specific class policy from supplied facts. Equality
 * facts need their own evidence; this planner never enumerates application props
 * or state and never calls a shouldComponentUpdate method to find an answer.
 * update_check describes the check after queue/context selection. It is not the
 * whole update algorithm: React can skip this check or override it with queued
 * force work. A permitted render does not establish execution or commit. */
export function planReactClassOperation(rule,{operation='construct',args=[],defaultUpdater,sharedRefs,propsEqual,stateEqual,custom,force=false,props,state,left,right}={}) {
 if(!validateReactExecutionRule(rule).valid||rule.kind!=='class_component'||!Array.isArray(args))return {status:'unresolved',reason:'class_component_rule_required'};
 if(operation==='compare')return {status:'planned',equal:rule.comparison==='Object.is'?Object.is(left,right):left===right};
 if(operation==='construct'){
  const supplied=args[rule.updater_argument];return {status:'planned',props:args[rule.props_argument],context:args[rule.context_argument],
   updater:(rule.updater_default==='falsy'?!supplied:supplied==null)?defaultUpdater:supplied,refs:rule.refs==='shared_empty'?sharedRefs:{},pure:rule.pure};
 }
 if(operation==='render')return {status:'planned',method:rule.render_method,inputs:{[rule.props_field]:props,[rule.state_field]:state},commit_proven:false};
 if(operation!=='update_check')return {status:'unresolved',reason:'class_operation_unknown'};
 const check=(allows_render,reason)=>({status:'planned',allows_render,reason,render_execution_proven:false,queue_context_proven:false,commit_proven:false});
 if(force)return check(true,'forced');
 if(custom?.called&&rule.custom_should_update==='first')return check(Boolean(custom.result),'custom');
 if(rule.default_update==='always')return check(true,'default');
 if(typeof propsEqual!=='boolean'||typeof stateEqual!=='boolean')return {status:'unresolved',reason:'class_shallow_comparison_evidence_required'};
 return check(!propsEqual||!stateEqual,'shallow_comparison');
}
