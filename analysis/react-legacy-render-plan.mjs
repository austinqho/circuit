import {validateReactExecutionRule} from './react-execution-rule.mjs';
/** Describe a request and its public result. A callback runs at commit, which
 * can follow the call when an existing legacy root is updated inside a batch. */
export function planReactLegacyRender(rule,{args=[],rootState='initial',publicInstance,parentValid}={}) {
 if(!validateReactExecutionRule(rule).valid||rule.kind!=='legacy_render'||!Array.isArray(args))return {status:'unresolved',reason:'legacy_render_rule_required'};
 if(!['initial','existing','unobserved'].includes(rootState))return {status:'unresolved',reason:'legacy_render_root_context_required'};
 if(rule.parent_argument!==null&&parentValid!==true)return {status:'unresolved',reason:'legacy_render_parent_required'};
 return {status:'planned',element:args[rule.element_argument],container:args[rule.argument],parent:rule.parent_argument===null?null:args[rule.parent_argument],
  initial_mode:rootState==='unobserved'?'unobserved':rootState==='initial'?rule.mode:'update',scheduling:rootState==='unobserved'?'unobserved':rootState==='initial'?rule.initial_flush:rule.updates,
  callback:args[rule.callback_argument],callback_receiver:rule.callback_receiver==='public_instance'?publicInstance:undefined,
  callback_arguments:rule.callback_arguments.map(index=>args[index]),parent_context:rule.parent_context,
  result:rule.result==='first_child_state_node'?publicInstance:undefined,callback_completion_proven:false,hydration_reuse_proven:false};
}
