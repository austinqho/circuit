import assert from 'node:assert/strict';import path from 'node:path';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';import {validateReactExecutionRule,planReactServerString} from '../../analysis/react-execution-rule.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
if(!process.argv.includes('--child')){
 const builds=['development','production'].map(build=>JSON.parse(execFileSync(process.execPath,[fileURLToPath(import.meta.url),repository,'--child'],{encoding:'utf8',env:{...process.env,NODE_ENV:build}})));
 console.log(JSON.stringify({apis:['react-dom/server/renderToString/18.3.1','react-dom/server/renderToStaticMarkup/18.3.1'],format_pass:true,behavior_pass:true,builds},null,2));
}else{
 const require=createRequire(path.join(repository,'package.json')),React=require('react'),Server=require('react-dom/server');assert.equal(React.version,'18.3.1');
 const rows=[];
 for(const name of ['renderToString','renderToStaticMarkup']){
  const rule=getReactBehavior({surface:'react-dom/server',exportName:name,version:'18.3.1'}).execution;assert.equal(validateReactExecutionRule(rule).valid,true);
  const calls=[];let effects=0,events=0,optionReads=0;
  function App(props){calls.push(props);const id=React.useId();React.useEffect(()=>effects++);return React.createElement('button',{id,onClick:()=>events++},props.value,'tail');}
  const element=React.createElement(App,{value:'<&"'}),options={get identifierPrefix(){optionReads++;return 'oracle-';}};
  const html=Server[name](element,options);assert.equal(typeof html,'string');assert.deepEqual(calls,[element.props]);assert.equal(effects,0);assert.equal(events,0);assert.equal(optionReads,1);
  function LayoutProbe(){React.useLayoutEffect(()=>effects++);return null;}Server[name](React.createElement(LayoutProbe));assert.equal(effects,0);
  assert.match(html,/&lt;&amp;&quot;/);assert.match(html,/id=":oracle-R0:"/);
  const markers=html.includes('<!-- -->');assert.equal(markers,name==='renderToString');
  let loaderCalls=0;const pending={then(){}};function Suspend(){loaderCalls++;throw pending;}
  const fallback=Server[name](React.createElement(React.Suspense,{fallback:React.createElement('b',null,'pending')},React.createElement(Suspend)));
  assert.match(fallback,/<b>pending<\/b>/);assert.equal(fallback.includes('<!--'),name==='renderToString');assert.equal(loaderCalls,1);
  assert.throws(()=>Server[name](React.createElement(Suspend)));
  const reason={failure:true};function Broken(){throw reason;}assert.throws(()=>Server[name](React.createElement(Broken)),error=>error===reason);
  assert.equal(Server[name](null),'');assert.equal(Server[name]('plain'),'plain');
  const agrees=candidate=>{const ordinary=planReactServerString(candidate,{args:[element,options]}),pendingPlan=planReactServerString(candidate,{args:[element],suspended:true,boundary:true}),outside=planReactServerString(candidate,{suspended:true});
   return ordinary.element===element&&ordinary.options===options&&ordinary.operation==='render'&&ordinary.callback_timing==='synchronous'
    &&ordinary.effects==='none'&&ordinary.result===typeof html&&(ordinary.output==='hydratable')===markers&&pendingPlan.operation==='fallback'&&outside.operation==='throw';};
  assert.equal(agrees(rule),true);
  const mutants=[{...rule,element_argument:1},{...rule,options_argument:0},{...rule,output:rule.output==='static'?'hydratable':'static'},
   {...rule,suspension:'wait'},{...rule,outside_boundary:'fallback'},{...rule,callback_timing:'deferred'},{...rule,effects:'invoke'},{...rule,result:'promise'}];
  for(const candidate of mutants){assert.equal(validateReactExecutionRule(candidate).valid,true);assert.equal(agrees(candidate),false);}
  rows.push({api:`react-dom/server/${name}/18.3.1`,incorrect_programs_rejected:mutants.length,synchronous_component:true,client_effects_and_events_not_invoked:true,
   prefix_and_escaping:true,output_markers_verified:true,pending_fallback_without_waiting:true,outside_boundary_rejected:true,fatal_error_identity_preserved:true,option_getter_not_replayed:true});
 }
 console.log(JSON.stringify({build:process.env.NODE_ENV,rows}));
}
