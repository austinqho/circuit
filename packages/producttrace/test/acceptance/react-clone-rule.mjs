import assert from 'node:assert/strict';import path from 'node:path';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';import {validateReactExecutionRule,planElementClone} from '../../analysis/react-execution-rule.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
if(!process.env.PRODUCTTRACE_CLONE_ORACLE_CHILD){const builds=['development','production'].map(build=>JSON.parse(execFileSync(process.execPath,[new URL(import.meta.url).pathname,repository],{encoding:'utf8',env:{...process.env,NODE_ENV:build,PRODUCTTRACE_CLONE_ORACLE_CHILD:'1'}})));
 console.log(JSON.stringify({api:'react/cloneElement/18.3.1',format_pass:true,behavior_pass:true,builds},null,2));
}else{
 const require=createRequire(path.join(repository,'package.json')),React=require('react');assert.equal(React.version,'18.3.1');
 const rule=getReactBehavior({surface:'react',exportName:'cloneElement',version:React.version}).execution;let calls=0;
 function Child(){calls++;return null;}Child.defaultProps={label:'old-default',children:'old-child'};
 const ref={current:null},owner={},symbol=Symbol('property'),base={...React.createElement(Child,{key:'old',ref}),_owner:owner};
 base.props={...base.props,[symbol]:'copied-symbol'};Child.defaultProps={label:'new-default',children:'new-child',added:'new-default'};
 const cases=[[base],[base,null],[base,{}],[base,{label:undefined}],[base,{label:null}],[base,{label:'explicit',key:'new'}],
 [base,{ref:null}],[base,{ref:undefined}],[base,{children:undefined}],[base,{children:'config'},undefined],
 [base,{},'one','two'],[base,Object.create({key:'inherited',ref:null})],[null,{}],[undefined,{}]];
 const results=cases.map(args=>{try{return {value:React.cloneElement(...args)};}catch(error){return {error};}});
 function agrees(program,args,observed){const plan=planElementClone(program,args,{owner:null});if(plan.status!=='planned')return false;if(observed.error)return plan.operation==='throw';
  const value=observed.value;if(plan.operation!=='return'||plan.type!==value.type||plan.key!==value.key||plan.ref!==value.ref||plan.owner!==value._owner||plan.marker!==Symbol.keyFor(value.$$typeof)||plan.callbacks.length)return false;
  try{assert.deepEqual(plan.props,value.props);return true;}catch{return false;}}
 for(const [i,args] of cases.entries())assert.equal(agrees(rule,args,results[i]),true,String(i));assert.equal(calls,0);
 const mutations=[{element_argument:1,config_argument:0},{children_start:3},{reserved_props:[]},{reserved_props:['key','__self','__source']},
 {children_policy:'retain'},{default_policy:'all_undefined'},{ref_owner:'preserve'},{marker:'react.portal'},{callbacks_at_creation:'invoke'}];
 for(const change of mutations){const mutant={...rule,...change};assert.equal(validateReactExecutionRule(mutant).valid,true);assert.ok(cases.some((args,i)=>!agrees(mutant,args,results[i])),JSON.stringify(change));}
 let reads=0;const config={get label(){reads++;return 'getter';}};assert.equal(planElementClone(rule,[base,config],{owner:null}).reason,'element_accessor_unobserved');assert.equal(reads,0);assert.equal(React.cloneElement(base,config).props.label,'getter');assert.ok(reads>0);
 assert.equal(planElementClone(rule,[base,{ref:null}]).reason,'element_owner_required');
 const error=Error('config'),throwing={get label(){throw error;}};assert.throws(()=>React.cloneElement(base,throwing),value=>value===error);
 assert.equal(Object.isFrozen(React.cloneElement(base,{},'a','b').props.children),false);
 assert.equal(results[2].value.props.label,'old-default');assert.equal(results[3].value.props.label,'new-default');assert.equal(results[9].value.props.children,undefined);
 console.log(JSON.stringify({build:process.env.NODE_ENV,cases:cases.length,incorrect_programs_rejected:mutations.length,
 unchanged_props_preserved:true,supplied_undefined_defaults:true,positional_undefined_not_defaulted:true,ref_owner_replacement:true,symbol_props_copied:true,
 component_not_invoked:true,unknown_owner_and_accessors_abstained:true,throw_identity_preserved:true,clone_child_array_not_frozen:true}));
}
