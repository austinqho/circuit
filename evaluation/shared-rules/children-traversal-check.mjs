import assert from 'node:assert/strict';
import {createLibraryBoundary} from '../../analysis/library-boundary.mjs';

export function childrenTraversalCases(React){
  const element=React.createElement('span',{key:'a:b=c'},'not traversed'),fragment=React.createElement(React.Fragment,null,'also not traversed');
  const portal={$$typeof:Symbol.for('react.portal'),key:'portal',children:['not traversed'],containerInfo:null,implementation:null};
  const ignored=()=>{throw Error('function child must not execute')},symbol=Symbol('ignored'),holes=new Array(3),big=React.version.startsWith('19.')?[2n]:[];
  const samples=[
    [undefined,[]],[null,[]],[false,[null]],[true,[null]],['',['']],[0,[0]],[-0,[-0]],[NaN,[NaN]],
    [[],[]],[[undefined,null,false,true],[null,null,null,null]],[holes,[null,null,null]],
    [[['one',[2]],[],[false]],['one',2,null]],[[element,fragment,portal],[element,fragment,portal]],
    [[ignored,symbol,2n],big],[element,[element]],[[element,element],[element,element]],
  ];
  return {element,fragment,portal,samples};
}

/** Independently chosen stimuli and assertions; never included in proposal context. */
export function checkReactChildrenTraversal({React,producer,program,method,scope,diagnosticInputs=false}){
  const {element,samples}=childrenTraversalCases(React);
      const boundary=createLibraryBoundary({producer:producer,program,...scope,diagnosticInputs});let callbacks=0;
      for(const [input,expected] of samples) {
        if(method==='count')assert.equal(boundary.invoke([input]),expected.length);
        else {
          const seen=[],receiver={sample:callbacks};
          const result=boundary.invoke([input,function(child,index){callbacks++;seen.push([child,index,this]);return ()=>{throw Error('callback result must be ignored')}},receiver]);
          assert.equal(result,undefined);assert.equal(seen.length,expected.length);
          expected.forEach((value,index)=>{assert(Object.is(seen[index][0],value));assert.equal(seen[index][1],index);assert.equal(seen[index][2],receiver)});
        }
      }
      if(method==='forEach') {
        const error=new Error('stop traversal'),seen=[];
        assert.throws(()=>boundary.invoke([['first','second','third'],(child,index)=>{seen.push(child);if(index===1)throw error}]),caught=>caught===error);
        assert.deepEqual(seen,['first','second']);
      }
      const report=boundary.checkpoint(),domainChecks=[];
      for(const kind of ['key_getter','key_coercion','iterator']) {
        let effects=0;
        const make=()=>kind==='iterator'?new Set(['one','two']):kind==='key_getter'
          ?{$$typeof:element.$$typeof,get key(){effects++;return 'key'},props:{}}
          :{$$typeof:element.$$typeof,key:{toString(){effects++;return 'key'}},props:{}};
        const input=make(),args=method==='count'?[input]:[input,()=>undefined];
        Reflect.apply(producer,undefined,args);const actualEffects=effects;effects=0;
        const probe=createLibraryBoundary({producer:producer,program,...scope,diagnosticInputs});probe.invoke(args);
        assert.equal(effects,actualEffects,'Replay must not perform the getter or coercion again');
        const observed=probe.checkpoint();domainChecks.push({kind,status:observed.status,reason:observed.failures[0]?.reason,actual_effect_count:actualEffects});
      }
      const passed=report.status==='observed_agreement'&&domainChecks.every(row=>row.status==='frontier');
      // Send failed observation facts to repair, not the expected program or the
      // remaining hidden stimuli. An empty normal-case failure list must not
      // hide why a separate out-of-domain probe rejected the candidate.
      const failures=[...report.failures,...domainChecks.filter(row=>row.status!=='frontier').map(row=>({
        reason:'unsupported_input_was_not_a_frontier',detail:{input_kind:row.kind,actual_effect_count:row.actual_effect_count,observed_status:row.status,required_status:'frontier'},
      }))];
      return {status:passed?'passed':'rejected',reason:failures[0]?.reason||null,samples:samples.length,callbacks,report,domainChecks,failures};
}
