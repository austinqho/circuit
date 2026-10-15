import {AsyncLocalStorage} from 'node:async_hooks';
import path from 'node:path';
import vm from 'node:vm';
import {types} from 'node:util';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {createLibraryBoundary} from '../analysis/library-boundary.mjs';
import {createLibraryProgramBank} from '../analysis/library-program-bank.mjs';
import {instrumentLibraryPrograms} from '../analysis/library-program-integration.mjs';
import {createLibraryProgramVerifier} from './library-program-verifier.mjs';

const inputFailure=reason=>({status:'frontier',reason:'checker_failure',detail:{gate:'independent_inputs',message:reason}});

/** The trusted checker supplies fresh experiments; the proposing model cannot
 * edit them. Experiments describe inputs and actual calls, not expected library
 * answers. The ordinary boundary compares the real library with the candidate.
 * Ownership/renderer protocols require their own independently attested host. */
export function createLibraryExperimentChecks({repository,scope,makeExperiments}) {
  if(typeof makeExperiments!=='function')throw new TypeError('independent_experiments_required');
  if(scope?.protocol)throw new TypeError('experiment_owner_protocol_requires_host');
  const make=()=>{
    const functions=new Map(),storage=new AsyncLocalStorage();
    const dataFunction=(result=undefined)=>{
      const state={calls:0,ungranted:0};
      const value=function(){state.calls++;if(!storage.getStore()?.has(value))state.ungranted++;return result};functions.set(value,state);return value;
    };
    const plans=makeExperiments({dataFunction});
    if(!Array.isArray(plans)||!plans.length||plans.length>128)throw new TypeError('experiment_count');
    const ids=new Set();let calls=0;
    for(const plan of plans){
      if(typeof plan?.id!=='string'||!plan.id.length||ids.has(plan.id))throw new TypeError('experiment_identity');ids.add(plan.id);
      if(!Array.isArray(plan.roots)||!plan.roots.length||!Array.isArray(plan.calls??[]))throw new TypeError('experiment_calls');
      for(const call of [...plan.roots,...(plan.calls??[])]){
        if(++calls>2048||!Array.isArray(call.args)||call.args.length>64)throw new TypeError('experiment_arguments');
      }
      for(const call of plan.calls??[])if(!Number.isInteger(call.root)||call.root<0||call.root>=plan.roots.length)throw new TypeError('experiment_return_reference');
    }
    // Untouched function-valued inputs need an independent body counter;
    // replacing them during the experiment would itself change identity.
    const inspect=(value,seen=new Set(),depth=0)=>{
      if(value===null||!['object','function'].includes(typeof value))return;
      if(depth>12||seen.size>4096||types.isProxy(value))throw new TypeError('experiment_input_graph_unobservable');
      if(typeof value==='function'){
        if(!functions.has(value))throw new TypeError('data_function_requires_independent_observer');return;
      }
      if(seen.has(value))return;seen.add(value);
      const descriptors=Object.getOwnPropertyDescriptors(value);
      for(const key of Reflect.ownKeys(descriptors)){const descriptor=descriptors[key];
        if(!('value' in descriptor))throw new TypeError('experiment_input_accessor_unobservable');
        inspect(descriptor.value,seen,depth+1);
      }
    };
    for(const plan of plans){
      for(const call of plan.roots){inspect(call.receiver);call.args.forEach((value,index)=>{if(!scope.callbackArguments.includes(index))inspect(value)})}
      for(const call of plan.calls??[]){inspect(call.receiver);call.args.forEach((value,index)=>{if(!(scope.returnedCallbackArguments??[]).includes(index))inspect(value)})}
    }
    for(const state of functions.values()){state.calls=0;state.ungranted=0}
    return {plans,functions,storage};
  };
  const exercise=(plan,invoke,storage)=>{
    let returned=0,thrown=0;const booleans=new Set();let otherTerminalValues=0;
    const attempt=work=>{try{const value=work();returned++;if(typeof value==='boolean')booleans.add(value);else if(typeof value!=='function')otherTerminalValues++;return {value,returned:true}}catch{thrown++;return {returned:false}}};
    const granted=plan.roots.map(call=>new Set(scope.callbackArguments.map(index=>call.args[index]).filter(value=>typeof value==='function')));
    const roots=plan.roots.map((call,index)=>attempt(()=>storage.run(granted[index],()=>invoke(call))));
    for(const call of plan.calls??[]){
      const root=roots[call.root];
      if(!root.returned||typeof root.value!=='function')return {input_error:'independent_input_did_not_create_callable',returned,thrown};
      const allowed=new Set([...granted[call.root],...(scope.returnedCallbackArguments??[]).map(index=>call.args[index]).filter(value=>typeof value==='function')]);
      attempt(()=>storage.run(allowed,()=>Reflect.apply(root.value,call.receiver,call.args)));
    }
    return {returned,thrown,boolean_outcomes:[...booleans],other_terminal_values:otherTerminalValues};
  };
  const finish=async(sessions,functions)=>{
    // First observe the independently selected microtask checkpoint. A timeout
    // callback cannot masquerade as a microtask merely because both ran later.
    await new Promise(resolve=>queueMicrotask(resolve));
    const early=sessions.map(session=>session.checkpoint());
    await new Promise(resolve=>setTimeout(resolve,0));
    const reports=sessions.map((session,index)=>({experiment:session.id,observations:session.observations,
      microtask:early[index],final:session.checkpoint()}));
    const flattened=reports.flatMap(row=>[row.microtask,row.final]).flat();
    const failures=flattened.flatMap(row=>row.failures??(row.reason?[{reason:row.reason}]:[]));
    for(const state of functions.values())if(state.ungranted)failures.push({reason:'ungranted_data_function_invoked',calls:state.ungranted});
    const returned=sessions.reduce((n,row)=>n+row.observations.returned,0);
    if(!returned)return inputFailure('independent_inputs_all_threw');
    const booleans=new Set(sessions.flatMap(row=>row.observations.boolean_outcomes));
    if(booleans.size===1&&!sessions.some(row=>row.observations.other_terminal_values))
      return inputFailure('independent_inputs_do_not_distinguish_boolean_outcomes');
    return {status:!failures.length&&flattened.every(row=>row.status==='observed_agreement')?'passed':'rejected',
      reason:failures[0]?.reason??null,failures,reports,
      observation_window:'One microtask checkpoint followed by one zero-delay timer checkpoint; no claim about later external triggers.',
      successful_calls:returned,thrown_calls:sessions.reduce((n,row)=>n+row.observations.thrown,0)};
  };
  const behavior=async({implementation,program})=>{
    let prepared;try{prepared=make()}catch(error){return inputFailure(error.message)}
    const {plans,functions,storage}=prepared;
    const sessions=[];
    for(const plan of plans){
      const boundary=createLibraryBoundary({producer:implementation.producer,program,...scope,occurrencePrefix:'experiment:'+plan.id,diagnosticInputs:true});
      const observations=exercise(plan,call=>boundary.invoke(call.args,{receiver:call.receiver}),storage);
      if(observations.input_error)return inputFailure(observations.input_error);
      sessions.push({id:plan.id,observations,checkpoint:()=>boundary.checkpoint()});
    }
    return finish(sessions,functions);
  };
  const integration=async({implementation,program})=>{
    let prepared;try{prepared=make()}catch(error){return inputFailure(error.message)}
    const {plans,functions,storage}=prepared;
    if(plans.some(plan=>plan.roots.some(call=>call.receiver!==undefined)))return inputFailure('source_import_call_requires_undefined_receiver');
    const {specifier,export_name:exportName}=implementation.context,parts=exportName.split('.');
    if(parts.some(part=>!/^[$A-Z_a-z][$\w]*$/.test(part)))return inputFailure('source_export_identifier_unsupported');
    const declaration=exportName==='default'?`import target from ${JSON.stringify(specifier)};`
      :`import {${parts[0]} as target} from ${JSON.stringify(specifier)};`;
    const target='target'+parts.slice(1).map(part=>'['+JSON.stringify(part)+']').join('');
    const arities=[...new Set(plans.flatMap(plan=>plan.roots.map(call=>call.args.length)))];
    const source=declaration+arities.map(arity=>{
      const args=Array.from({length:arity},(_,index)=>'arg'+index).join(',');
      return `export function invoke${arity}(${args}){return ${target}(${args})}`;
    }).join('\n');
    // The provisional bank is inaccessible to application callers. Only the
    // outer verifier can grant an entry after behavior AND integration pass.
    const probe=createLibraryProgramBank({check:async()=>({status:'passed',reason:'private_source_integration_probe'})});
    const admission=await probe.admit({implementation,program,scope});
    if(admission.status!=='admitted')return admission;
    const transformed=instrumentLibraryPrograms({source,file:'independent-library-experiment.ts',bank:probe});
    if(transformed.frontiers.length||transformed.bindings.length!==arities.length)return inputFailure('source_adapter_binding_unavailable');
    const require=createRequire(path.resolve(repository,'package.json')),library=require(specifier),exports={};
    vm.runInNewContext(ts.transpileModule(transformed.code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,
      {exports,require:()=>library,[transformed.runtimeKey]:transformed.runtime});
    const observations={returned:0,thrown:0,boolean_outcomes:[],other_terminal_values:0};
    for(const plan of plans){
      const result=exercise(plan,call=>Reflect.apply(exports['invoke'+call.args.length],undefined,call.args),storage);
      if(result.input_error)return inputFailure(result.input_error);
      observations.returned+=result.returned;observations.thrown+=result.thrown;
      observations.boolean_outcomes.push(...result.boolean_outcomes);observations.other_terminal_values+=result.other_terminal_values;
    }
    const result=await finish([{id:'actual_namespace_source',observations,checkpoint:()=>transformed.runtime.checkpoint()}],functions);
    return {...result,bindings:transformed.bindings};
  };
  return {behavior,integration};
}

export function createLibraryExperimentVerifier(options) {
  return createLibraryProgramVerifier({scope:options.scope,...createLibraryExperimentChecks(options)});
}
