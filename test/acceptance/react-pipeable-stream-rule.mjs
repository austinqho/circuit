import assert from 'node:assert/strict';import path from 'node:path';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {PassThrough} from 'node:stream';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';import {validateReactExecutionRule,planReactPipeableStream} from '../../analysis/react-execution-rule.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
if(!process.argv.includes('--child')){
 const builds=['development','production'].map(build=>JSON.parse(execFileSync(process.execPath,[fileURLToPath(import.meta.url),repository,'--child'],{encoding:'utf8',env:{...process.env,NODE_ENV:build},timeout:15000})));
 console.log(JSON.stringify({api:'react-dom/server/renderToPipeableStream/18.3.1',format_pass:true,behavior_pass:true,builds},null,2));
}else{
 const require=createRequire(path.join(repository,'package.json')),React=require('react'),Server=require('react-dom/server');assert.equal(React.version,'18.3.1');
 const rule=getReactBehavior({surface:'react-dom/server',exportName:'renderToPipeableStream',version:'18.3.1'}).execution;assert.equal(validateReactExecutionRule(rule).valid,true);
 const collect=destination=>{let html='';destination.setEncoding('utf8');destination.on('data',chunk=>html+=chunk);return new Promise((resolve,reject)=>{destination.on('end',()=>resolve(html));destination.on('error',reject);});};
 let renders=0,effects=0,resolveShell,resolveAll;const callbacks=[];
 function App(){renders++;React.useEffect(()=>{effects++;},[]);return React.createElement('p',{id:React.useId()},'one','&two');}
 const shell=new Promise(resolve=>resolveShell=resolve),all=new Promise(resolve=>resolveAll=resolve),element=React.createElement(App);
 const options={identifierPrefix:'pipe-',onShellReady:function(){callbacks.push({phase:'shell',args:Array.from(arguments)});resolveShell();},onAllReady:function(){callbacks.push({phase:'all',args:Array.from(arguments)});resolveAll();}};
 const handle=Server.renderToPipeableStream(element,options);assert.equal(renders,0);assert.equal(typeof handle.pipe,'function');assert.equal(typeof handle.abort,'function');
 await shell;await all;assert.equal(renders,1);assert.equal(effects,0);assert.deepEqual(callbacks,[{phase:'shell',args:[]},{phase:'all',args:[]}]);
 const destination=new PassThrough(),finished=collect(destination);assert.equal(handle.pipe(destination),destination);assert.throws(()=>handle.pipe(new PassThrough()),/one writable/);
 const html=await finished;assert.match(html,/pipe-/);assert.match(html,/<!-- -->/);assert.match(html,/&amp;two/);
 const pending=()=>{let finish,done=false;const gate=new Promise(resolve=>finish=()=>{done=true;resolve();});function Wait(){if(!done)throw gate;return React.createElement('b',null,'ready');}return {element:React.createElement(React.Suspense,{fallback:'waiting'},React.createElement(Wait)),finish};};
 const work=pending();let resolveReady,allDone=false;const ready=new Promise(resolve=>resolveReady=resolve);const partial=Server.renderToPipeableStream(work.element,{onShellReady:resolveReady,onAllReady:()=>allDone=true});await ready;assert.equal(allDone,false);
 const partialDestination=new PassThrough(),partialFinished=collect(partialDestination);partial.pipe(partialDestination);assert.equal(allDone,false);work.finish();assert.match(await partialFinished,/ready/);assert.equal(allDone,true);
 const aborting=pending(),reason={abort:true},errors=[];let resolveAbortShell;const abortShell=new Promise(resolve=>resolveAbortShell=resolve);
 const cancelled=Server.renderToPipeableStream(aborting.element,{onShellReady:resolveAbortShell,onError:error=>{errors.push(error);}});await abortShell;cancelled.abort(reason);assert.equal(errors[0],reason);
 const cancelledDestination=new PassThrough(),cancelledFinished=collect(cancelledDestination);cancelled.pipe(cancelledDestination);await cancelledFinished;
 const fatal={fatal:true};function Fail(){throw fatal;}let rejectShell;const failed=new Promise((_,reject)=>rejectShell=reject);Server.renderToPipeableStream(React.createElement(Fail),{onError:()=>{},onShellError:rejectShell});await assert.rejects(failed,error=>error===fatal);
 let reads=0;const getterError={getter:true};assert.throws(()=>Server.renderToPipeableStream(element,{get identifierPrefix(){reads++;throw getterError;}}),error=>error===getterError);assert.equal(reads,1);
 const agrees=candidate=>{const plan=planReactPipeableStream(candidate,{args:[element,options]}),first=planReactPipeableStream(candidate,{operation:'pipe',destination}),second=planReactPipeableStream(candidate,{operation:'pipe',destination,pipeCount:1}),abort=planReactPipeableStream(candidate,{operation:'abort',reason});
  return plan.status==='planned'&&plan.element===element&&plan.options===options&&plan.callback_timing==='asynchronous'&&plan.result===typeof handle&&plan.effects==='none'
   &&plan.shell_callback==='shell'&&plan.all_callback==='all_tasks'&&JSON.stringify(plan.callback_arguments)===JSON.stringify(callbacks[0].args)
   &&first.operation==='pipe'&&first.result===destination&&second.operation==='throw'&&abort.operation==='abort'&&abort.reason===reason;};
 assert.equal(agrees(rule),true);const mutants=[{...rule,element_argument:1},{...rule,options_argument:0},{...rule,callback_timing:'synchronous'},{...rule,result:'string'},
  {...rule,effects:'invoke'},{...rule,shell_callback:'all_tasks'},{...rule,all_callback:'shell'},{...rule,callback_arguments:[0]},{...rule,pipe_count:2},{...rule,pipe_result:'undefined'},{...rule,abort:'ignore'}];
 for(const candidate of mutants){assert.equal(validateReactExecutionRule(candidate).valid,true);assert.equal(agrees(candidate),false);}
 console.log(JSON.stringify({build:process.env.NODE_ENV,incorrect_programs_rejected:mutants.length,initial_render_deferred:true,shell_before_all_tasks:true,
  callbacks_no_arguments:true,original_destination_and_one_pipe:true,abort_reason_forwarded:true,effects_not_invoked:true,prefix_escaping_markers:true,fatal_and_getter_identity:true}));
}
