import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';import {validateReactExecutionRule,planReactClassOperation} from '../../analysis/react-execution-rule.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous'),require=createRequire(path.join(repository,'package.json')),{chromium}=require('playwright');
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}),builds=[];
try{for(const build of ['development','production']){const page=await browser.newPage(),variant=build==='production'?'production.min':'development';
 await page.addScriptTag({content:fs.readFileSync(path.join(repository,`node_modules/react/umd/react.${variant}.js`),'utf8')});
 await page.addScriptTag({content:fs.readFileSync(path.join(repository,`node_modules/react-dom/umd/react-dom.${variant}.js`),'utf8')});
 const actual=await page.evaluate(()=>{
  const output={};for(const name of ['Component','PureComponent']){const Base=React[name],props={},context={},updater={},a=new Base(props,context,updater),b=new Base({},{}),c=new Base({},{});
   const fallback=[undefined,null,false,0,''].every(value=>new Base(props,context,value).updater===b.updater);
   const results=[];
   for(const config of [{same:true},{changed:true},{nan:true},{zero:true},{state:true},{custom:false},{custom:true,same:true},{custom:false,force:true}]){
    const node=document.createElement('div');document.body.append(node);const root=ReactDOM.createRoot(node);let calls=0,instance;
    class Target extends Base{constructor(p){super(p);this.state={value:1};instance=this;}render(){calls++;return React.createElement('span',null,'value');}}
    if('custom' in config)Target.prototype.shouldComponentUpdate=function(){return config.custom;};
    const first=config.nan?NaN:config.zero?0:1;
    ReactDOM.flushSync(()=>root.render(React.createElement(Target,{value:first})));
    const before=calls;
    if(config.force)ReactDOM.flushSync(()=>instance.forceUpdate());
    else if(config.state)ReactDOM.flushSync(()=>instance.setState({value:2}));
    else ReactDOM.flushSync(()=>root.render(React.createElement(Target,{value:config.nan?NaN:config.zero?-0:config.same?1:2})));
    results.push({config,render:calls>before});ReactDOM.flushSync(()=>root.unmount());node.remove();
   }
   // The caller's updater is forwarded untouched, including original callback and instance.
   const calls=[],callback=()=>{},partial={x:1},customUpdater={enqueueSetState(...args){calls.push(args);},enqueueForceUpdate(...args){calls.push(args);}},owned=new Base(props,context,customUpdater);
   owned.setState(partial,callback);owned.forceUpdate(callback);
   output[name]={props:a.props===props,context:a.context===context,updater:a.updater===updater,fallback,sharedRefs:a.refs===b.refs&&b.refs===c.refs,pure:a.isPureReactComponent===true,
    forwarded:calls[0][0]===owned&&calls[0][1]===partial&&calls[0][2]===callback&&calls[1][0]===owned&&calls[1][1]===callback,results};
  }return output;
 });
 const reports=[];
 for(const name of ['Component','PureComponent']){const rule=getReactBehavior({surface:'react',exportName:name,version:'18.3.1'}).execution,observed=actual[name];
  const check=program=>{assert.equal(validateReactExecutionRule(program).valid,true);const props={},context={},updater={},refs={},fallback={};
   const plan=planReactClassOperation(program,{args:[props,context,updater],sharedRefs:refs,defaultUpdater:fallback});
   assert.equal(plan.props===props,observed.props);assert.equal(plan.context===context,observed.context);assert.equal(plan.updater===updater,observed.updater);assert.equal(plan.refs===refs,observed.sharedRefs);assert.equal(plan.pure,observed.pure);
   assert.equal([undefined,null,false,0,''].every(value=>planReactClassOperation(program,{args:[props,context,value],defaultUpdater:fallback}).updater===fallback),observed.fallback);
   const render=planReactClassOperation(program,{operation:'render',props,state:context});assert.equal(render.method,'render');assert.equal(render.inputs.props,props);assert.equal(render.inputs.state,context);assert.equal(render.commit_proven,false);
   for(const {config,render:expected} of observed.results){const sameValue=config.nan?planReactClassOperation(program,{operation:'compare',left:NaN,right:NaN}).equal:config.zero?planReactClassOperation(program,{operation:'compare',left:0,right:-0}).equal:!!config.same;
    const update=planReactClassOperation(program,{operation:'update_check',propsEqual:config.state?true:sameValue,stateEqual:!config.state,force:!!config.force,custom:'custom' in config?{called:true,result:config.custom}:null});assert.equal(update.allows_render,expected,JSON.stringify(config));}
   assert.equal(observed.forwarded,true);
  };check(rule);
  const mutants=[{props_argument:1},{context_argument:0},{updater_argument:0},{updater_default:'nullish'},{refs:'fresh_empty'},{pure:!rule.pure},{render_method:'componentDidMount'},{props_field:'context'},{state_field:'context'},{custom_should_update:'after_default'},{default_update:rule.default_update==='always'?'shallow_props_state':'always'},...(name==='PureComponent'?[{comparison:'strict_equal'}]:[])];
  for(const mutation of mutants)assert.throws(()=>check({...rule,...mutation}),undefined,JSON.stringify(mutation));
  reports.push({api:`react/${name}/18.3.1`,incorrect_programs_rejected:mutants.length,constructor_identity_and_falsy_updater:true,original_updater_arguments:true,render_input_fields:true,custom_override_and_force:true,shallow_props_state_nan_signed_zero:name==='PureComponent',observed_updates:observed.results.length});
 }
 builds.push({build,apis:reports});await page.close();}
 console.log(JSON.stringify({apis:['react/Component/18.3.1','react/PureComponent/18.3.1'],format_pass:true,behavior_pass:true,builds},null,2));
}finally{await browser.close();}
