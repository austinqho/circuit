import assert from 'node:assert/strict';import path from 'node:path';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';import {validateReactExecutionRule,planElementFactory} from '../../analysis/react-execution-rule.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
if(!process.argv.includes('--child')){
 const builds=['development','production'].map(build=>JSON.parse(execFileSync(process.execPath,[fileURLToPath(import.meta.url),repository,'--child'],{encoding:'utf8',env:{...process.env,NODE_ENV:build}})));
 console.log(JSON.stringify({api:'react/createFactory/18.3.1',format_pass:true,behavior_pass:true,builds},null,2));
}else{
 const require=createRequire(path.join(repository,'package.json')),React=require('react'),build=process.env.NODE_ENV;
 assert.equal(React.version,'18.3.1');const rule=getReactBehavior({surface:'react',exportName:'createFactory',version:React.version}).execution;
 let invokes=0;function Child(){invokes++;}Child.defaultProps={label:'default',children:'default-child'};
 const factory=React.createFactory(Child),second=React.createFactory(Child);assert.notEqual(factory,second);assert.equal(invokes,0);
 const property=Object.getOwnPropertyDescriptor(factory,'type');
 assert.equal(build==='development'?typeof property.get:typeof property.value,'function');
 const cases=[[],[null],[{}],[{label:undefined}],[{label:'explicit',key:8,ref:null}],[{children:'config'},'first','second'],[{},undefined],[{onClick:()=>17}]];
 const actual=cases.map(args=>factory(...args));
 const agrees=candidate=>{
  const created=planElementFactory(candidate,{args:[Child]});if(created.type!==Child||created.allocation!=='per_call'||created.callbacks.length)return false;
  return cases.every((args,i)=>{const plan=planElementFactory(candidate,{args:[Child],invocation:args}),element=actual[i];
   try{assert.equal(plan.status,'planned');assert.equal(plan.type,element.type);assert.equal(Symbol.for(plan.marker),element.$$typeof);assert.equal(plan.key,element.key);assert.equal(plan.ref,element.ref);assert.deepEqual(plan.props,element.props);assert.deepEqual(plan.callbacks,[]);return true;}catch{return false;}});
 };
 assert.equal(agrees(rule),true);assert.equal(invokes,0);
 const mutants=[{...rule,type_argument:1},{...rule,allocation:'shared'},{...rule,creation_callbacks:'invoke'},
  ...[{children_policy:'retain'},{default_policy:'always'},{reserved_props:[]},{marker:'react.portal'},{callbacks_at_creation:'invoke'}].map(change=>({...rule,construction:{...rule.construction,...change}}))];
 for(const mutant of mutants){assert.equal(validateReactExecutionRule(mutant).valid,true);assert.equal(agrees(mutant),false);}
 // Reading or rewriting the public `.type` property does not change the bound
 // constructor. The observer must not perform this deprecated read itself.
 assert.equal(factory.type,Child);Object.defineProperty(factory,'type',{value:'span'});assert.equal(factory({}).type,Child);
 const error={original:true};assert.throws(()=>factory({get label(){throw error;}}),e=>e===error);
 assert.equal(planElementFactory(rule,{args:[Child],invocation:[{get label(){throw Error('planner must not read');}}]}).status,'unresolved');
 console.log(JSON.stringify({build,cases:cases.length,incorrect_programs_rejected:mutants.length,component_not_invoked:invokes===0,fresh_factories:true,type_property_not_binding:true,original_getter_error_preserved:true}));
}
