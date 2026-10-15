import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';
import {validateReactExecutionRule,planElementPredicate} from '../../analysis/react-execution-rule.mjs';

const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
if(!process.argv.includes('--child')) {
  const builds=['development','production'].map(build=>JSON.parse(execFileSync(process.execPath,
    [fileURLToPath(import.meta.url),repository,'--child'],{encoding:'utf8',env:{...process.env,NODE_ENV:build}})));
  console.log(JSON.stringify({api:'react/isValidElement/18.3.1',format_pass:true,behavior_pass:true,builds},null,2));
} else {
  const require=createRequire(path.join(repository,'package.json')),React=require('react');
  assert.equal(React.version,'18.3.1');
  const elementTag=Symbol.for('react.element'),foreignTag=Symbol.for('react.portal');
  const rule=getReactBehavior({surface:'react',exportName:'isValidElement',version:'18.3.1'}).execution;
  // These inputs, expected outcomes, and property-read counts are fixed by the
  // harness. The proposed program cannot supply its own probes or expectations.
  const makeCases=()=>{
    const error={marker:'original error'},reads=[];
    const getter=(value,throwing=false)=>({get $$typeof(){reads.push('$$typeof');if(throwing)throw error;return value;}});
    const proxy=new Proxy({}, {get(_target,key){reads.push(key);return elementTag;}});
    const throwingProxy=new Proxy({}, {get(_target,key){reads.push(key);throw error;}});
    const revoked=Proxy.revocable({},{});revoked.revoke();
    const element=React.createElement('i',null,'child');
    return {reads,cases:[
      ...[undefined,null,false,0,'text',1n,Symbol('value'),Object.assign(()=>{},{$$typeof:elementTag})]
        .map(value=>({args:[value],result:false,reads:0,lookup:false})),
      {args:[{}],result:false,reads:0,lookup:true,marker:undefined},
      {args:[[element]],result:false,reads:0,lookup:true,marker:undefined},
      {args:[element],result:true,reads:0,lookup:true,marker:elementTag},
      {args:[React.cloneElement(element)],result:true,reads:0,lookup:true,marker:elementTag},
      {args:[{$$typeof:foreignTag}],result:false,reads:0,lookup:true,marker:foreignTag},
      {args:[Object.create({$$typeof:elementTag})],result:true,reads:0,lookup:true,marker:elementTag},
      {args:[getter(elementTag)],result:true,reads:1,lookup:true,marker:elementTag},
      {args:[getter(foreignTag)],result:false,reads:1,lookup:true,marker:foreignTag},
      {args:[getter(null,true)],error,reads:1,lookup:true},
      {args:[proxy],result:true,reads:1,lookup:true,marker:elementTag},
      {args:[throwingProxy],error,reads:1,lookup:true},
      {args:[revoked.proxy],errorType:TypeError,reads:0,lookup:true},
      {args:[element,{$$typeof:foreignTag}],result:true,reads:0,lookup:true,marker:elementTag},
    ]};
  };
  const check=program=>{
    assert.equal(validateReactExecutionRule(program).valid,true);
    const {reads,cases}=makeCases();
    for(const fixture of cases) {
      const before=reads.length,plan=planElementPredicate(program,{args:fixture.args});
      assert.equal(reads.length,before,'prediction must not run a getter or proxy');
      assert.equal(plan.status,fixture.lookup?'planned':'predicted');
      if(fixture.lookup){assert.equal(plan.target,fixture.args[0]);assert.equal(plan.property,'$$typeof');}
      let actual,error,threw=false;
      try{actual=React.isValidElement(...fixture.args);}catch(value){threw=true;error=value;}
      assert.equal(reads.length-before,fixture.reads,'only the actual library performs its marker read');
      if(fixture.errorType)assert.ok(error instanceof fixture.errorType);
      else if('error' in fixture)assert.equal(error,fixture.error);
      else {assert.equal(threw,false);assert.equal(actual,fixture.result);}
      const prediction=plan.status==='predicted'?plan:planElementPredicate(program,{args:fixture.args,
        propertyRead:{outcome:threw?'threw':'returned',value:threw?error:fixture.marker}});
      assert.equal(prediction.outcome,threw?'threw':'returned');
      assert.equal(prediction.value,threw?error:actual);
      assert.equal(reads.length-before,fixture.reads,'completing the plan must not repeat the property read');
    }
    return cases.length;
  };
  const cases=check(rule);
  const mutants=[{argument:1},{input_kind:'function'},{exclude_null:false},{marker_property:'type'},{marker_symbol:'react.portal'}];
  for(const mutation of mutants){assert.equal(validateReactExecutionRule({...rule,...mutation}).valid,true);assert.throws(()=>check({...rule,...mutation}));}
  console.log(JSON.stringify({build:process.env.NODE_ENV,cases,incorrect_rules_rejected:mutants.length,
    getter_proxy_reads_preserved:true,exception_identity:true,installed_version:React.version}));
}
