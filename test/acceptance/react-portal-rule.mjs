import assert from 'node:assert/strict';import path from 'node:path';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';import {validateReactExecutionRule,planPortalDescription} from '../../analysis/react-execution-rule.mjs';
if(!process.env.PRODUCTTRACE_PORTAL_ORACLE_CHILD){const builds=['development','production'].map(build=>JSON.parse(execFileSync(process.execPath,[new URL(import.meta.url).pathname,process.argv[2]],{encoding:'utf8',env:{...process.env,NODE_ENV:build,PRODUCTTRACE_PORTAL_ORACLE_CHILD:'1'}})));
 console.log(JSON.stringify({api:'react-dom/createPortal/18.3.1',format_pass:true,behavior_pass:true,builds},null,2));
}else{
 const require=createRequire(path.join(path.resolve(process.argv[2]),'package.json')),React=require('react'),DOM=require('react-dom'),{JSDOM}=require('jsdom');assert.equal(React.version,'18.3.1');
 const rule=getReactBehavior({surface:'react-dom',exportName:'createPortal',version:React.version}).execution;assert.equal(validateReactExecutionRule(rule).valid,true);
 const dom=new JSDOM('<div></div>'),container=dom.window.document.querySelector('div');let callbacks=0;
 const cases=[[],[null],[undefined],[0],[-0],['key'],[false],[1n]].map(([key])=>[()=>{callbacks++;},container,key]);
 const actual=cases.map(args=>DOM.createPortal(...args));
 for(let i=0;i<cases.length;i++){
 const plan=planPortalDescription(rule,{args:cases[i]});assert.equal(plan.status,'planned');assert.equal(plan.marker,Symbol.keyFor(actual[i].$$typeof));assert.equal(plan.key,actual[i].key);
 assert.equal(plan.fields[rule.children_field],actual[i].children);assert.equal(plan.fields[rule.container_field],actual[i].containerInfo);assert.equal(plan.children_operation,'store');assert.equal(actual[i].implementation,null);}
 assert.equal(callbacks,0);
 const mutants=[{children_argument:1,container_argument:0},{children_field:'containerInfo',container_field:'children'},
 {children_argument:1,container_argument:0,children_field:'containerInfo',container_field:'children'},
 {key_argument:3},{marker:'react.element'},{children_at_creation:'invoke'}];
 for(const change of mutants){const mutant={...rule,...change};assert.equal(validateReactExecutionRule(mutant).valid,true);
 assert.ok(cases.some((args,i)=>{const plan=planPortalDescription(mutant,{args});return plan.status!=='planned'||plan.marker!==Symbol.keyFor(actual[i].$$typeof)||plan.key!==actual[i].key
  ||plan.fields.children!==actual[i].children||plan.fields.containerInfo!==actual[i].containerInfo
  ||args[mutant.children_argument]!==actual[i].children||args[mutant.container_argument]!==actual[i].containerInfo||plan.children_operation!=='store';}),JSON.stringify(change));}
 let coercions=0;const key={toString(){coercions++;return 'custom';}},portal=DOM.createPortal(null,container,key);
 assert.equal(portal.key,'custom');assert.ok(coercions>=1);const before=coercions;assert.equal(planPortalDescription(rule,{args:[null,container,key]}).reason,'portal_key_coercion_required');assert.equal(coercions,before);
 for(const invalid of [null,{},dom.window.document.createTextNode('x')])assert.throws(()=>DOM.createPortal(null,invalid));
 assert.throws(()=>require('react-dom/server').renderToString(React.createElement(React.Fragment,null,DOM.createPortal('x',container))));
 console.log(JSON.stringify({build:process.env.NODE_ENV,primitive_key_cases:cases.length,incorrect_programs_rejected:mutants.length,children_not_called:true,key_coercion_left_to_library:true,invalid_containers_rejected:true,server_portal_render_rejected:true}));dom.window.close();
}
