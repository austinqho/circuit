import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {analyzeReact} from '../../analysis/index.mjs';
import {createReactLifecycleEvidenceSession} from '../../analysis/react-lifecycle-evidence.mjs';

// The source map is admitted from the same exact installed package bytes that
// execute this probe. The React callbacks below, rather than the behavior bank,
// are the execution oracle.
const fixture = path.resolve(process.argv[2] || '/tmp/producttrace-librechat-autonomous');
const fixtureRequire = createRequire(path.join(fixture, 'package.json'));
const React = fixtureRequire('react');
const {JSDOM} = fixtureRequire('jsdom');
assert.equal(React.version, '18.3.1');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-react-lifecycle-'));
try {
  fs.mkdirSync(path.join(temporary, 'src'), {recursive:true});
  fs.mkdirSync(path.join(temporary, 'node_modules'), {recursive:true});
  fs.symlinkSync(path.join(fixture, 'node_modules/react'), path.join(temporary, 'node_modules/react'), 'dir');
  const lock = JSON.parse(fs.readFileSync(path.join(fixture, 'package-lock.json'), 'utf8'));
  fs.writeFileSync(path.join(temporary, 'package.json'), JSON.stringify({name:'react-lifecycle-probe', private:true}));
  fs.writeFileSync(path.join(temporary, 'package-lock.json'), JSON.stringify({name:'react-lifecycle-probe',
    lockfileVersion:3, packages:{'':{name:'react-lifecycle-probe'},
      'node_modules/react':lock.packages['node_modules/react']}}));
  fs.writeFileSync(path.join(temporary, 'src/App.tsx'), `
    import {useEffect} from 'react';
    export function Probe({name,value}) {
      useEffect(() => { observed(name,value); return () => cleaned(name,value); }, [value]);
      return <button>{name}</button>;
    }
  `);
  const map = analyzeReact({repository:temporary});
  const semantic = map.react_semantics.find(row => row.export === 'useEffect');
  assert.ok(semantic);
  assert.equal(map.resolution.packages.find(row => row.name === 'react').react_semantics_verification.verified, true);
  const [setupSlot, cleanupSlot] = semantic.causal_bindings.callbacks;
  const session = createReactLifecycleEvidenceSession(map);
  const dom = new JSDOM('<body><main></main></body>', {url:'http://localhost'});
  globalThis.window=dom.window;globalThis.document=dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const mountIds=new Map(), current=new Map(), setupInvocations=new Map();
  let sequence=0;
  const observe=(name,operation,extra={},identity=current.get(name))=>{
    const result=session.join({schema:'producttrace.react-lifecycle-observation.v1',kind:'react_lifecycle',
      observation_id:`observation-${++sequence}`,occurrence_id:`occurrence-${sequence}`,
      map_fingerprint:map.fingerprint,source_call_id:semantic.call_id,semantic_id:semantic.semantic_id,
      owner_source_id:semantic.causal_bindings.owner_source_id,root_id:'root-1',instance_id:name,
      mount_id:mountIds.get(name),render_id:identity.render_id,hook_slot_id:'hook-0',
      operation,evidence_ids:[`evidence-${sequence}`],...extra});
    assert.equal(result.status,'resolved',JSON.stringify(result));
    return result;
  };
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,inject(){return 1},
    onCommitFiberRoot(_renderer,root){
      if(!root.current.child)return;
      for(const [name,identity] of current){
        if(session.snapshot().observations.some(row=>row.runtime?.operation==='render_committed'
            && row.runtime.instance_id===name && row.runtime.render_id===identity.render_id))continue;
        observe(name,'render_committed',{},identity);
      }
    },onCommitFiberUnmount(){}};
  const Client=fixtureRequire('react-dom/client');
  const container=document.querySelector('main'), root=Client.createRoot(container);
  let renderSequence=0;
  function Probe({name,value}) {
    if(!mountIds.has(name))mountIds.set(name,`mount-${name}`);
    const render_id=`render-${name}-${++renderSequence}`;
    current.set(name,{render_id,value});
    observe(name,'render_attempted');
    React.useEffect(()=>{
      const effectIdentity={...current.get(name)};
      const invocation_id=`setup-${name}-${value}`;
      observe(name,'callback_invoked',{callback_slot:setupSlot.slot,
        callback_source_id:setupSlot.source_id,invocation_id},effectIdentity);
      setupInvocations.set(name,invocation_id);
      return()=>observe(name,'cleanup_invoked',{callback_slot:cleanupSlot.slot,
        callback_source_id:cleanupSlot.source_id,invocation_id:`cleanup-${name}-${value}`,
        caused_by_invocation_id:invocation_id},effectIdentity);
    },[value]);
    return React.createElement('button',null,name);
  }
  const tree=value=>React.createElement(React.Fragment,null,
    React.createElement(Probe,{key:'a',name:'a',value}),
    React.createElement(Probe,{key:'b',name:'b',value:0}));
  await React.act(async()=>root.render(tree(0)));
  const firstA={...current.get('a')}, firstB={...current.get('b')};
  await React.act(async()=>root.render(tree(1)));
  assert.notEqual(current.get('a').render_id,firstA.render_id);
  assert.notEqual(current.get('b').render_id,firstB.render_id);
  assert.equal(setupInvocations.get('b'),'setup-b-0','equal dependencies retain the first setup ownership');
  await React.act(async()=>root.unmount());
  for(const name of ['a','b'])observe(name,'unmounted');
  const snapshot=session.snapshot();
  assert.equal(snapshot.counts.mounts,2);
  assert.equal(snapshot.observations.filter(row=>row.runtime.operation==='callback_invoked').length,3);
  assert.equal(snapshot.observations.filter(row=>row.runtime.operation==='cleanup_invoked').length,3);
  assert.ok(snapshot.observations.every(row=>row.claim==='runtime_observed'
    && row.source.claim==='source_contract' && row.source.runtime_observed===false));
  dom.window.close();
  console.log(JSON.stringify({react:React.version,verified_source:true,mounted_instances:snapshot.counts.mounts,
    render_attempts:snapshot.counts.renders,observed_setups:3,observed_cleanups:3,
    contamination_negative_cases:'covered by test/react-lifecycle-evidence.test.mjs'},null,2));
} finally {
  fs.rmSync(temporary,{recursive:true,force:true});
}
