import assert from 'node:assert/strict';import path from 'node:path';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';import {validateReactExecutionRule,planReactReadableStream} from '../../analysis/react-execution-rule.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
if(!process.argv.includes('--child')){
 const builds=['development','production'].map(build=>JSON.parse(execFileSync(process.execPath,[fileURLToPath(import.meta.url),repository,'--child'],{encoding:'utf8',env:{...process.env,NODE_ENV:build},timeout:15000})));
 console.log(JSON.stringify({api:'react-dom/server/renderToReadableStream/18.3.1',format_pass:true,behavior_pass:true,builds},null,2));
}else{
 const require=createRequire(path.join(repository,'package.json')),React=require('react'),Server=require('react-dom/server.browser');assert.equal(React.version,'18.3.1');
 const rule=getReactBehavior({surface:'react-dom/server',exportName:'renderToReadableStream',version:'18.3.1'}).execution;assert.equal(validateReactExecutionRule(rule).valid,true);
 const consume=async stream=>{const reader=stream.getReader(),decoder=new TextDecoder();let html='';for(;;){const item=await reader.read();if(item.done)break;html+=decoder.decode(item.value,{stream:true});}return html+decoder.decode();};
 let renders=0,effects=0;
 function App(){renders++;const id=React.useId();React.useEffect(()=>{effects++;},[]);return React.createElement('article',{id},'left','&right');}
 const element=React.createElement(App),options={identifierPrefix:'oracle-'},promise=Server.renderToReadableStream(element,options);
 assert.equal(renders,1);assert.ok(promise instanceof Promise);const stream=await promise;assert.ok(stream instanceof ReadableStream);await stream.allReady;
 const markup=await consume(stream);assert.match(markup,/oracle-/);assert.match(markup,/<!-- -->/);assert.match(markup,/&amp;right/);assert.equal(effects,0);
 const pending=()=>{let finish,done=false;const gate=new Promise(resolve=>finish=()=>{done=true;resolve();});function Wait(){if(!done)throw gate;return React.createElement('b',null,'ready');}
  return {element:React.createElement(React.Suspense,{fallback:React.createElement('i',null,'waiting')},React.createElement(Wait)),finish};};
 const work=pending(),partial=await Server.renderToReadableStream(work.element);let allReady=false;partial.allReady.then(()=>allReady=true);await Promise.resolve();assert.equal(allReady,false);
 const reader=partial.getReader(),chunk=await reader.read();assert.match(new TextDecoder().decode(chunk.value),/waiting/);assert.equal(allReady,false);work.finish();await partial.allReady;assert.equal(allReady,true);while(!(await reader.read()).done){}
 const cancelled=pending(),cancelReason={cancelled:true},cancelErrors=[],cancelStream=await Server.renderToReadableStream(cancelled.element,{onError:error=>{cancelErrors.push(error);}});
 await cancelStream.cancel(cancelReason);await cancelStream.allReady;assert.equal(cancelErrors.length,1);assert.notEqual(cancelErrors[0],cancelReason);assert.match(String(cancelErrors[0]),process.env.NODE_ENV==='production'?/Minified React error #432/:/aborted/);
 const aborting=pending(),controller=new AbortController(),signalReason={signal:true},abortErrors=[];
 const abortStream=await Server.renderToReadableStream(aborting.element,{signal:controller.signal,onError:error=>{abortErrors.push(error);}});controller.abort(signalReason);await abortStream.allReady;assert.equal(abortErrors[0],signalReason);await consume(abortStream);
 const already=pending(),before=new AbortController(),earlyErrors=[];before.abort({early:true});
 const earlyStream=await Server.renderToReadableStream(already.element,{signal:before.signal,onError:error=>{earlyErrors.push(error);}});assert.equal(earlyErrors.length,0);already.finish();await earlyStream.allReady;assert.match(await consume(earlyStream),/ready/);assert.equal(earlyErrors.length,0);
 const failure={fatal:true};function Fail(){throw failure;}const rejected=Server.renderToReadableStream(React.createElement(Fail),{onError:()=>{}});await assert.rejects(rejected,error=>error===failure);
 let reads=0;const reason={getter:true};const invalid=Server.renderToReadableStream(element,{get identifierPrefix(){reads++;throw reason;}});await assert.rejects(invalid,error=>error===reason);assert.equal(reads,1);
 const agrees=candidate=>{const plan=planReactReadableStream(candidate,{args:[element,options]}),cancel=planReactReadableStream(candidate,{operation:'cancel',reason:cancelReason}),future=planReactReadableStream(candidate,{operation:'signal',reason:signalReason}),early=planReactReadableStream(candidate,{operation:'signal',preaborted:true});
  return plan.status==='planned'&&plan.element===element&&plan.options===options&&plan.callback_timing==='synchronous'&&plan.result===typeof promise
   &&plan.resolve_at==='shell'&&plan.all_ready==='all_tasks'&&plan.effects==='none'&&cancel.operation==='abort'&&cancel.reason===undefined&&future.operation==='abort'&&early.operation==='ignore';};
 assert.equal(agrees(rule),true);const mutants=[{...rule,element_argument:1},{...rule,options_argument:0},{...rule,callback_timing:'deferred'},{...rule,result:'string'},
  {...rule,resolve_at:'all_tasks'},{...rule,all_ready:'shell'},{...rule,effects:'invoke'},{...rule,cancel:'ignore'},{...rule,cancel_reason:'forward'},{...rule,signal:'ignore'},{...rule,preaborted_signal:'abort'}];
 for(const candidate of mutants){assert.equal(validateReactExecutionRule(candidate).valid,true);assert.equal(agrees(candidate),false);}
 console.log(JSON.stringify({build:process.env.NODE_ENV,incorrect_programs_rejected:mutants.length,initial_component_synchronous:true,original_promise_and_web_stream:true,
  shell_before_all_ready:true,cancel_reason_ignored:true,future_abort_reason_forwarded:true,preaborted_signal_ignored:true,effects_not_invoked:true,prefix_escaping_markers:true,
  fatal_and_getter_rejections_preserved:true}));
}
