import assert from 'node:assert/strict';import path from 'node:path';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';import {validateReactExecutionRule,planReactHostLookup} from '../../analysis/react-execution-rule.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
if(!process.argv.includes('--child')){
 const builds=['development','production'].map(build=>JSON.parse(execFileSync(process.execPath,[fileURLToPath(import.meta.url),repository,'--child'],{encoding:'utf8',env:{...process.env,NODE_ENV:build}})));
 console.log(JSON.stringify({api:'react-dom/findDOMNode/18.3.1',format_pass:true,behavior_pass:true,builds},null,2));
}else{
 const require=createRequire(path.join(repository,'package.json')),React=require('react'),DOM=require('react-dom'),Client=require('react-dom/client'),{JSDOM}=require('jsdom');assert.equal(React.version,'18.3.1');
 const browser=new JSDOM('<body><div id="app"></div><div id="portal"></div></body>');globalThis.window=browser.window;globalThis.document=browser.window.document;
 try{
 const rule=getReactBehavior({surface:'react-dom',exportName:'findDOMNode',version:'18.3.1'}).execution;assert.equal(validateReactExecutionRule(rule).valid,true);
 const container=document.getElementById('app'),portal=document.getElementById('portal'),root=Client.createRoot(container);let instance;
 class Owner extends React.Component {render(){return this.props.tree;}}
 const render=tree=>DOM.flushSync(()=>root.render(React.createElement(Owner,{ref:value=>{if(value)instance=value;},tree})));
 render([React.createElement('input',{key:'first'}),React.createElement('button',{key:'second'},'second')]);
 const first=container.firstChild,second=container.lastChild;assert.equal(DOM.findDOMNode(instance),first);assert.equal(DOM.findDOMNode(first),first);
 assert.equal(DOM.findDOMNode(null),null);assert.equal(DOM.findDOMNode(undefined),null);
 render('text');const text=container.firstChild;assert.equal(DOM.findDOMNode(instance),text);
 render([DOM.createPortal(React.createElement('b',null,'portal'),portal),React.createElement('i',{key:'last'},'last')]);
 const portalled=portal.firstChild;assert.equal(DOM.findDOMNode(instance),portalled);
 render(null);assert.equal(DOM.findDOMNode(instance),null);
 root.unmount();assert.throws(()=>DOM.findDOMNode(instance));assert.throws(()=>DOM.findDOMNode(document.createTextNode('detached')));
 let reads=0;const marker={get nodeType(){reads++;return 1;}};assert.equal(DOM.findDOMNode(marker),marker);assert.equal(reads,1);
 const reason={original:true};assert.throws(()=>DOM.findDOMNode({get nodeType(){throw reason;}}),error=>error===reason);
 const leaf=(tag,value)=>({tag,value,children:[],complete:true}),branch=children=>({tag:1,children,complete:true});
 const tree=branch([leaf(5,first),leaf(5,second)]),textTree=branch([leaf(6,text)]),portalTree=branch([{tag:4,children:[leaf(5,portalled)],complete:true},leaf(5,second)]);
 const agrees=candidate=>{
  const call=(input,extra={})=>planReactHostLookup(candidate,{args:[input],mounted:true,...extra});
  return call(null).operation==='return'&&call(undefined).value===null&&call(first,{nodeType:1}).value===first
   &&call(instance,{currentTree:tree,providedTree:branch([leaf(5,second)])}).value===first
   &&call(instance,{currentTree:textTree}).value===text&&call(instance,{currentTree:portalTree}).value===portalled
   &&call(instance,{currentTree:branch([])}).operation==='return'&&call(instance,{mounted:false}).operation==='throw';};
 assert.equal(agrees(rule),true);const mutants=[{...rule,argument:1},{...rule,nullish:'throw'},{...rule,element_node_type:3},{...rule,instance_source:'provided_fiber'},
  {...rule,host_tags:[5]},{...rule,traversal:'reverse'},{...rule,empty:'throw'},{...rule,detached:'null'},{...rule,portals:'skip'}];
 for(const candidate of mutants){assert.equal(validateReactExecutionRule(candidate).valid,true);assert.equal(agrees(candidate),false);}
 console.log(JSON.stringify({build:process.env.NODE_ENV,incorrect_programs_rejected:mutants.length,current_host_after_updates:true,first_host_text_and_portal:true,
  null_and_empty:true,unmounted_rejected:true,ordinary_property_access_and_error_identity:true}));
 }finally{browser.window.close();}
}
