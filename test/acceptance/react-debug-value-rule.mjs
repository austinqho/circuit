import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';
import {validateReactExecutionRule,planDebugValue} from '../../analysis/react-execution-rule.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
if(!process.env.PRODUCTTRACE_DEBUG_ORACLE_CHILD) {
 const builds=['development','production'].map(build=>JSON.parse(execFileSync(process.execPath,[new URL(import.meta.url).pathname,repository],{
  encoding:'utf8',env:{...process.env,NODE_ENV:build,PRODUCTTRACE_DEBUG_ORACLE_CHILD:'1'}})));
 console.log(JSON.stringify({api:'react/useDebugValue/18.3.1',format_pass:true,behavior_pass:true,builds},null,2));
} else {
 const require=createRequire(path.join(repository,'package.json')),React=require('react'),server=require('react-dom/server'),build=process.env.NODE_ENV;
 assert.equal(React.version,'18.3.1');
 const rule=getReactBehavior({surface:'react',exportName:'useDebugValue',version:React.version}).execution;
 const values=[undefined,null,0,false,'label',{},()=>{}];let calls=0;
 const formatter=value=>{calls++;return value;},observations=[];
 function App({value}){const result=React.useDebugValue(value,formatter);observations.push({value,result});return React.createElement('span',null,'ok');}
 for(const value of values)assert.equal(server.renderToString(React.createElement(App,{value})),'<span>ok</span>');
 assert.equal(calls,0);
 // The oracle supplies a dispatcher only to check the public entrypoint's
 // forwarding/return contract. This is not a test of React DevTools itself.
 const holder=React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher,previous=holder.current;
 const supplied={},returned={},delegated=[];
 try {
  holder.current={useDebugValue(...args){delegated.push(args);return returned;}};
  const result=React.useDebugValue(supplied,formatter);
  assert.equal(result,build==='development'?returned:undefined);
  assert.deepEqual(delegated,build==='development'?[[supplied,formatter]]:[]);
  const error=Error('dispatcher');holder.current={useDebugValue(){throw error;}};
  if(build==='development')assert.throws(()=>React.useDebugValue(supplied,formatter),value=>value===error);
  else assert.equal(React.useDebugValue(supplied,formatter),undefined);
 }finally{holder.current=previous;}
 function agrees(program) {
  if(!validateReactExecutionRule(program).valid)return false;
  for(const row of observations){const plan=planDebugValue(program,{build,dispatcher:'standard_renderer',args:[row.value,formatter]});
   if(plan.operation!=='return'||plan.value!==row.result||plan.callbacks.length!==0)return false;}
  const plan=planDebugValue(program,{build,dispatcher:'external',args:[supplied,formatter]});
  if(delegated.length)return plan.operation==='delegate' && plan.arguments[0]===delegated[0][0] && plan.arguments[1]===delegated[0][1] && plan.return_from_dispatcher && plan.throws_from_dispatcher;
  return plan.operation==='return' && plan.value===undefined && plan.callbacks.length===0;
 }
 assert.equal(agrees(rule),true);
 const changes=build==='development'?[{value_argument:1,formatter_argument:0},{development:'ignore'},{renderer_formatter:'invoke'},{renderer_result:'value'}]:[{production:'delegate'}];
 for(const change of changes){const mutant={...rule,...change};assert.equal(validateReactExecutionRule(mutant).valid,true);assert.equal(agrees(mutant),false,JSON.stringify(change));}
 console.log(JSON.stringify({build,normal_renderer_cases:observations.length,normal_formatter_calls:calls,incorrect_programs_rejected:changes.length,
   exact_dispatcher_arguments_and_return:true,dispatcher_throw_preserved:true,official_devtools_inspection_tested:false}));
}
