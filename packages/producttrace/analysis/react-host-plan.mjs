import {validateReactExecutionRule} from './react-execution-validate.mjs';
/** The renderer supplies a bounded snapshot of the current branch. This planner
 * never reads a live component, nodeType getter, or an alternate Fiber itself. */
export function planReactHostLookup(rule,{input,args,nodeType,currentTree,providedTree,mounted}={}) {
 if(!validateReactExecutionRule(rule).valid||rule.kind!=='host_lookup')return {status:'unresolved',reason:'host_lookup_rule_required'};
 if(args!==undefined){if(!Array.isArray(args))return {status:'unresolved',reason:'host_arguments_required'};input=args[rule.argument];}
 if(input===null||input===undefined)return {status:'planned',operation:rule.nullish==='null'?'return':'throw',value:null};
 if(nodeType===rule.element_node_type)return {status:'planned',operation:'return',value:input,selection:'identity'};
 if(mounted===false)return {status:'planned',operation:rule.detached==='throw'?'throw':'return',value:null};
 const tree=rule.instance_source==='current_fiber'?currentTree:providedTree;
 if(mounted!==true||!tree)return {status:'unresolved',reason:'current_component_tree_required'};
 let count=0;const seen=new Set();
 const visit=node=>{
  if(!node||seen.has(node)||++count>2000||!Number.isInteger(node.tag)||!Array.isArray(node.children))throw Error('invalid_tree');seen.add(node);
  if(rule.host_tags.includes(node.tag))return {found:true,value:node.value};
  if(node.tag===4&&rule.portals==='skip')return {found:false};
  const children=rule.traversal==='reverse'?[...node.children].reverse():node.children;
  for(const child of children){const selected=visit(child);if(selected.found)return selected;}
  if(node.complete!==true)throw Error('incomplete_tree');
  return {found:false};
 };
 try{const selected=visit(tree);return selected.found?{status:'planned',operation:'return',value:selected.value,selection:'current_host'}
   :{status:'planned',operation:rule.empty==='null'?'return':'throw',value:null,selection:'empty_tree'};
 }catch(_){return {status:'unresolved',reason:'host_tree_incomplete_or_invalid'};}
}
