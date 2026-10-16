import assert from 'node:assert/strict';import path from 'node:path';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';import {validateReactExecutionRule,planElementConstruction} from '../../analysis/react-execution-rule.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
if(!process.env.PRODUCTTRACE_ELEMENT_ORACLE_CHILD){const builds=['development','production'].map(build=>JSON.parse(execFileSync(process.execPath,[new URL(import.meta.url).pathname,repository],{encoding:'utf8',env:{...process.env,NODE_ENV:build,PRODUCTTRACE_ELEMENT_ORACLE_CHILD:'1'}})));
 console.log(JSON.stringify({api:'react/createElement/18.3.1',format_pass:true,behavior_pass:true,builds},null,2));
}else{
 const require=createRequire(path.join(repository,'package.json')),React=require('react');assert.equal(React.version,'18.3.1');
 const rule=getReactBehavior({surface:'react',exportName:'createElement',version:React.version}).execution;let calls=0;
 function Child(){calls++;return null;}Child.defaultProps={label:'default',children:'default-child',retained:'fallback'};
 const callback=()=>calls++,ref={current:null},inherited=Object.create({inherited:'excluded',key:'inherited-key',ref});inherited.own='included';
 const cases=[[Child,null],[Child,{}],[Child,{label:undefined}],[Child,{label:null}],[Child,{label:'explicit',key:12,ref}],
 [Child,{children:'from-props'},'positional'],[Child,{children:'from-props'},'one','two'],[Child,{children:'from-props'},undefined],
 ['button',{onClick:callback,__self:{},__source:{},key:'x',ref}],['span',inherited],['span',{key:null}],['span',{key:false}],['span',{key:1n}],
 ['span',Object.defineProperty({visible:1},'hidden',{value:2})]];
 const original=console.error;console.error=()=>{};let actual;try{actual=cases.map(args=>React.createElement(...args));}finally{console.error=original;}
 function agrees(program,args,element){const plan=planElementConstruction(program,args);if(plan.status!=='planned')return false;
  if(plan.marker!==Symbol.keyFor(element.$$typeof)||plan.type!==element.type||plan.key!==element.key||plan.ref!==element.ref||plan.callbacks.length
    ||JSON.stringify(plan.owner_policy)!==JSON.stringify(program.owner)||element._owner!==null)return false;
  // Reserved development warning accessors are not ordinary output props.
  const values=Object.fromEntries(Object.keys(element.props).map(key=>[key,element.props[key]]));try{assert.deepEqual(plan.props,values);return true;}catch{return false;}}
 for(const [index,args] of cases.entries())assert.equal(agrees(rule,args,actual[index]),true,JSON.stringify({index}));assert.equal(calls,0);
 const mutants=[{type_argument:1,config_argument:0},{children_start:3},{reserved_props:[]},{reserved_props:['key','__self','__source']},
  {children_policy:'retain'},{default_policy:'always'},{marker:'react.portal'},{callbacks_at_creation:'invoke'}];
 for(const change of mutants){const mutant={...rule,...change};assert.equal(validateReactExecutionRule(mutant).valid,true);assert.ok(cases.some((args,i)=>!agrees(mutant,args,actual[i])),JSON.stringify(change));}
 assert.equal(validateReactExecutionRule({...rule,owner:{development:'null',production:'null'}}).valid,false);
 let getter=0;const config={get label(){getter++;return 'read';}};assert.equal(planElementConstruction(rule,[Child,config]).reason,'element_accessor_unobserved');assert.equal(getter,0);
 const withGetter=React.createElement(Child,config);assert.equal(withGetter.props.label,'read');assert.equal(getter,1);
 let coercions=0;const key={toString(){coercions++;return 'custom';}};assert.equal(planElementConstruction(rule,[Child,{key}]).reason,'element_key_coercion_required');assert.equal(coercions,0);assert.equal(React.createElement(Child,{key}).key,'custom');assert.ok(coercions>=1);
 const error=Error('config'),throwing={get label(){throw error;}};assert.throws(()=>React.createElement(Child,throwing),value=>value===error);
 assert.equal(planElementConstruction(rule,[Child,JSON.parse('{"__proto__":{"x":1}}')]).reason,'element_prototype_write_unmodeled');
 console.log(JSON.stringify({build:process.env.NODE_ENV,cases:cases.length,incorrect_programs_rejected:mutants.length,
 component_and_callbacks_not_invoked:true,own_enumerable_and_reserved_props:true,children_precedence_and_defaults:true,
 inherited_key_and_ref:true,owner_policy_format_rejected:true,accessors_and_coercions_abstained:true,original_throw_preserved:true}));
}
