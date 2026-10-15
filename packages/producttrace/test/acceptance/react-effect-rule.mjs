import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';
import {validateReactExecutionRule,planEffectExecution} from '../../analysis/react-execution-rule.mjs';
const require=createRequire(path.join(path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous'),'package.json'));
const React=require('react'),{createRoot}=require('react-dom/client'),{JSDOM}=require('jsdom');
assert.equal(React.version,'18.3.1');
const dom=new JSDOM('<body></body>');globalThis.window=dom.window;globalThis.document=dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const apis=['useEffect','useLayoutEffect','useInsertionEffect'];
const rules=Object.fromEntries(apis.map(api=>[api,getReactBehavior({surface:'react',exportName:api,version:'18.3.1'}).execution]));
const snapshot={rootId:'r',instanceId:'i',mountId:'m',slotId:'h',renderId:'one',callbackId:'setup',committed:true};
const phaseOrder={insertion:0,layout:1,passive:2};
let rejectedMutants=0;
try {
  for(const strict of [false,true]) {
    const container=document.createElement('div');document.body.append(container);const root=createRoot(container),log=[];
    function Probe(){
      // The oracle fixes which real APIs execute; a proposed rule cannot replace them.
      React.useEffect(()=>{log.push(['useEffect','setup']);return()=>log.push(['useEffect','cleanup']);},[]);
      React.useLayoutEffect(()=>{log.push(['useLayoutEffect','setup']);return()=>log.push(['useLayoutEffect','cleanup']);},[]);
      React.useInsertionEffect(()=>{log.push(['useInsertionEffect','setup']);return()=>log.push(['useInsertionEffect','cleanup']);},[]);
      return null;
    }
    await React.act(async()=>root.render(strict?React.createElement(React.StrictMode,null,React.createElement(Probe)):React.createElement(Probe)));
    const actualOrder=log.slice(0,3).map(row=>row[0]);
    const expectedOrder=candidates=>apis.toSorted((a,b)=>phaseOrder[candidates[a].phase]-phaseOrder[candidates[b].phase]);
    assert.deepEqual(actualOrder,expectedOrder(rules));
    for(const api of apis) {
      assert.equal(validateReactExecutionRule(rules[api]).valid,true);
      const actual=log.filter(row=>row[0]===api).map(row=>row[1]);
      const predict=rule=>planEffectExecution(rule,{event:'commit',next:snapshot,strictDevelopment:strict}).operations
        .map(row=>row.kind==='cleanup_returned_by'?'cleanup':row.kind);
      assert.deepEqual(predict(rules[api]),actual);
      if(strict) {
        const mutant={...rules[api],strict_mount_rehearsal:!rules[api].strict_mount_rehearsal};
        assert.equal(validateReactExecutionRule(mutant).valid,true);
        assert.notDeepEqual(predict(mutant),actual);rejectedMutants++;
      }
    }
    const phaseMutants={...rules,useInsertionEffect:{...rules.useInsertionEffect,phase:'passive'}};
    assert.equal(validateReactExecutionRule(phaseMutants.useInsertionEffect).valid,true);
    assert.notDeepEqual(actualOrder,expectedOrder(phaseMutants));rejectedMutants++;
    await React.act(async()=>root.unmount());container.remove();
  }
  console.log(JSON.stringify({apis,format_pass:true,behavior_pass:true,strict_and_normal_mounts:true,
    independently_rejected_mutants:rejectedMutants},null,2));
} finally {dom.window.close();}
