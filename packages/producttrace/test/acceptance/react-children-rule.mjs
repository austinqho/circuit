import assert from 'node:assert/strict';import path from 'node:path';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';import {validateReactExecutionRule,planChildrenTraversal} from '../../analysis/react-execution-rule.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
if(!process.env.PRODUCTTRACE_CHILDREN_ORACLE_CHILD){
 const builds=['development','production'].map(build=>JSON.parse(execFileSync(process.execPath,[new URL(import.meta.url).pathname,repository],{encoding:'utf8',env:{...process.env,NODE_ENV:build,PRODUCTTRACE_CHILDREN_ORACLE_CHILD:'1'}})));
 console.log(JSON.stringify({api:'react/Children/18.3.1',format_pass:true,behavior_pass:true,builds},null,2));
}else{
 const require=createRequire(path.join(repository,'package.json')),React=require('react'),DOM=require('react-dom'),{JSDOM}=require('jsdom');assert.equal(React.version,'18.3.1');
 const dom=new JSDOM('<div></div>'),portal=DOM.createPortal('portal',dom.window.document.querySelector('div'));
 const rule=getReactBehavior({surface:'react',exportName:'Children',version:React.version}).execution;let rendered=0;
 function Child(){rendered++;return null;}
 const element=React.createElement(Child,{key:'a:b=c'}),fragment=React.createElement(React.Fragment,null,'nested',null),receiver={};
 const inputs=[undefined,null,false,true,0,NaN,'text',()=>{},Symbol('x'),1n,element,fragment,portal,Object.create({$$typeof:Symbol.for('react.element'),key:null}),
   [null,undefined,false,true,'x',2],['first',['second',[element]],fragment,portal],Array(3)];
 const observations=[];
 for(const children of inputs){
  const calls=[],callback=function(child,index){calls.push({child,index,receiver:this});return child;};
  React.Children.forEach(children,callback,receiver);
  const plan=planChildrenTraversal(rule,{args:[children,callback,receiver],method:'forEach'});assert.equal(plan.status,'planned');
  assert.deepEqual(plan.callbacks.map(row=>({child:row.arguments[0],index:row.arguments[1],receiver:row.receiver})),calls);
  assert.equal(planChildrenTraversal(rule,{args:[children],method:'count'}).value,React.Children.count(children));
  const mapped=[];React.Children.map(children,(child,index)=>{mapped.push([child,index]);return child;});assert.deepEqual(mapped,calls.map(row=>[row.child,row.index]));
  const only=planChildrenTraversal(rule,{args:[children],method:'only'});
  if(only.operation==='return')assert.equal(React.Children.only(children),only.value);else assert.throws(()=>React.Children.only(children));
  observations.push({children,calls,callback});
 }
 assert.equal(rendered,0);
 const mutants=[{normalize_empty:false},{traversal:'reverse'},{index_start:1},{leaf_types:['string']},
  {leaf_types:['string','number','function']},{leaf_markers:['react.element']},{element_children:'descend'},
  {children_argument:1,callback_argument:0},{callback_argument:2,receiver_argument:1},{only_marker:'react.portal'}];
 for(const change of mutants){const mutant={...rule,...change};assert.equal(validateReactExecutionRule(mutant).valid,true);
  const differs=observations.some(row=>{const plan=planChildrenTraversal(mutant,{args:[row.children,row.callback,receiver],method:'forEach'});
   if(plan.status!=='planned'||plan.callbacks.length!==row.calls.length)return true;
   if(plan.callbacks.some((call,i)=>!Object.is(call.arguments[0],row.calls[i].child)||call.arguments[1]!==row.calls[i].index||call.receiver!==row.calls[i].receiver||call.callback!==row.callback))return true;
   const only=planChildrenTraversal(mutant,{args:[row.children],method:'only'}),valid=React.isValidElement(row.children);
   return only.status!=='planned'||(only.operation==='return')!==valid;});assert.equal(differs,true,JSON.stringify(change));}
 let getterReads=0;const array=[];Object.defineProperty(array,'0',{get(){getterReads++;return 'x';}});
 assert.equal(planChildrenTraversal(rule,{args:[array],method:'count'}).reason,'children_accessor_unobserved');assert.equal(getterReads,0);
 assert.equal(React.Children.count(array),1);assert.equal(getterReads,1);
 const iterable=new Set(['a','b']);assert.equal(planChildrenTraversal(rule,{args:[iterable],method:'count'}).reason,'children_iterable_or_object_unresolved');assert.equal(React.Children.count(iterable),2);
 const error=Error('callback');assert.throws(()=>React.Children.forEach(['x'],()=>{throw error;}),value=>value===error);
 const flat=React.Children.toArray([null,false,'x',[2,element]]);assert.equal(flat.length,3);assert.equal(flat[0],'x');assert.equal(flat[1],2);assert.equal(flat[2].type,Child);assert.notEqual(flat[2].key,element.key);
 assert.equal(planChildrenTraversal(rule,{args:[[element]],method:'toArray'}).result_frontier,'mapped_result_flattening_and_keys_unproven');
 console.log(JSON.stringify({build:process.env.NODE_ENV,traversal_cases:inputs.length,incorrect_programs_rejected:mutants.length,
  element_and_fragment_children_opaque:true,receiver_and_index_verified:true,only_requires_element:true,accessors_and_iterators_abstained:true,
  callback_throw_preserved:true,key_rewriting_proven:false}));dom.window.close();
}
