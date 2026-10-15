import {validateReactExecutionRule} from './react-execution-rule.mjs';
/** Describe root lifetime operations. A scheduled tree is not a committed tree;
 * checking the container's node kind does not validate all DOM capabilities. */
export function planReactRootOperation(rule,{operation,state='active',args=[],containerNodeType}={}) {
 if(!validateReactExecutionRule(rule).valid||rule.kind!=='dom_root'||!Array.isArray(args))return {status:'unresolved',reason:'root_rule_required'};
 if(operation==='create'){const options=args[rule.options_argument];return {status:'planned',operation:rule.container_node_types.includes(containerNodeType)?'allocate':'throw',
   container:args[rule.container_argument],initial_children:rule.children_argument===null?undefined:args[rule.children_argument],
   options,identifier_prefix:options?.[rule.identifier_prefix_option],recoverable_error_callback:options?.[rule.recoverable_error_option],
   schedules_initial_tree:rule.mode==='hydrate',dom_capabilities_verified:false,commit_observed:false};}
 if(!['active','unmounted'].includes(state))return {status:'unresolved',reason:'root_lifetime_required'};
 if(operation==='render')return {status:'planned',operation:state==='unmounted'&&rule.render_after_unmount==='throw'?'throw':'schedule',
   children:args[rule.render_argument],result:undefined,callback_invoked:false,commit_observed:false};
 if(operation==='unmount')return {status:'planned',operation:state==='unmounted'?rule.repeat_unmount:'unmount',
   state:'unmounted',timing:rule.unmount_timing,result:undefined,callback_invoked:false,cleanup_observed:false};
 return {status:'unresolved',reason:'root_operation_unmodeled'};
}
