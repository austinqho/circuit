import {validateReactExecutionRule} from './react-execution-rule.mjs';
/** Select the server input and execution policy without invoking a component,
 * reading its props, or interpreting returned HTML as browser execution. */
export function planReactServerString(rule,{args=[],suspended=false,boundary=false,fatal=false}={}) {
 if(!validateReactExecutionRule(rule).valid||rule.kind!=='server_string'||!Array.isArray(args))return {status:'unresolved',reason:'server_string_rule_required'};
 return {status:'planned',element:args[rule.element_argument],options:args[rule.options_argument],
  operation:fatal?'throw':suspended?(boundary?rule.suspension:rule.outside_boundary):'render',
  output:rule.output,callback_timing:rule.callback_timing,effects:rule.effects,result:rule.result,hydration_proven:false,runtime_observed:false};
}

/** Legacy Node streams render immediately but withhold output until all tasks
 * are ready. Browser entrypoints reject; creation is not stream completion. */
export function planReactLegacyServerStream(rule,{args=[],environment,operation='create'}={}) {
 if(!validateReactExecutionRule(rule).valid||rule.kind!=='legacy_server_stream'||!Array.isArray(args)||!['node','browser'].includes(environment))return {status:'unresolved',reason:'legacy_stream_environment_required'};
 if(operation==='destroy')return {status:'planned',operation:rule.destroy,runtime_observed:false};
 return {status:'planned',operation:environment==='browser'?rule.browser:'render',element:args[rule.element_argument],options:args[rule.options_argument],
  output:rule.output,ready:rule.ready,callback_timing:rule.callback_timing,effects:rule.effects,result:rule.result,stream_completion_proven:false,runtime_observed:false};
}

/** The browser server entrypoint starts work synchronously but returns a promise
 * for shell readiness. Promise creation does not prove fulfillment or allReady. */
export function planReactReadableStream(rule,{args=[],operation='create',preaborted=false,reason}={}) {
 if(!validateReactExecutionRule(rule).valid||rule.kind!=='readable_server_stream'||!Array.isArray(args))return {status:'unresolved',reason:'readable_server_rule_required'};
 if(operation==='cancel')return {status:'planned',operation:rule.cancel,reason:rule.cancel_reason==='forward'?reason:undefined};
 if(operation==='signal')return {status:'planned',operation:preaborted?rule.preaborted_signal:rule.signal==='future_abort_event'?'abort':'ignore',reason};
 if(operation!=='create')return {status:'unresolved',reason:'readable_server_operation_unknown'};
 return {status:'planned',element:args[rule.element_argument],options:args[rule.options_argument],callback_timing:rule.callback_timing,result:rule.result,
  resolve_at:rule.resolve_at,all_ready:rule.all_ready,effects:rule.effects,promise_fulfillment_proven:false,stream_completion_proven:false};
}

/** Pipeable creation queues work and returns a handle; piping is a separate
 * operation and shell readiness does not mean all suspended tasks completed. */
export function planReactPipeableStream(rule,{args=[],operation='create',pipeCount=0,destination,reason}={}) {
 if(!validateReactExecutionRule(rule).valid||rule.kind!=='pipeable_server_stream'||!Array.isArray(args))return {status:'unresolved',reason:'pipeable_server_rule_required'};
 if(operation==='pipe')return {status:'planned',operation:pipeCount>=rule.pipe_count?'throw':'pipe',result:rule.pipe_result==='destination'?destination:undefined};
 if(operation==='abort')return {status:'planned',operation:rule.abort==='forward_reason'?'abort':'ignore',reason};
 if(operation!=='create')return {status:'unresolved',reason:'pipeable_server_operation_unknown'};
 return {status:'planned',element:args[rule.element_argument],options:args[rule.options_argument],callback_timing:rule.callback_timing,result:rule.result,
  shell_callback:rule.shell_callback,all_callback:rule.all_callback,callback_arguments:rule.callback_arguments.map(index=>args[index]),effects:rule.effects,stream_completion_proven:false};
}
