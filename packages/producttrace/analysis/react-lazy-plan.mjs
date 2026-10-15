import {validateReactExecutionRule} from './react-execution-validate.mjs';
/** Interpret one lazy-initializer step without calling a loader, subscribing to
 * a thenable, or reading a module getter. Those are effects to observe separately. */
export function planReactLazyStep(rule,{state,event,value}={}) {
 if(!validateReactExecutionRule(rule).valid||rule.kind!=='lazy_component')return {status:'unresolved',reason:'lazy_rule_required'};
 if(!state||!['uninitialized','pending','resolved','rejected'].includes(state.status))return {status:'unresolved',reason:'lazy_state_required'};
 const result=(operation,next=state,extra={})=>({status:'planned',operation,state:next,...extra,runtime_observed:false});
 if(event==='initialize'){
  if(state.status==='uninitialized')return result('invoke_loader',state,{callback:state.value,arguments:[]});
  if(state.status==='resolved')return result('read_module_property',state,{module:state.value,property:rule.module_property});
  return result(state.status==='pending'&&rule.pending==='return'?'return':'throw',state,{value:state.value});
 }
 if(event==='loader_return')return result('subscribe_thenable',state,{thenable:value});
 if(event==='registration_return')return result('continue',state.status==='uninitialized'?{status:'pending',value}:state);
 if(event==='fulfill'||event==='reject')return result('continue',
  rule.settlement==='first'&&!['uninitialized','pending'].includes(state.status)?state:{status:event==='fulfill'?'resolved':'rejected',value});
 if(event==='loader_throw')return result('throw',rule.retry_loader_error?state:{status:'rejected',value},{value});
 if(event==='registration_throw')return result('throw',state,{value});
 return {status:'unresolved',reason:'lazy_event_unmodeled'};
}
