import assert from 'node:assert/strict';import path from 'node:path';import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';
import {predictBoundaryType,validateReactExecutionRule} from '../../analysis/react-execution-rule.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
if(!process.argv.includes('--child')) {
  const builds=['development','production'].map(build=>JSON.parse(execFileSync(process.execPath,[fileURLToPath(import.meta.url),repository,'--child'],{
    encoding:'utf8',env:{...process.env,NODE_ENV:build},stdio:['ignore','pipe','inherit']})));
  console.log(JSON.stringify({apis:['Fragment','StrictMode','Profiler','Suspense'].map(name=>`react/${name}/18.3.1`),format_pass:true,behavior_pass:true,builds},null,2));
} else {
  const require=createRequire(path.join(repository,'package.json')),React=require('react');assert.equal(React.version,'18.3.1');
  let callbacks=0;const child=React.createElement('button',{onClick:()=>callbacks++},'Child');const rows=[];
  for(const api of ['Fragment','StrictMode','Profiler','Suspense']) {
    const actual=React[api],element=React.createElement(actual,api==='Profiler'?{id:'measured',onRender:()=>callbacks++}:api==='Suspense'?{fallback:React.createElement('p',null,'Waiting')}:null,child);
    const rule=getReactBehavior({surface:'react',exportName:api,version:React.version}).execution;
    const check=program=>{
      assert.equal(validateReactExecutionRule(program).valid,true);const predicted=predictBoundaryType(program);
      assert.equal(predicted.value_type,typeof actual);assert.equal(predicted.value,actual);
      assert.equal(predicted.element_marker,element.$$typeof);assert.equal(element[predicted.type_property],actual);
      assert.equal(predicted.construction_invokes,callbacks!==0);
      assert.deepEqual([...predicted.child_inputs].sort(),Object.keys(element.props).filter(key=>['children','fallback'].includes(key)).sort());assert.equal(element.props.children,child);
    };check(rule);let rejected=0;
    for(const mutation of [{value_type:'function'},{marker:'react.wrong'},{element_marker:'react.portal'},{type_property:'props'},{construction_invokes:true},{child_inputs:api==='Suspense'?['children']:['fallback']}]){
      assert.throws(()=>check({...rule,...mutation}));rejected++;
    }
    assert.throws(()=>Reflect.apply(actual,null,[]),TypeError);
    rows.push({api:`react/${api}/18.3.1`,incorrect_programs_rejected:rejected,stable_symbol_identity:actual===React[api],
      element_type_and_child_identity:true,construction_callbacks:callbacks,not_callable:true,renderer_behavior_proven:false});
  }
  console.log(JSON.stringify({build:process.env.NODE_ENV,rows}));
}
