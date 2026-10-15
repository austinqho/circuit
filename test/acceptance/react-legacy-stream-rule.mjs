import assert from 'node:assert/strict';import path from 'node:path';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';import {validateReactExecutionRule,planReactLegacyServerStream} from '../../analysis/react-execution-rule.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
if(!process.argv.includes('--child')){
 const builds=['development','production'].map(build=>JSON.parse(execFileSync(process.execPath,[fileURLToPath(import.meta.url),repository,'--child'],{encoding:'utf8',env:{...process.env,NODE_ENV:build}})));
 console.log(JSON.stringify({apis:['react-dom/server/renderToNodeStream/18.3.1','react-dom/server/renderToStaticNodeStream/18.3.1'],format_pass:true,behavior_pass:true,builds},null,2));
}else{
 const require=createRequire(path.join(repository,'package.json')),React=require('react'),Server=require('react-dom/server'),Browser=require('react-dom/server.browser');assert.equal(React.version,'18.3.1');
 const rows=[],text=async stream=>{let value='';for await(const chunk of stream)value+=chunk;return value;};
 for(const name of ['renderToNodeStream','renderToStaticNodeStream']){
  const rule=getReactBehavior({surface:'react-dom/server',exportName:name,version:'18.3.1'}).execution;assert.equal(validateReactExecutionRule(rule).valid,true);
  let calls=0,effects=0,optionReads=0;function App(props){calls++;const id=React.useId();React.useEffect(()=>effects++);return React.createElement('b',{id},props.value,'tail');}
  const element=React.createElement(App,{value:'<&'}),options={get identifierPrefix(){optionReads++;return 'stream-';}},stream=Server[name](element,options);
  assert.equal(calls,1);assert.equal(effects,0);assert.equal(optionReads,1);assert.equal(typeof stream,'object');
  const html=await text(stream);assert.equal(html,'<b id=":stream-R0:">&lt;&amp;<!-- -->tail</b>');
  let release,ready=false,attempts=0;const pending=new Promise(resolve=>release=()=>{ready=true;resolve();});
  function Later(){attempts++;if(!ready)throw pending;return React.createElement('i',null,'ready');}
  const delayed=Server[name](React.createElement(React.Suspense,{fallback:React.createElement('i',null,'waiting')},React.createElement(Later)));
  let chunks=0;delayed.on('data',()=>chunks++);const completed=text(delayed);await new Promise(resolve=>setImmediate(resolve));assert.equal(chunks,0);assert.equal(attempts,1);
  release();const resolved=await completed;assert.match(resolved,/<i>ready<\/i>/);assert.equal(resolved.includes('waiting'),false);assert.equal(attempts,2);
  let abortedAttempts=0;function Never(){abortedAttempts++;throw new Promise(()=>{});}const cancelled=Server[name](React.createElement(Never));
  const closed=new Promise(resolve=>cancelled.once('close',resolve));cancelled.destroy();await closed;assert.equal(cancelled.destroyed,true);assert.equal(cancelled.request.abortableTasks.size,0);assert.equal(abortedAttempts,1);
  let browserCalls=0;function BrowserApp(){browserCalls++;return null;}assert.throws(()=>Browser[name](React.createElement(BrowserApp)),process.env.NODE_ENV==='production'?new RegExp('Minified React error #'+(name==='renderToNodeStream'?'207':'208')):/not available.*browser/);assert.equal(browserCalls,0);
  const agrees=candidate=>{const created=planReactLegacyServerStream(candidate,{args:[element,options],environment:'node'}),browser=planReactLegacyServerStream(candidate,{environment:'browser'}),destroy=planReactLegacyServerStream(candidate,{environment:'node',operation:'destroy'});
   return created.element===element&&created.options===options&&created.output==='hydratable'&&created.ready==='all_tasks'&&created.callback_timing==='synchronous'&&created.effects==='none'&&created.result===typeof stream&&browser.operation==='throw'&&destroy.operation==='abort';};
  assert.equal(agrees(rule),true);const mutants=[{...rule,element_argument:1},{...rule,options_argument:0},{...rule,output:'static'},{...rule,ready:'shell'},
   {...rule,browser:'render'},{...rule,destroy:'ignore'},{...rule,callback_timing:'deferred'},{...rule,effects:'invoke'},{...rule,result:'string'}];
  for(const candidate of mutants){assert.equal(validateReactExecutionRule(candidate).valid,true);assert.equal(agrees(candidate),false);}
  rows.push({api:`react-dom/server/${name}/18.3.1`,incorrect_programs_rejected:mutants.length,synchronous_initial_component:true,
   hydratable_marker_quirk_verified:true,all_tasks_before_output:true,retry_after_resolution:true,destroy_aborts_pending_work:true,browser_rejected_before_component:true,prefix_and_escaping:true,effects_not_invoked:true});
 }
 console.log(JSON.stringify({build:process.env.NODE_ENV,rows}));
}
