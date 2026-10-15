import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostEventBoundary} from '../analysis/library-host-events.mjs';
import {effectProgram} from '../evaluation/shared-rules/react-effect-program.mjs';
import {imperativeCallbackProgram,imperativeCallbackLayout} from '../evaluation/shared-rules/react-imperative-program.mjs';

test('host events check callback order, values and cleanup without replaying application effects',()=>{
  const boundary=createHostEventBoundary({program:effectProgram}),owner={};let setup,cleanup,runs=0,cleans=0;
  const callback=()=>{runs++;return ()=>{cleans++}};
  boundary.register(owner,[callback,[1]],fn=>{setup=fn});
  boundary.begin(owner,'commit');cleanup=setup();boundary.flush(owner);
  boundary.register(owner,[callback,[1]],fn=>{setup=fn});
  boundary.begin(owner,'commit');boundary.flush(owner);
  boundary.register(owner,[callback,[2]],fn=>{setup=fn});
  cleanup();boundary.begin(owner,'commit');cleanup=setup();boundary.flush(owner);
  boundary.begin(owner,'disconnect');cleanup();boundary.flush(owner);
  assert.equal(runs,2);assert.equal(cleans,2);
  assert.equal(boundary.checkpoint().status,'observed_agreement',JSON.stringify(boundary.checkpoint()));
});

test('declared callback returns distinguish cleanup capabilities from function-valued data',()=>{
  for(const refCleanup of [false,true]){
    const boundary=createHostEventBoundary({program:imperativeCallbackProgram({refCleanup}),...imperativeCallbackLayout}),owner={};
    const handle=()=>{throw Error('handle is data')};let ref,create,firstRef,cleanup,created=0,cleaned=0;const seen=[];
    const callback=value=>{seen.push(value);return ()=>{cleaned++}};
    const capture=(reference,factory)=>{ref=reference;create=factory;firstRef??=reference};
    boundary.register(owner,[callback,()=>{created++;return handle},[]],capture);
    boundary.begin(owner,'commit');const actualHandle=create();assert.equal(actualHandle,handle);cleanup=ref(actualHandle);boundary.flush(owner);
    boundary.register(owner,[callback,()=>{created++;return {}},[]],capture);
    assert.equal(ref,firstRef,'Stable ref identity must not cause React to rerun unchanged dependencies');
    boundary.begin(owner,'commit');boundary.flush(owner);
    boundary.begin(owner,'disconnect');if(refCleanup)cleanup();else ref(null);boundary.flush(owner);
    assert.equal(created,1);assert.equal(cleaned,refCleanup?1:0);assert.equal(seen[0],handle);
    assert.equal(boundary.checkpoint().status,'observed_agreement',JSON.stringify(boundary.checkpoint()));
    if(!refCleanup)assert(boundary.checkpoint().evidence.some(row=>row.registration_candidates?.length===2&&row.registration===null));
  }
});

test('missing, extra, wrong-argument and unframed callbacks leave explicit frontiers',()=>{
  for(const kind of ['missing','extra','argument','unframed']){
    const boundary=createHostEventBoundary({program:effectProgram}),owner={};let setup;
    boundary.register(owner,[()=>{},[]],fn=>{setup=fn});
    if(kind!=='unframed')boundary.begin(owner,'commit');
    if(kind==='extra'){setup();setup()}
    if(kind==='argument')setup(1);
    if(kind==='unframed')setup();
    if(kind!=='unframed')boundary.flush(owner);
    assert.equal(boundary.checkpoint().status,'frontier',kind);
  }
});

test('owner isolation and unsupported inputs cannot silently borrow another callback or execute an accessor',()=>{
  const boundary=createHostEventBoundary({program:effectProgram}),a={},b={};let setupA,setupB;
  boundary.register(a,[()=>{},[]],fn=>{setupA=fn});boundary.register(b,[()=>{},[]],fn=>{setupB=fn});
  boundary.begin(a,'commit');setupB();boundary.flush(a);
  assert.equal(boundary.checkpoint().status,'frontier');
  let reads=0,actualCalls=0;
  const deps=[];Object.defineProperty(deps,0,{get(){reads++;return 1}});
  boundary.register({},[()=>{},deps],()=>{actualCalls++});
  assert.equal(reads,0);assert.equal(actualCalls,1);
  assert(boundary.checkpoint().failures.some(row=>row.reason==='host_event_registration_inputs_unsupported'));
  // A cleanup exception belongs to the real application. It propagates once;
  // the boundary does not swallow it to make its own replay succeed.
  const separate=createHostEventBoundary({program:effectProgram}),owner={},error=Error('cleanup failed');let setup,cleanup,calls=0;
  separate.register(owner,[()=>()=>{calls++;throw error},[]],fn=>{setup=fn});
  separate.begin(owner,'commit');cleanup=setup();separate.flush(owner);
  separate.begin(owner,'disconnect');assert.throws(cleanup,value=>value===error);separate.flush(owner);
  assert.equal(calls,1);assert.equal(separate.checkpoint().status,'frontier');
});

test('ref write observation preserves the original cell and rejects unsupported descriptors',()=>{
  const program=imperativeCallbackProgram(),boundary=createHostEventBoundary({program,...imperativeCallbackLayout}),owner={};
  const original=Object.seal({current:null}),handle={},factory=()=>handle;let ref,create,initial;
  const capture=(reference,make)=>{ref=reference;create=make;initial??=reference;};
  boundary.register(owner,[original,factory,[]],capture);
  boundary.begin(owner,'commit');ref.current=create();boundary.flush(owner);
  assert.equal(original.current,handle);assert.equal(Object.isSealed(original),true);
  boundary.register(owner,[original,factory,[]],capture);assert.equal(ref,initial);
  boundary.begin(owner,'commit');boundary.flush(owner);
  boundary.begin(owner,'disconnect');ref.current=null;boundary.flush(owner);
  assert.equal(original.current,null);assert.equal(boundary.checkpoint().status,'observed_agreement');
  let accesses=0,registrations=0;
  for(const reference of [{get current(){accesses++;return null}},Object.freeze({current:null}),new Proxy({current:null},{get(){accesses++;return null}})]){
    const rejected=createHostEventBoundary({program,...imperativeCallbackLayout});
    rejected.register({},[reference,factory,[]],()=>{registrations++});
    assert.equal(rejected.checkpoint().status,'frontier');
  }
  assert.equal(accesses,0);assert.equal(registrations,3);
});
