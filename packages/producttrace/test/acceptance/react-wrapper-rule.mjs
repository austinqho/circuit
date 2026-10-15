import assert from 'node:assert/strict';import path from 'node:path';import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';import {validateReactExecutionRule,planComponentWrapper} from '../../analysis/react-execution-rule.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
if(!process.argv.includes('--child')) {
  const builds=['development','production'].map(build=>JSON.parse(execFileSync(process.execPath,[fileURLToPath(import.meta.url),repository,'--child'],{encoding:'utf8',env:{...process.env,NODE_ENV:build},stdio:['ignore','pipe','inherit']})));
  console.log(JSON.stringify({apis:['react/forwardRef/18.3.1','react/memo/18.3.1'],format_pass:true,behavior_pass:true,builds},null,2));
} else {
  const require=createRequire(path.join(repository,'package.json')),React=require('react');assert.equal(React.version,'18.3.1');
  const rows=[];let calls=0;function Component(props,ref){calls++;return null;}function compare(a,b){calls++;return true;}
  for(const api of ['forwardRef','memo']) {
    const rule=getReactBehavior({surface:'react',exportName:api,version:React.version}).execution;
    const inputs=api==='memo'?[[Component],[Component,undefined],[Component,null],[Component,compare],[Component,false],['section',compare]]:[[Component],[Component,compare]];
    const cases=inputs.map(args=>({args,first:React[api](...args),second:React[api](...args)}));assert.equal(calls,0);
    const check=program=>{
      assert.equal(validateReactExecutionRule(program).valid,true);
      for(const row of cases){const plan=planComponentWrapper(program,{args:row.args});assert.equal(plan.status,'planned');
        assert.equal(plan.allocation,row.first===row.second?'shared':'per_call');assert.equal(plan.marker,row.first.$$typeof);
        assert.deepEqual(plan.callback_operations,[]);
        for(const [key,value] of Object.entries(plan.fields)){const descriptor=Object.getOwnPropertyDescriptor(row.first,key);assert.ok(descriptor);assert.equal(descriptor.value,value);}
        assert.equal(plan.fields[api==='forwardRef'?'render':'type'],row.args[0]);
      }
    };check(rule);let rejected=0;
    for(const mutation of [{allocation:'shared'},{marker:'react.wrong'},{component_argument:1},{component_field:api==='memo'?'render':'type'},{callbacks_at_creation:'invoke'},
      ...(api==='memo'?[{compare_argument:0},{missing_compare:'undefined'}]:[])]){assert.throws(()=>check({...rule,...mutation}));rejected++;}
    const named=React[api](Component);named.displayName='WrapperName';assert.equal(Component.displayName,undefined);
    const anonymous=(0,()=>null),anonymousWrapper=React[api](anonymous);anonymousWrapper.displayName='AnonymousWrapper';
    assert.equal(anonymous.displayName,process.env.NODE_ENV==='development'?'AnonymousWrapper':undefined);
    rows.push({api:'react/'+api+'/18.3.1',cases:cases.length,incorrect_programs_rejected:rejected,original_component_identity:true,callbacks_not_invoked:true,
      fresh_wrapper_per_call:true,missing_comparator:api==='memo'?'null':'not_applicable',development_display_name_observed:true});
  }
  // The oracle owns this renderer and its inputs. No Tracer rule or observation
  // supplies the expected argument, Fiber field, or tag.
  const {JSDOM}=require('jsdom'),dom=new JSDOM('<div id="app"></div>');
  globalThis.window=dom.window;globalThis.document=dom.window.document;
  let committedRoot=null;
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,inject(){return 1;},
    onCommitFiberRoot(_id,root){committedRoot=root;},onCommitFiberUnmount(){}};
  const DOM=require('react-dom'),Client=require('react-dom/client'),deliveries=[],rendered=[];
  const Forward=React.forwardRef(function RefInput(props,ref){rendered.push({args:Array.from(arguments),expected:props.input});return null;});
  const inputA=React.createRef(),inputB=React.createRef(),callback=()=>{};
  for(const strict of [false,true]) {
    const root=Client.createRoot(document.getElementById('app'));
    for(const input of [inputA,inputA,inputB,callback,null,undefined,inputA]) {
      const before=rendered.length,tree=React.createElement(Forward,{input,ref:input});
      DOM.flushSync(()=>root.render(strict?React.createElement(React.StrictMode,null,tree):tree));
      let fiber=committedRoot.current.child;
      while(fiber && fiber.elementType!==Forward)fiber=fiber.child;
      assert.ok(fiber);assert.equal(fiber.tag,11);
      const expected=input===undefined?null:input;
      for(const render of rendered.slice(before)) {
        assert.equal(render.args.length,2);assert.equal(render.args[1],expected);
        deliveries.push({args:render.args,expected,tag:fiber.tag,ref:fiber.ref,stateNode:fiber.stateNode});
      }
    }
    DOM.flushSync(()=>root.unmount());
  }
  const forwardRule=getReactBehavior({surface:'react',exportName:'forwardRef',version:React.version}).execution;
  const checkRef=program=>{
    assert.equal(validateReactExecutionRule(program).valid,true);assert.ok(program.render_ref);
    for(const sample of deliveries){const instruction=program.render_ref;
      assert.equal(sample.tag,instruction.fiber_tag);assert.equal(sample.args[instruction.argument],sample.expected);
      assert.equal(sample[instruction.field],sample.expected);}
  };
  checkRef(forwardRule);let incorrectRefPrograms=0;
  for(const render_ref of [null,{...forwardRule.render_ref,argument:0},{...forwardRule.render_ref,argument:2},
    {...forwardRule.render_ref,field:'stateNode'},{...forwardRule.render_ref,fiber_tag:14}]) {
    assert.throws(()=>checkRef({...forwardRule,render_ref}));incorrectRefPrograms++;
  }
  Object.assign(rows.find(row=>row.api==='react/forwardRef/18.3.1'),{renderer_ref_cases:deliveries.length,
    ref_input_policy_pass:true,incorrect_ref_programs_rejected:incorrectRefPrograms});
  dom.window.close();delete globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  console.log(JSON.stringify({build:process.env.NODE_ENV,rows}));
}
