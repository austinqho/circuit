import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';
import {validateReactExecutionRule,predictRetainedCallback} from '../../analysis/react-execution-rule.mjs';

const require=createRequire(path.join(path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous'),'package.json'));
const React=require('react'), {createRoot}=require('react-dom/client'), {JSDOM}=require('jsdom');
assert.equal(React.version,'18.3.1');
const dom=new JSDOM('<body></body>');
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const rule=getReactBehavior({surface:'react',exportName:'useCallback',version:React.version}).execution;
assert.equal(validateReactExecutionRule(rule).valid,true);
const sameObject={};
// Frozen oracle inputs live in the test, outside the proposed rule. Neither a
// rule nor its author gets to pick which calls count as successful behavior.
const cases=[['unchanged',[1],[1]],['changed',[1],[2]],['empty',[],[]],
  ['omitted',undefined,undefined],['NaN',[NaN],[NaN]],['signed zero',[-0],[0]],
  ['same object',[sameObject],[sameObject]],['different objects',[{}],[{}]]];
const observations=[];
try {
  for(const [name,before,after] of cases) {
    const container=document.createElement('div');document.body.append(container);
    const root=createRoot(container);let returned;
    function Probe({callback,dependencies}) {returned=React.useCallback(callback,dependencies);return null;}
    const first=()=>`old:${name}`,next=()=>`new:${name}`;
    await React.act(async()=>root.render(React.createElement(Probe,{callback:first,dependencies:before})));
    assert.equal(returned,first,'React returns the exact function supplied at mount');
    const initial=returned;
    await React.act(async()=>root.render(React.createElement(Probe,{callback:next,dependencies:after})));
    const expected=predictRetainedCallback(rule,{args:[next,after],previous:{callback:initial,dependencies:before}});
    assert.equal(expected.status,'predicted');assert.equal(returned,expected.callback,name);
    observations.push({name,first,next,before,after,actual:returned});
    await React.act(async()=>root.unmount());container.remove();
  }
  const mutant={...rule,dependencies_argument:2};
  assert.equal(validateReactExecutionRule(mutant).valid,true,'syntactic validity cannot imply behavioral validity');
  const failures=observations.filter(row=>predictRetainedCallback(mutant,{
    args:[row.next,row.after],previous:{callback:row.first,dependencies:row.before}}).callback!==row.actual);
  assert.ok(failures.length>=4,'independent calls reject a plausible rule with the wrong dependency input');
  console.log(JSON.stringify({api:'react/useCallback/18.3.1',format_pass:true,behavior_cases:cases.map(row=>row[0]),
    behavior_pass:true,well_formed_incorrect_rule_rejected:true,incorrect_rule_counterexamples:failures.map(row=>row.name)},null,2));
} finally {dom.window.close();}
