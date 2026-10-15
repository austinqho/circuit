import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';
import {validateReactExecutionRule,planSynchronousScope} from '../../analysis/react-execution-rule.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
if(!process.argv.includes('--child')) {
  const builds=['development','production'].map(build=>JSON.parse(execFileSync(process.execPath,[fileURLToPath(import.meta.url),repository,'--child'],{
    encoding:'utf8',env:{...process.env,NODE_ENV:build}})));
  console.log(JSON.stringify({format_pass:true,behavior_pass:true,builds},null,2));
} else {
  const require=createRequire(path.join(repository,'package.json'));
  const React=require('react'),DOM=require('react-dom'),{createRoot}=require('react-dom/client'),{JSDOM}=require('jsdom');
  assert.equal(React.version,'18.3.1');assert.equal(require('react-dom/package.json').version,'18.3.1');
  const dom=new JSDOM('<body></body>');globalThis.window=dom.window;globalThis.document=dom.window.document;
  const context=React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentBatchConfig;
  const rows=[];
  try {
    for(const [surface,name,fn] of [['react','startTransition',React.startTransition],['react-dom','flushSync',DOM.flushSync],['react-dom','unstable_batchedUpdates',DOM.unstable_batchedUpdates]]) {
      const rule=getReactBehavior({surface,exportName:name,version:'18.3.1'}).execution;
      assert.equal(validateReactExecutionRule(rule).valid,true);
      const value={marker:'same identity'},calls=[],order=[];
      const callback=function(...args){calls.push(args);order.push('callback');return value;};
      const args=[callback,value],plan=planSynchronousScope(rule,{args});
      order.push('before');const result=fn(...args);order.push('after');
      assert.deepEqual(order,['before','callback','after']);assert.equal(calls.length,1);
      assert.equal(plan.callback,callback);assert.deepEqual(plan.arguments,calls[0]);
      assert.equal(result,plan.result==='undefined'?undefined:value);
      let rejected=0;
      for(const mutant of [{...rule,callback_argument:1},{...rule,callback_arguments:[2,3]},
        {...rule,result:rule.result==='undefined'?'callback_result':'undefined'}]) {
        assert.equal(validateReactExecutionRule(mutant).valid,true);
        const wrong=planSynchronousScope(mutant,{args});
        const agrees=wrong.callback===callback && wrong.arguments.length===calls[0].length
          && wrong.arguments.every((arg,index)=>Object.is(arg,calls[0][index])) && Object.is(result,wrong.result==='undefined'?undefined:value);
        assert.equal(agrees,false);rejected++;
      }
      let observedContext;
      React.startTransition(()=>{
        const outer=context.transition;
        fn(()=>{const inner=context.transition;observedContext=inner===null?'clear':inner===outer?'preserve':'new';},value);
        assert.equal(context.transition,outer);
        const error={error:name};assert.throws(()=>fn(()=>{throw error;}),actual=>actual===error);
        assert.equal(context.transition,outer,'exception restores the previous transition context');
      });
      assert.equal(observedContext,rule.transition_context);assert.equal(context.transition,null);
      let thenReads=0;const thenable={get then(){thenReads++;throw Error('must not inspect callback result');}};
      assert.equal(fn(()=>thenable),rule.result==='undefined'?undefined:thenable);assert.equal(thenReads,0);
      let asyncContext='unset';fn(()=>Promise.resolve().then(()=>{asyncContext=context.transition;}));
      await Promise.resolve();assert.equal(asyncContext,null);
      for(const missing of [undefined,null,false,0,'']) {
        if(rule.missing_callback==='skip_falsy')assert.equal(fn(missing),undefined);
        else assert.throws(()=>fn(missing),TypeError);
      }
      assert.throws(()=>fn({}),TypeError);
      const host=document.createElement('div');document.body.append(host);let update,renderCount=0;
      function Probe(){const [count,setCount]=React.useState(0);update=setCount;renderCount++;return React.createElement('output',null,count);}
      const legacy=name==='unstable_batchedUpdates';const root=legacy?null:createRoot(host);
      DOM.flushSync(()=>legacy?DOM.render(React.createElement(Probe),host):root.render(React.createElement(Probe)));
      const during=[];fn(()=>{update(1);update(2);during.push(host.textContent);});
      assert.deepEqual(during,['0']);
      assert.equal(host.textContent,rule.scheduling==='transition'?'0':'2');
      if(rule.scheduling==='transition') {
        for(let i=0;i<100 && host.textContent!=='2';i++)await new Promise(resolve=>setTimeout(resolve,5));
        assert.equal(host.textContent,'2');
      }
      assert.equal(renderCount,2);
      DOM.flushSync(()=>legacy?DOM.unmountComponentAtNode(host):root.unmount());host.remove();
      rows.push({api:`${surface}/${name}/18.3.1`,incorrect_rules_rejected:rejected,context:observedContext,
        synchronous_callback:true,arguments_results_exceptions:true,scheduling_observed:true,async_continuation_outside:true});
    }
    console.log(JSON.stringify({build:process.env.NODE_ENV,rows}));
  } finally {dom.window.close();}
}
