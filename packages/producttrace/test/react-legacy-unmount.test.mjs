import test from 'node:test';import assert from 'node:assert/strict';
import {getReactBehavior} from '../analysis/react-behavior.mjs';import {validateReactExecutionRule,planReactLegacyUnmount} from '../analysis/react-execution-rule.mjs';
import {createReactHostObserver} from '../analysis/react-host-runtime.mjs';import {createReactHostEvidenceSession} from '../analysis/react-host-evidence.mjs';
const rule=getReactBehavior({surface:'react-dom',exportName:'unmountComponentAtNode',version:'18.3.1'}).execution;
test('legacy unmount needs root context and never treats a true result as cleanup proof',()=>{
 assert.equal(validateReactExecutionRule(rule).valid,true);assert.equal(validateReactExecutionRule({...rule,unknown:'ignored?'}).valid,false);
 assert.equal(validateReactExecutionRule({...rule,argument:-1}).valid,false);
 const input={get nodeType(){throw Error('must not inspect application input');}};
 assert.equal(planReactLegacyUnmount(rule,{args:[input],nodeType:1}).status,'unresolved');
 const plan=planReactLegacyUnmount(rule,{args:[input],nodeType:1,rootKind:'legacy'});assert.equal(plan.commit_required,true);assert.equal(plan.cleanup_completion_proven,false);
});
test('host completion instrumentation errors preserve original returns and explicit uncertainty',()=>{
 let count=0;const records=[],reason={original:true};const observer=createReactHostObserver({entry:()=>({host_rule:rule,host_argument_count:1}),enabled:()=>true,
  id:()=>`s:${++count}`,encode:()=>({encoding:'redacted',value:null}),inspect:()=>({evidence:{kind:'legacy_unmount'},complete(){throw Error('recorder failure');}}),observe:record=>records.push(record)});
 assert.equal(observer.hostCall('call',()=>{observer.hostArgument('call',0,{});return true;}),true);assert.equal(records[0].frontier,'host_completion_unobserved');
 assert.throws(()=>observer.hostCall('call',()=>{observer.hostArgument('call',0,{});throw reason;}),error=>error===reason);assert.equal(records[1].operation,'threw');
});
test('unmount consumer rejects malformed absence and token substitution without throwing',()=>{
 const value=(identity,kind,primitive)=>({identity:`s:${identity}`,kind,encoding:primitive===undefined?'redacted':'primitive',value:primitive===undefined?null:primitive});
 const input=value('container','object'),record={schema:'producttrace.react-host-observation.v1',kind:'react_host',runtime_observed:true,map_fingerprint:'map',session:'s',
  observation_id:'s:call',occurrence_id:'s:call:occurrence',evidence_ids:['s:call'],manifest_key:'entry',source_call_id:'source',semantic_id:'semantic',operation:'returned',
  input,inputs:{0:input},result:value('result','boolean',false),lookup:{kind:'legacy_unmount',container_identity:input.identity,nodeType:1,basis:'react-devtools-commit.v1',before:{state:'absent'},after:{state:'absent'}}};
 const session=()=>createReactHostEvidenceSession({fingerprint:'map',entries:[{key:'entry',source_call_id:'source',semantic_id:'semantic',package_verification_sha256:'exact',host_rule:rule,host_argument_count:1}]});
 assert.equal(session().join(record).runtime.claim,'observed_legacy_unmount_noop');
 for(const mutate of [r=>{r.lookup.before.root={};},r=>{r.lookup.after.root={};},r=>{r.result.identity=r.input.identity;},r=>{r.lookup.after=null;},r=>{r.lookup.nodeType=3;}]){
  const changed=structuredClone(record);mutate(changed);assert.equal(session().join(changed).status,'unresolved');
 }
});
