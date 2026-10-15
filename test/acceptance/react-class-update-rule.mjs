import {createHash} from 'node:crypto';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';import {validateReactExecutionRule,planReactClassUpdate} from '../../analysis/react-execution-rule.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous'),require=createRequire(path.join(repository,'package.json')),{chromium}=require('playwright');
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}),builds=[];
try{for(const build of ['development','production']){const page=await browser.newPage(),variant=build==='production'?'production.min':'development';
 for(const [name,file] of [['react',`react.${variant}.js`],['react-dom',`react-dom.${variant}.js`]])await page.addScriptTag({content:fs.readFileSync(path.join(repository,'node_modules',name,'umd',file),'utf8')});
 const actual=await page.evaluate(()=>{const output={};for(const name of ['Component','PureComponent']){const Base=React[name],methods={};
  for(const method of ['setState','forceUpdate']){const cases=[];for(const shape of ['object','function','null','undefined','number','boolean','string']){
   let calls=[],returned,thrown=false;const payload={object:{value:1},function:()=>{},null:null,undefined:undefined,number:1,boolean:false,string:'bad'}[shape],completion=()=>{},updaterReturn={};
   const instance=new Base({},null,{enqueueSetState(...args){calls.push({method:'enqueueSetState',args:args.map(value=>value===instance?'instance':value===completion?'completion':value===payload?'payload':value)});return updaterReturn;},enqueueForceUpdate(...args){calls.push({method:'enqueueForceUpdate',args:args.map(value=>value===instance?'instance':value===completion?'completion':value===payload?'payload':value)});return updaterReturn;}});
   try{returned=method==='setState'?instance[method](payload,completion):instance[method](completion);}catch(error){thrown=error instanceof Error;}
   cases.push({shape,thrown,returnsUndefined:returned===undefined,calls});
  }methods[method]=cases;}
  const node=document.createElement('div');document.body.append(node);const root=ReactDOM.createRoot(node);let instance,renders=0,calculations=[],completions=[],second=0;
  class Target extends Base{constructor(props){super(props);this.state={count:1,keep:true};instance=this;}shouldComponentUpdate(){return false;}render(){renders++;return null;}}
  ReactDOM.flushSync(()=>root.render(React.createElement(React.StrictMode,null,React.createElement(Target,{delta:2}))));
  const before=renders;
  ReactDOM.flushSync(()=>instance.setState(function(state,props){calculations.push({receiver:this===instance,count:arguments.length,state:state.count,props:props.delta});return {count:state.count+props.delta};},function(){completions.push({receiver:this===instance,count:arguments.length,state:this.state.count});}));
  const merged={...instance.state},afterState=renders;
  ReactDOM.flushSync(()=>instance.setState(function(){second++;return null;},function(){completions.push({receiver:this===instance,count:arguments.length,state:this.state.count});}));
  const afterNull={same:instance.state.count===merged.count,keep:instance.state.keep,renders};
  ReactDOM.flushSync(()=>instance.forceUpdate(function(){completions.push({receiver:this===instance,count:arguments.length,state:this.state.count});}));
  const forcedRender=renders>afterState;let replay=0;ReactDOM.flushSync(()=>instance.setState(()=>({selected:++replay})));
  output[name]={methods,calculations,completions,merged,first_replay_result:instance.state.selected===1,replay,normal_bailed:afterState===before,null_no_change:afterNull.same&&afterNull.keep&&afterNull.renders===afterState,forced_render:forcedRender,second};
  ReactDOM.flushSync(()=>root.unmount());node.remove();
 }return output;});
 const reports=[];for(const name of ['Component','PureComponent'])for(const member of ['setState','forceUpdate']){
  const rule=getReactBehavior({surface:'react',exportName:name,version:'18.3.1'}).members[member].execution,observed=actual[name];
  const check=program=>{assert.equal(validateReactExecutionRule(program).valid,true);
   for(const row of observed.methods[member]){const payload={object:{value:1},function:()=>{},null:null,undefined:undefined,number:1,boolean:false,string:'bad'}[row.shape],completion=()=>{},instance={},updaterResult={};
    const plan=planReactClassUpdate(program,{args:member==='setState'?[payload,completion]:[completion],instance,updaterResult});assert.equal(plan.operation==='throw',row.thrown);
    if(row.thrown)continue;assert.equal(plan.member,row.calls[0].method);assert.deepEqual(plan.args.map(value=>value===instance?'instance':value===completion?'completion':value===payload?'payload':value),row.calls[0].args);assert.equal(plan.result===undefined,row.returnsUndefined);assert.equal(plan.queue_execution_proven,false);
   }
   const instance={},state={count:1,keep:true},props={delta:2},values=new Map([[instance,'instance'],[state,'state'],[props,'props']]);
   const completion=planReactClassUpdate(program,{operation:'callback',role:'completion',instance,state,props});assert.equal(completion.args.length,observed.completions[0].count);assert.equal(completion.receiver===instance,observed.completions[0].receiver);
   if(member==='setState'){const calculation=planReactClassUpdate(program,{operation:'callback',role:'calculation',instance,state,props});assert.deepEqual(calculation.args.map(value=>values.get(value)),['state','props']);assert.equal(calculation.args.length,observed.calculations[0].count);assert.equal(calculation.receiver===instance,observed.calculations[0].receiver);
    const partial={count:state.count+props.delta},merged=calculation.merge==='shallow'?{...state,...partial}:partial;assert.deepEqual(merged,observed.merged);assert.equal(calculation.nullish==='previous',observed.null_no_change);assert.equal(calculation.force,!observed.normal_bailed);
   }else assert.equal(completion.force,observed.forced_render);
   assert.equal(observed.first_replay_result,true);assert.equal(observed.replay,build==='development'?2:1);
  };check(rule);
  const mutants=[{updater_member:member==='setState'?'enqueueForceUpdate':'enqueueSetState'},{completion_argument:3},{result:'updater_result'},{updater_arguments:['completion','instance']},{completion_arguments:['state']},{callback_receiver:'undefined'},{force:!rule.force},...(member==='setState'?[{payload_argument:1},{validate_payload:false},{calculation_arguments:['props','state']},{merge:'replace'},{nullish:'replace'}]:[])];
  for(const mutation of mutants)assert.throws(()=>check({...rule,...mutation}),undefined,JSON.stringify(mutation));
  reports.push({api:`react/${name}/18.3.1`,member,rule_sha256:createHash('sha256').update(JSON.stringify(rule)).digest('hex'),incorrect_programs_rejected:mutants.length,actual_method_cases:7,original_updater_argument_identity:true,original_method_return:true,
   callback_receiver_arguments:true,partial_merge_and_null_noop:true,force_bypasses_custom_bailout:true,strict_calculation_calls:observed.calculations.length,completion_calls:observed.completions.length,first_strict_replay_result_selected:observed.first_replay_result});
 }
 builds.push({build,rows:reports});await page.close();}
 console.log(JSON.stringify({format_pass:true,behavior_pass:true,builds},null,2));
}finally{await browser.close();}
