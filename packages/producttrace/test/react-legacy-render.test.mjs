import test from 'node:test';import assert from 'node:assert/strict';
import {getReactBehavior} from '../analysis/react-behavior.mjs';import {validateReactExecutionRule,planReactLegacyRender} from '../analysis/react-execution-rule.mjs';
import {createReactHostObserver} from '../analysis/react-host-runtime.mjs';import {createReactHostEvidenceSession} from '../analysis/react-host-evidence.mjs';
const rule=getReactBehavior({surface:'react-dom',exportName:'render',version:'18.3.1'}).execution;
test('legacy rendering retains unknown schedule and demands a parent for subtree context',()=>{
 assert.equal(validateReactExecutionRule(rule).valid,true);assert.equal(validateReactExecutionRule({...rule,extra:1}).valid,false);
 const args=[{}, {}, ()=>{}],plan=planReactLegacyRender(rule,{args,rootState:'unobserved',publicInstance:null});
 assert.equal(plan.element,args[0]);assert.equal(plan.container,args[1]);assert.equal(plan.callback,args[2]);assert.equal(plan.scheduling,'unobserved');assert.equal(plan.callback_completion_proven,false);
 const subtree=getReactBehavior({surface:'react-dom',exportName:'unstable_renderSubtreeIntoContainer',version:'18.3.1'}).execution;
 assert.equal(planReactLegacyRender(subtree,{args}).reason,'legacy_render_parent_required');
});
test('render observation finishes argument evaluation before snapshotting and preserves callback identity',()=>{
 let count=0;const log=[],args=[{}, {}, ()=>{}],output={};
 const observer=createReactHostObserver({entry:()=>({host_rule:rule,host_argument_count:3}),enabled:()=>true,id:()=>`s:${++count}`,encode:()=>({encoding:'redacted',value:null}),
  inspect:(container,_snapshot,receivedRule,receivedArgs)=>{log.push('inspect');assert.equal(container,args[1]);assert.equal(receivedRule,rule);assert.deepEqual(receivedArgs,args);return {evidence:{kind:'legacy_render'},complete:()=>{log.push('complete');return {};}};},observe:()=>log.push('observe')});
 assert.equal(observer.hostCall('call',()=>{for(let i=0;i<3;i++){log.push('argument:'+i);assert.equal(observer.hostArgument('call',i,args[i]),args[i]);}log.push('library');return output;}),output);
 assert.deepEqual(log,['argument:0','argument:1','argument:2','inspect','library','complete','observe']);
});
test('legacy render joins require current element and public result rather than a boolean success',()=>{
 const token=(id,kind='object')=>({identity:'s:'+id,kind,encoding:kind==='null'?'primitive':'redacted',value:null});
 const element=token('element'),container=token('container'),result=token('public'),root=token('root');
 const record={schema:'producttrace.react-host-observation.v1',kind:'react_host',runtime_observed:true,map_fingerprint:'map',session:'s',
  observation_id:'s:call',occurrence_id:'s:call:occurrence',evidence_ids:['s:call'],manifest_key:'entry',source_call_id:'source',semantic_id:'semantic',operation:'returned',
  input:container,inputs:{0:element,1:container},result,lookup:{kind:'legacy_render',container_identity:container.identity,nodeType:1,basis:'react-devtools-commit.v1',element,parent:null,commit_floor:1,
   after:{state:'committed',root,renderer_root_id:'react-root:1',commit_id:'react-commit:2',element,first_child_tag:1,public_instance:result}}};
 const session=()=>createReactHostEvidenceSession({fingerprint:'map',entries:[{key:'entry',source_call_id:'source',semantic_id:'semantic',package_verification_sha256:'exact',host_rule:rule,host_argument_count:2}]});
 assert.equal(session().join(record).status,'resolved');
 for(const mutate of [r=>{r.lookup.after.public_instance.identity='s:wrong';},r=>{r.lookup.after.element.identity='s:wrong';},r=>{r.lookup.after.commit_id='react-commit:1';},r=>{r.lookup.after.first_child_tag=null;},r=>{r.lookup.parent={};},r=>{r.lookup.after.root.identity=r.input.identity;}]){
  const bad=JSON.parse(JSON.stringify(record));mutate(bad);assert.equal(session().join(bad).status,'unresolved');
 }
});
