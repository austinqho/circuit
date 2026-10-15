import {validateLibraryProgram} from '../analysis/library-program.mjs';
import {LIBRARY_PROGRAM_SYNTAX} from '../analysis/library-program-syntax.mjs';

/** Remove only two local, evaluation-once aliases. This is deliberately not a
 * general equivalence checker: different branches, effects, closures and state
 * machines remain different candidates. Catalog hashes attest the original
 * program before normalization, and the normalized program is independently
 * verified against the installed library before admission. */
export function normalizeLibraryProgram(program) {
  const format=validateLibraryProgram(program);
  if(!format.valid)return {status:'frontier',reason:'normalization_format',errors:format.errors};
  const result=structuredClone(program),rewrites=[];
  const visit=(node,path)=>{
    for(const [key,type] of Object.entries(LIBRARY_PROGRAM_SYNTAX[node.op])){
      if(type==='instruction')node[key]=visit(node[key],path+'/'+key);
      else if(type==='instructions')node[key]=node[key].map((child,index)=>visit(child,path+'/'+key+'/'+index));
      else if(type==='entries')for(const name of Object.keys(node[key]))node[key][name]=visit(node[key][name],path+'/'+key+'/'+name);
    }
    if(node.op!=='bind')return node;
    const isAlias=value=>value?.op==='local'&&value.name===node.name;
    if(isAlias(node.body)){
      rewrites.push({path,kind:'return_bound_value'});return node.value;
    }
    const steps=node.body.op==='sequence'?node.body.steps:null;
    if(steps?.length===2&&['seal','freeze'].includes(steps[0].op)&&isAlias(steps[0].value)&&isAlias(steps[1])){
      // seal/freeze evaluate their operand once and return that exact value.
      // Neither intervening code nor an escaping binding is removed here.
      rewrites.push({path,kind:'return_bound_heap_operation',operation:steps[0].op});
      return {op:steps[0].op,value:node.value};
    }
    return node;
  };
  result.body=visit(result.body,'/body');
  const checked=validateLibraryProgram(result);
  if(!checked.valid)return {status:'frontier',reason:'normalization_invalid_result',errors:checked.errors};
  return {status:'normalized',program:result,rewrites};
}
