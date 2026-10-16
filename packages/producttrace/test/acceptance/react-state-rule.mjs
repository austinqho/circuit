import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';
import {validateReactExecutionRule,planStateInitialization,planStateUpdate} from '../../analysis/react-execution-rule.mjs';
const require=createRequire(path.join(path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous'),'package.json'));
const React=require('react'),{createRoot}=require('react-dom/client'),{JSDOM}=require('jsdom');
assert.equal(React.version,'18.3.1');
const dom=new JSDOM('<body></body>');
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const resolve=plan=>{assert.equal(plan.status,'planned');return plan.operation==='invoke'?plan.callback(...plan.arguments):plan.value;};
const results=[];
try {
  for(const api of ['useState','useReducer']) {
    const rule=getReactBehavior({surface:'react',exportName:api,version:'18.3.1'}).execution;
    assert.equal(validateReactExecutionRule(rule).valid,true);
    const reducer=(state,action)=>typeof action==='function'?91:action.replace!==undefined?action.replace:state+action.add;
    const stored=()=>23;
    const cases=api==='useState'?[[3],[()=>7],[()=>stored]]:[[reducer,3],[reducer,4,value=>value*2],[reducer,stored]];
    let wrongRulesRejected=0;
    for(const args of cases) {
      const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
      let pair;function Probe({args}){pair=React[api](...args);return null;}
      await React.act(async()=>root.render(React.createElement(Probe,{args})));
      const initial=pair[0],dispatch=pair[1];
      assert.equal(initial,resolve(planStateInitialization(rule,{args})));
      const mutant={...rule,initial_argument:7,initializer_argument:8};
      assert.equal(validateReactExecutionRule(mutant).valid,true);
      if(!Object.is(resolve(planStateInitialization(mutant,{args})),initial))wrongRulesRejected++;
      // Changing initial input does not initialize an existing hook again.
      const changed=api==='useState'?[()=>{throw Error('must not initialize on update');}]:[reducer,99,()=>{throw Error('must not initialize on update');}];
      await React.act(async()=>root.render(React.createElement(Probe,{args:changed})));
      assert.equal(pair[0],initial);assert.equal(pair[1],dispatch);
      const actions=api==='useState'?[12,value=>value+2,value=>value*3]:[{replace:12},{add:2},{add:28}];
      let expected=initial;
      for(const action of actions)expected=resolve(planStateUpdate(rule,{state:expected,action,reducer}));
      await React.act(async()=>{for(const action of actions)dispatch(action);});
      assert.equal(pair[0],expected);assert.equal(pair[1],dispatch);
      if(api==='useState') {
        for(const value of [NaN,NaN,-0,0]) {
          await React.act(async()=>dispatch(value));assert.ok(Object.is(pair[0],value));
        }
        await React.act(async()=>dispatch(()=>stored));assert.equal(pair[0],stored);
      } else {
        const action=()=>{throw Error('function actions must reach the reducer, not be called as updaters');};
        await React.act(async()=>dispatch(action));assert.equal(pair[0],91);
        const plan=planStateUpdate(rule,{state:0,action,reducer});
        assert.equal(plan.callback,reducer);assert.equal(plan.arguments[1],action);
      }
      await React.act(async()=>root.unmount());host.remove();
    }
    // Observe actual initializer calls independently of the rule interpreter.
    // The interpreter may choose a callback and arguments; it never runs it.
    const calls=[],initialArgument={value:11};
    const initializer=function(...args){calls.push(args);return initialArgument;};
    const args=api==='useState'?[initializer]:[reducer,initialArgument,initializer];
    const plan=planStateInitialization(rule,{args});
    const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
    let pair;function InitializerProbe(){pair=React[api](...args);return null;}
    await React.act(async()=>root.render(React.createElement(InitializerProbe)));
    assert.equal(calls.length,1);assert.equal(plan.operation,'invoke');assert.equal(plan.callback,initializer);
    assert.deepEqual(calls[0],plan.arguments);assert.equal(pair[0],initialArgument);
    await React.act(async()=>root.render(React.createElement(InitializerProbe)));
    assert.equal(calls.length,1,'an unchanged mounted hook must not initialize again');
    await React.act(async()=>root.unmount());host.remove();
    assert.ok(wrongRulesRejected>=2);
    results.push({api:`react/${api}/18.3.1`,cases:cases.length,initializer_call_arguments_verified:true,wrong_rules_rejected:wrongRulesRejected});
  }
  console.log(JSON.stringify({format_pass:true,behavior_pass:true,results},null,2));
} finally {dom.window.close();}
