import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';
import {validateReactExecutionRule,predictMemoValue} from '../../analysis/react-execution-rule.mjs';
const require=createRequire(path.join(path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous'),'package.json'));
const React=require('react'),{createRoot}=require('react-dom/client'),{JSDOM}=require('jsdom');
assert.equal(React.version,'18.3.1');
const dom=new JSDOM('<body></body>');globalThis.window=dom.window;globalThis.document=dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const rule=getReactBehavior({surface:'react',exportName:'useMemo',version:'18.3.1'}).execution;
assert.equal(validateReactExecutionRule(rule).valid,true);
const object={};const cases=[['same',[1],[1]],['changed',[1],[2]],['empty',[],[]],['omitted',undefined,undefined],
  ['NaN',[NaN],[NaN]],['signed zero',[-0],[0]],['object same',[object],[object]],['object different',[{}],[{}]]];
let rejected=0;
try {
  for(const [name,before,after] of cases) {
    const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
    let actual,calls=0;const first=()=>{calls++;return {from:'old'};},next=()=>{calls++;return {from:'new'};};
    function Probe({calculate,deps}){actual=React.useMemo(calculate,deps);return null;}
    await React.act(async()=>root.render(React.createElement(Probe,{calculate:first,deps:before})));
    const previous={callback:first,value:actual,dependencies:before};const beforeCalls=calls;
    const predicted=predictMemoValue(rule,{args:[next,after],previous});
    await React.act(async()=>root.render(React.createElement(Probe,{calculate:next,deps:after})));
    assert.equal(predicted.status,'predicted');
    assert.equal(calls-beforeCalls,predicted.operation==='calculate'?1:0,name);
    if(predicted.operation==='retain')assert.equal(actual,predicted.value,name);
    else assert.equal(actual.from,'new');
    const mutant={...rule,dependencies_argument:2};assert.equal(validateReactExecutionRule(mutant).valid,true);
    if(predictMemoValue(mutant,{args:[next,after],previous}).operation!==predicted.operation)rejected++;
    await React.act(async()=>root.unmount());container.remove();
  }
  assert.ok(rejected>=4);
  console.log(JSON.stringify({api:'react/useMemo/18.3.1',format_pass:true,behavior_pass:true,
    independent_cases:cases.map(row=>row[0]),incorrect_rule_counterexamples:rejected},null,2));
} finally {dom.window.close();}
