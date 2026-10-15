import {validateReactExecutionRule} from './react-execution-rule.mjs';
/** A true result reports an accepted unmount request. The flush may be deferred
 * inside a render/commit, so an empty-root commit needs separate runtime proof. */
export function planReactLegacyUnmount(rule,{args=[],nodeType,nodeValue,rootKind}={}) {
 if(!validateReactExecutionRule(rule).valid||rule.kind!=='legacy_unmount'||!Array.isArray(args))return {status:'unresolved',reason:'legacy_unmount_rule_required'};
 if(!args[rule.argument]||!rule.container_node_types.includes(nodeType)&&!(nodeType===8&&nodeValue===rule.comment_marker))return {status:'planned',operation:'throw'};
 if(!['legacy','concurrent','none'].includes(rootKind))return {status:'unresolved',reason:'legacy_root_context_required'};
 const present=rootKind==='legacy'||rootKind==='concurrent'&&rule.root_kind==='any';
 return {status:'planned',operation:present?'request_unmount':'noop',result:present?rule.present_result:rule.absent_result,
  flush:present?rule.flush:null,commit_required:present,cleanup_completion_proven:false};
}
