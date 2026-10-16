import assert from 'node:assert/strict';import path from 'node:path';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';import {validateReactExecutionRule,planReactLegacyRender} from '../../analysis/react-execution-rule.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous'),apis=['render','hydrate','unstable_renderSubtreeIntoContainer'];
if(!process.argv.includes('--child')){
 const builds=['development','production'].map(build=>JSON.parse(execFileSync(process.execPath,[fileURLToPath(import.meta.url),repository,'--child'],{encoding:'utf8',env:{...process.env,NODE_ENV:build}})));
 console.log(JSON.stringify({apis:apis.map(name=>`react-dom/${name}/18.3.1`),format_pass:true,behavior_pass:true,builds},null,2));
}else{
 const require=createRequire(path.join(repository,'package.json')),React=require('react'),DOM=require('react-dom'),Server=require('react-dom/server'),{JSDOM}=require('jsdom');assert.equal(React.version,'18.3.1');
 const browser=new JSDOM('<body></body>');globalThis.window=browser.window;globalThis.document=browser.window.document;
 try{
  const rows=[];const container=()=>{const value=document.createElement('div');document.body.appendChild(value);return value;};
  class Parent extends React.Component{getChildContext(){return {label:'inherited'};}render(){return React.createElement('b',null,'parent');}}Parent.childContextTypes={label:()=>null};
  class Child extends React.Component{render(){return React.createElement('span',null,this.props.label);}}
  function ReadContext(_props,context){return React.createElement('i',null,context.label||'default');}ReadContext.contextTypes={label:()=>null};
  const parentContainer=container(),parent=DOM.render(React.createElement(Parent),parentContainer);
  for(const api of apis){
   const subtree=api==='unstable_renderSubtreeIntoContainer',hydrate=api==='hydrate';
   const rule=getReactBehavior({surface:'react-dom',exportName:api,version:'18.3.1'}).execution;assert.equal(validateReactExecutionRule(rule).valid,true);
   const host=container(),element=React.createElement(Child,{label:'first'});host.innerHTML=Server.renderToString(element);const initialNode=host.firstChild,calls=[];
   function callback(){calls.push({receiver:this,args:Array.from(arguments),content:host.textContent});}
   const argsFor=(element,callback,container=host)=>subtree?[parent,element,container,callback]:[element,container,callback];
   const args=argsFor(element,callback),result=DOM[api](...args);assert.ok(result instanceof Child);assert.equal(calls.length,1);assert.equal(calls[0].receiver,result);assert.deepEqual(calls[0].args,[]);assert.equal(calls[0].content,'first');
   const reused=host.firstChild===initialNode;assert.equal(reused,hydrate);
   const second=React.createElement(Child,{label:'second'});let duringResult,duringCalls,duringContent;
   DOM.unstable_batchedUpdates(()=>{duringResult=DOM[api](...argsFor(second,callback));duringCalls=calls.length;duringContent=host.textContent;});
   assert.equal(duringResult,result);assert.equal(duringCalls,1);assert.equal(duringContent,'first');assert.equal(host.textContent,'second');assert.equal(calls.length,2);assert.equal(calls[1].receiver,result);
   const nativeResult=DOM[api](...argsFor(React.createElement('input'),callback));assert.equal(nativeResult,host.firstChild);assert.equal(calls.at(-1).receiver,nativeResult);
   const functionResult=DOM[api](...argsFor(React.createElement(ReadContext),callback));assert.equal(functionResult,null);assert.equal(calls.at(-1).receiver,null);assert.equal(host.textContent,subtree?'inherited':'default');
   const emptyResult=DOM[api](...argsFor(null,callback));assert.equal(emptyResult,null);assert.equal(calls.at(-1).receiver,null);assert.equal(host.childNodes.length,0);
   for(const invalid of [null,document.createTextNode('bad'),document.createComment('bad')])assert.throws(()=>DOM[api](...argsFor(element,callback,invalid)));
   if(subtree)assert.throws(()=>DOM[api](null,element,host,callback));
   const reason={original:true};assert.throws(()=>DOM[api](...argsFor(element,()=>{throw reason;})),error=>error===reason);
   const agrees=candidate=>{
    const first=planReactLegacyRender(candidate,{args,rootState:'initial',publicInstance:result,parentValid:true});
    const update=planReactLegacyRender(candidate,{args:argsFor(second,callback),rootState:'existing',publicInstance:result,parentValid:true});
    return first.status==='planned'&&first.element===element&&first.container===host&&first.parent===(subtree?parent:null)&&first.callback===callback
     &&first.initial_mode===(reused?'hydrate':'render')&&first.scheduling==='flush_sync'&&update.scheduling==='schedule'
     &&first.result===result&&first.callback_receiver===calls[0].receiver&&JSON.stringify(first.callback_arguments)===JSON.stringify(calls[0].args)
     &&first.parent_context===(subtree?'parent_instance':'none');};
   assert.equal(agrees(rule),true);const mutants=[{...rule,argument:rule.element_argument},{...rule,element_argument:rule.argument},{...rule,callback_argument:rule.element_argument},
    {...rule,mode:hydrate?'render':'hydrate'},{...rule,initial_flush:'deferred'},{...rule,updates:'always_flush'},{...rule,result:'undefined'},
    {...rule,callback_receiver:'undefined'},{...rule,callback_arguments:[rule.element_argument]},{...rule,parent_context:subtree?'none':'parent_instance'},
    {...rule,parent_argument:subtree?null:0}];
   for(const candidate of mutants){assert.equal(validateReactExecutionRule(candidate).valid,true);assert.equal(agrees(candidate),false);}
   DOM.unmountComponentAtNode(host);host.remove();rows.push({api:`react-dom/${api}/18.3.1`,incorrect_programs_rejected:mutants.length,initial_commit_before_return:true,
    hydration_reuse:hydrate,render_replaces_initial_markup:!hydrate,batched_update_deferred:true,public_class_host_function_and_empty:true,
    callback_receiver_arguments_commit:true,legacy_parent_context:subtree,invalid_containers_and_parent:true,callback_error_identity:true});
  }
  DOM.unmountComponentAtNode(parentContainer);parentContainer.remove();console.log(JSON.stringify({build:process.env.NODE_ENV,rows}));
 }finally{browser.window.close();}
}
