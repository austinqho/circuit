import assert from 'node:assert/strict';import path from 'node:path';import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';
import {validateReactExecutionRule,planContextBinding,contextValueChanged} from '../../analysis/react-execution-rule.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
if(!process.argv.includes('--child')) {
  const builds=['development','production'].map(build=>JSON.parse(execFileSync(process.execPath,
    [fileURLToPath(import.meta.url),repository,'--child'],{encoding:'utf8',env:{...process.env,NODE_ENV:build},stdio:['ignore','pipe','inherit']})));
  console.log(JSON.stringify({apis:['react/createContext/18.3.1','react/useContext/18.3.1'],format_pass:true,behavior_pass:true,builds},null,2));
} else {
  const require=createRequire(path.join(repository,'package.json')),{JSDOM}=require('jsdom');
  const dom=new JSDOM('<div id="app"></div>');globalThis.window=dom.window;globalThis.document=dom.window.document;
  const React=require('react'),DOM=require('react-dom'),Client=require('react-dom/client');assert.equal(React.version,'18.3.1');
  const createRule=getReactBehavior({surface:'react',exportName:'createContext',version:'18.3.1'}).execution;
  const readRule=getReactBehavior({surface:'react',exportName:'useContext',version:'18.3.1'}).execution;
  assert.equal(validateReactExecutionRule(createRule).valid,true);assert.equal(validateReactExecutionRule(readRule).valid,true);
  const root=Client.createRoot(document.getElementById('app')),traces=[],changes=[];let readValue,consumerValue,renders=0,invocations=0;
  const fn=()=>{invocations++;};
  function Reader({context}){readValue=React.useContext(context);return null;}
  for(const defaultValue of [undefined,null,7,NaN,-0,{x:true},fn]) {
    const context=React.createContext(defaultValue),other=React.createContext('other');
    assert.notEqual(context,React.createContext(defaultValue));
    for(const providers of [[],[{context,value:undefined}],[{context,value:null}],[{context,value:fn}],
      [{context,value:'inner'},{context:other,value:'unrelated'},{context,value:'outer'}],
      [{context:other,value:'other only'}]]) {
      let tree=React.createElement(React.Fragment,null,React.createElement(Reader,{context}),React.createElement(context.Consumer,null,value=>{consumerValue=value;return null;}));
      for(const provider of providers)tree=React.createElement(provider.context.Provider,{value:provider.value},tree);
      DOM.flushSync(()=>root.render(tree));traces.push({defaultValue,context,providers,actual:readValue,actualConsumer:consumerValue});
    }
  }
  // Context changes reach a memoized subscriber even when its props/element
  // stay fixed. This isolates context notification from ordinary parent renders.
  const context=React.createContext('initial');
  const Memo=React.memo(function Memo(){renders++;readValue=React.useContext(context);return null;});
  const child=React.createElement(Memo);let previous;
  for(const next of [NaN,NaN,0,-0,-0,{stable:1}]) {
    const before=renders;DOM.flushSync(()=>root.render(React.createElement(context.Provider,{value:next},child)));
    if(before)changes.push({previous,next,updated:renders!==before});previous=next;
  }
  const stable=previous;let before=renders;DOM.flushSync(()=>root.render(React.createElement(context.Provider,{value:stable},child)));
  changes.push({previous:stable,next:stable,updated:renders!==before});
  const check=(creation,reading)=>{
    assert.equal(validateReactExecutionRule(creation).valid,true);assert.equal(validateReactExecutionRule(reading).valid,true);
    for(const row of traces) {
      const initial=planContextBinding(creation,{args:[row.defaultValue]});
      const result=planContextBinding(reading,{requestedContext:row.context,providers:row.providers,
        defaultValue:initial.default_value,defaultKnown:true,chainComplete:true});
      assert.equal(result.status,'planned');assert.equal(result.value_known,true);assert.ok(Object.is(result.value,row.actual));
      const consumer=planContextBinding(creation,{member:'Consumer',requestedContext:row.context,providers:row.providers,defaultValue:initial.default_value,defaultKnown:true,chainComplete:true});
      assert.ok(Object.is(consumer.value,row.actualConsumer));
    }
    for(const row of changes){assert.equal(contextValueChanged(reading,row.previous,row.next),row.updated);assert.equal(contextValueChanged(creation,row.previous,row.next),row.updated);}
  };
  check(createRule,readRule);let rejected=0;
  for(const [creation,reading] of [[{...createRule,default_argument:1},readRule],[createRule,{...readRule,selection:'farthest'}],
    [createRule,{...readRule,undefined_provider:'default'}],[createRule,{...readRule,change_comparison:'strict_equal'}],
    [{...createRule,selection:'farthest'},readRule],[{...createRule,undefined_provider:'default'},readRule],[{...createRule,change_comparison:'strict_equal'},readRule]]) {
    assert.throws(()=>check(creation,reading));rejected++;
  }
  assert.equal(invocations,0);DOM.flushSync(()=>root.unmount());
  console.log(JSON.stringify({build:process.env.NODE_ENV,cases:traces.length,notification_cases:changes.length,
    incorrect_programs_rejected:rejected,stored_functions_not_called:true,explicit_undefined:true,nested_identity_selection:true,
    memo_subscriber_notification:true,installed_version:React.version}));dom.window.close();
}
