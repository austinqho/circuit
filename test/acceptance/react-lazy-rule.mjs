import assert from 'node:assert/strict';import path from 'node:path';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';import {validateReactExecutionRule,planReactLazyStep} from '../../analysis/react-execution-rule.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
if(!process.argv.includes('--child')){
 const builds=['development','production'].map(build=>JSON.parse(execFileSync(process.execPath,[fileURLToPath(import.meta.url),repository,'--child'],{encoding:'utf8',env:{...process.env,NODE_ENV:build}})));
 console.log(JSON.stringify({api:'react/lazy/18.3.1',format_pass:true,behavior_pass:true,builds},null,2));
}else{
 const require=createRequire(path.join(repository,'package.json')),React=require('react');assert.equal(React.version,'18.3.1');
 const rule=getReactBehavior({surface:'react',exportName:'lazy',version:React.version}).execution;
 // The exact installed initializer is invoked directly here to isolate its
 // state machine. A separate browser test must exercise React's real renderer.
 const run=candidate=>{
  assert.equal(validateReactExecutionRule(candidate).valid,true);
  let state,loads=0,fulfill,reject;const thenable={then(a,b){fulfill=a;reject=b;}};
  const loader=()=>{loads++;return thenable;},args=[loader],lazy=React.lazy(...args);
  state={status:'uninitialized',value:args[candidate.loader_argument]};
  assert.equal(loads,candidate.creation==='store'?0:1);
  const compare=()=>assert.equal(lazy._payload._status,{uninitialized:-1,pending:0,resolved:1,rejected:2}[state.status]);
  const step=(event,value)=>{const p=planReactLazyStep(candidate,{state,event,value});assert.equal(p.status,'planned');state=p.state;return p;};
  assert.equal(step('initialize').callback,loader);
  assert.throws(()=>lazy._init(lazy._payload),e=>e===thenable);assert.equal(loads,1);
  step('loader_return',thenable);step('registration_return',thenable);compare();
  assert.equal(step('initialize').operation,'throw');assert.throws(()=>lazy._init(lazy._payload),e=>e===thenable);assert.equal(loads,1);
  function First(){}function Second(){}const first={default:First},second={default:Second};
  fulfill(first);step('fulfill',first);compare();fulfill(second);step('fulfill',second);reject('late');step('reject','late');compare();
  const read=step('initialize');assert.equal(read.operation,'read_module_property');assert.equal(lazy._init(lazy._payload),read.module[read.property]);assert.equal(loads,1);
  let failures=0;const error={original:true},bad=()=>{failures++;throw error;},retry=React.lazy(bad);state={status:'uninitialized',value:bad};
  for(let i=0;i<2;i++){assert.equal(step('initialize').operation,'invoke_loader');assert.throws(()=>retry._init(retry._payload),e=>e===error);step('loader_throw',error);assert.equal(retry._payload._status,-1);}
  assert.equal(failures,2);
 };
 run(rule);
 const mutants=[{...rule,loader_argument:1},{...rule,creation:'invoke'},{...rule,settlement:'last'},
  {...rule,module_property:'named'},{...rule,pending:'return'},{...rule,retry_loader_error:false}];
 for(const mutant of mutants)assert.throws(()=>run(mutant),assert.AssertionError);
 // Synchronous settlement during registration wins over the subsequent pending
 // assignment. A registration error can occur after that settlement and must
 // not reset an already resolved payload.
 let state={status:'uninitialized',value:null};const error={registration:true},Component=()=>null,module={default:Component};
 const settled=React.lazy(()=>({then(resolve){resolve(module);throw error;}}));
 assert.throws(()=>settled._init(settled._payload),e=>e===error);
 state=planReactLazyStep(rule,{state,event:'fulfill',value:module}).state;
 state=planReactLazyStep(rule,{state,event:'registration_throw',value:error}).state;
 assert.equal(state.status,'resolved');assert.equal(settled._init(settled._payload),Component);
 let rejects=0;const rejected=React.lazy(()=>{rejects++;return {then(resolve,reject){reject(error);resolve(module);}};});
 for(let i=0;i<2;i++)assert.throws(()=>rejected._init(rejected._payload),e=>e===error);
 assert.equal(rejects,1);
 let registrations=0;const registrationFailure=React.lazy(()=>{registrations++;return {then(){throw error;}};});
 for(let i=0;i<2;i++)assert.throws(()=>registrationFailure._init(registrationFailure._payload),e=>e===error);
 assert.equal(registrations,2);assert.equal(registrationFailure._payload._status,-1);
 let reads=0;const getters=React.lazy(()=>({then(resolve){resolve({get default(){reads++;return Component;}});}}));
 assert.equal(getters._init(getters._payload),Component);assert.equal(getters._init(getters._payload),Component);assert.equal(reads,2);
 const before=reads;assert.equal(planReactLazyStep(rule,{state:{status:'resolved',value:{get default(){reads++;}}},event:'initialize'}).operation,'read_module_property');assert.equal(reads,before);
 console.log(JSON.stringify({build:process.env.NODE_ENV,incorrect_programs_rejected:mutants.length,pending_reuses_loader:true,first_settlement_wins:true,synchronous_loader_error_retries:true,registration_error_keeps_settlement:true,rejection_cached:true,unsettled_registration_error_retries:true,module_getters_not_replayed_by_planner:true}));
}
