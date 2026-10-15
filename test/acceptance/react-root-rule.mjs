import assert from 'node:assert/strict';import path from 'node:path';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';import {validateReactExecutionRule,planReactRootOperation} from '../../analysis/react-execution-rule.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
if(!process.argv.includes('--child')){
 const builds=['development','production'].map(build=>JSON.parse(execFileSync(process.execPath,[fileURLToPath(import.meta.url),repository,'--child'],{encoding:'utf8',env:{...process.env,NODE_ENV:build}})));
 console.log(JSON.stringify({apis:['react-dom/createRoot/18.3.1','react-dom/hydrateRoot/18.3.1','react-dom/client/createRoot/18.3.1','react-dom/client/hydrateRoot/18.3.1'],format_pass:true,behavior_pass:true,builds},null,2));
}else{
 const require=createRequire(path.join(repository,'package.json')),React=require('react'),DOM=require('react-dom'),Client=require('react-dom/client'),Server=require('react-dom/server'),{JSDOM}=require('jsdom');
 assert.equal(React.version,'18.3.1');assert.equal(DOM.version.startsWith('18.3.1'),true);
 const dom=new JSDOM('<body></body>');globalThis.window=dom.window;globalThis.document=dom.window.document;
 const rows=[];
 try{
  for(const [surface,library] of [['react-dom',DOM],['react-dom/client',Client]])for(const name of ['createRoot','hydrateRoot']){
   const rule=getReactBehavior({surface,exportName:name,version:'18.3.1'}).execution,hydrate=name==='hydrateRoot';
   assert.equal(validateReactExecutionRule(rule).valid,true);
   const host=document.createElement('div');document.body.append(host);let renders=0,effects=0,cleanups=0;
   function Probe({label}){renders++;const id=React.useId();React.useEffect(()=>{effects++;return()=>cleanups++;},[]);return React.createElement('output',{id},label);}
   const initial=React.createElement(Probe,{label:'initial'}),next=React.createElement(Probe,{label:'next'}),options={identifierPrefix:'probe-',onRecoverableError:error=>{throw error;}};
   if(hydrate)host.innerHTML=Server.renderToString(initial,options);renders=0;
   const originalNode=host.firstChild,args=hydrate?[host,initial,options]:[host,options],root=library[name](...args);
   assert.equal(renders,0,'root creation schedules rather than synchronously invoking the component');
   assert.equal(root._internalRoot.containerInfo,host);
   if(hydrate){for(let i=0;i<100&&effects===0;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(effects,1);assert.equal(host.firstChild,originalNode);}
   else DOM.flushSync(()=>root.render(initial));
   assert.equal(host.textContent,'initial');assert.match(host.firstChild.id,/^:probe-/);assert.equal(effects,1);
   let ignoredCallback=0;const renderResult=DOM.flushSync(()=>root.render(next,()=>ignoredCallback++));assert.equal(renderResult,undefined);assert.equal(host.textContent,'next');assert.equal(ignoredCallback,0);
   assert.equal(root.unmount(),undefined);assert.equal(host.textContent,'');assert.equal(cleanups,1);assert.equal(root._internalRoot,null);
   assert.equal(root.unmount(),undefined);assert.throws(()=>root.render(initial));
   for(const invalid of [null,document.createTextNode('text'),document.createComment('comment')])assert.throws(()=>library[name](invalid,initial));
   const agrees=candidate=>{
    const create=planReactRootOperation(candidate,{operation:'create',args,containerNodeType:1});
    const render=planReactRootOperation(candidate,{operation:'render',args:[next]});
    const dead=planReactRootOperation(candidate,{operation:'render',state:'unmounted',args:[initial]});
    const unmount=planReactRootOperation(candidate,{operation:'unmount'}),repeat=planReactRootOperation(candidate,{operation:'unmount',state:'unmounted'});
    return create.operation==='allocate'&&create.container===host&&create.options===options&&create.identifier_prefix==='probe-'
      &&create.recoverable_error_callback===options.onRecoverableError&&create.initial_children===(hydrate?initial:undefined)
      &&create.schedules_initial_tree===hydrate&&render.children===next&&render.operation==='schedule'&&dead.operation==='throw'
      &&unmount.timing==='synchronous'&&repeat.operation==='noop';
   };
   assert.equal(agrees(rule),true);
   const mutants=[{...rule,container_argument:1},{...rule,options_argument:0},{...rule,mode:hydrate?'create':'hydrate'},
    {...rule,container_node_types:[9,11]},{...rule,render_argument:1},{...rule,render_after_unmount:'schedule'},
    {...rule,unmount_timing:'scheduled'},{...rule,repeat_unmount:'throw'}];
   for(const candidate of mutants){assert.equal(validateReactExecutionRule(candidate).valid,true);assert.equal(agrees(candidate),false);}
   const malformed=[{...rule,identifier_prefix_option:'prefix'},{...rule,recoverable_error_option:'onError'}];
   for(const candidate of malformed)assert.equal(validateReactExecutionRule(candidate).valid,false);
   host.remove();rows.push({api:`${surface}/${name}/18.3.1`,incorrect_programs_rejected:mutants.length,scheduled_not_committed_at_creation:true,
    hydration_reuses_dom:hydrate,identifier_prefix_consumed:true,recoverable_error_option_checked:true,format_mutants_rejected:malformed.length,
    render_callback_ignored:true,unmount_cleanup_observed:true,repeat_unmount_noop:true,render_after_unmount_rejected:true,invalid_containers_rejected:true});
  }
  console.log(JSON.stringify({build:process.env.NODE_ENV,rows}));
 }finally{dom.window.close();}
}
