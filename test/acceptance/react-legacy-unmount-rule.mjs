import assert from 'node:assert/strict';import path from 'node:path';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';import {validateReactExecutionRule,planReactLegacyUnmount} from '../../analysis/react-execution-rule.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
if(!process.argv.includes('--child')){
 const builds=['development','production'].map(build=>JSON.parse(execFileSync(process.execPath,[fileURLToPath(import.meta.url),repository,'--child'],{encoding:'utf8',env:{...process.env,NODE_ENV:build}})));
 console.log(JSON.stringify({api:'react-dom/unmountComponentAtNode/18.3.1',format_pass:true,behavior_pass:true,builds},null,2));
}else{
 const require=createRequire(path.join(repository,'package.json')),React=require('react'),DOM=require('react-dom'),Client=require('react-dom/client'),{JSDOM}=require('jsdom');assert.equal(React.version,'18.3.1');
 const browser=new JSDOM('<body><div id="app"></div><div id="outer"></div></body>');globalThis.window=browser.window;globalThis.document=browser.window.document;
 try{
  const rule=getReactBehavior({surface:'react-dom',exportName:'unmountComponentAtNode',version:'18.3.1'}).execution;assert.equal(validateReactExecutionRule(rule).valid,true);
  const cases=[],app=document.getElementById('app');let cleanups=0;
  class Owner extends React.Component{componentWillUnmount(){cleanups++;}render(){return React.createElement('span',null,'target');}}
  const probe=(container,rootKind)=>{const entry={args:[container],nodeType:container?.nodeType,nodeValue:container?.nodeValue,rootKind};let result,threw=false;
   try{result=DOM.unmountComponentAtNode(container);}catch(_){threw=true;}
   cases.push({entry,result,threw});return result;};
  DOM.render(React.createElement(Owner),app);assert.equal(probe(app,'legacy'),true);assert.equal(cleanups,1);assert.equal(app.childNodes.length,0);assert.equal(probe(app,'none'),false);assert.equal(cleanups,1);
  DOM.render(null,app);assert.equal(probe(app,'legacy'),true);assert.equal(probe(app,'none'),false);
  const modern=Client.createRoot(app);DOM.flushSync(()=>modern.render(React.createElement('b',null,'modern')));assert.equal(probe(app,'concurrent'),false);assert.equal(app.textContent,'modern');modern.unmount();
  for(const container of [document.createDocumentFragment(),document.implementation.createHTMLDocument(''),document.createComment(' react-mount-point-unstable '),document.createElement('div')])assert.equal(probe(container,'none'),false);
  for(const container of [null,undefined,document.createTextNode('text'),document.createComment('ordinary')])probe(container,'none');
  // Rendering elsewhere defers the synchronous flush. A true return alone must
  // never be promoted into a completed empty-tree claim.
  DOM.render(React.createElement(Owner),app);let once=false,insideResult,insideContent;
  function DuringRender(){if(!once){once=true;insideResult=DOM.unmountComponentAtNode(app);insideContent=app.textContent;}return React.createElement('i',null,'outer');}
  const outer=Client.createRoot(document.getElementById('outer'));DOM.flushSync(()=>outer.render(React.createElement(DuringRender)));
  assert.equal(insideResult,true);assert.equal(insideContent,'target');assert.equal(app.childNodes.length,0);outer.unmount();
  let reads=0;const reason={original:true};assert.throws(()=>DOM.unmountComponentAtNode({get nodeType(){reads++;throw reason;}}),error=>error===reason);assert.equal(reads,1);
  const agrees=candidate=>cases.every(({entry,result,threw})=>{const plan=planReactLegacyUnmount(candidate,entry);return plan.status==='planned'&&(threw?plan.operation==='throw':plan.operation!=='throw'&&plan.result===result)
    &&(entry.rootKind!=='legacy'||plan.flush==='flush_sync');});
  assert.equal(agrees(rule),true);
  const mutants=[{...rule,argument:1},{...rule,container_node_types:[1,9]},{...rule,container_node_types:[1,11]},
   {...rule,container_node_types:[1,3,9,11]},{...rule,comment_marker:'ordinary'},{...rule,root_kind:'any'},
   {...rule,present_result:false},{...rule,absent_result:true},{...rule,flush:'deferred'}];
  for(const candidate of mutants){assert.equal(validateReactExecutionRule(candidate).valid,true);assert.equal(agrees(candidate),false);}
  console.log(JSON.stringify({build:process.env.NODE_ENV,incorrect_programs_rejected:mutants.length,cases:cases.length,legacy_and_empty_root:true,
   modern_root_preserved:true,comment_document_fragment_validation:true,synchronous_cleanup:true,render_phase_true_before_commit:true,original_getter_error:true}));
 }finally{browser.window.close();}
}
