// Source-derived scoped programs. This file is independent grading material,
// never context for a bank-blind model proposal.
const arg=index=>({op:'arg',index}),local=name=>({op:'local',name}),literal=value=>({op:'literal',value}),empty={op:'undefined'};
const sequence=steps=>({op:'sequence',steps}),bind=(name,value,body)=>({op:'bind',name,value,body});
const choose=(test,yes,no)=>({op:'if',test,then:yes,else:no}),same=(left,right)=>({op:'same',left,right});
const call=(target,items,receiver=empty)=>({op:'call',target,args:{op:'array',items},receiver});
const type=value=>({op:'type',value}),get=(value,key)=>({op:'get',value,key});
const either=(a,b)=>choose(a,literal(true),b);
export function childrenTraversalProgram(version,method) {
  const child=local('child'),count=get(local('visited'),'length');
  const leaf=sequence([
    ...(method==='forEach'?[call(local('callback'),[child,count],local('context'))]:[]),
    {op:'put',value:local('visited'),key:count,item:empty},literal(true),
  ]);
  const primitive=either(same(child,literal(null)),either(same(type(child),literal('string')),either(same(type(child),literal('number')),
    version.startsWith('19.')?same(type(child),literal('bigint')):literal(false))));
  const element=either(same(get(child,'$$typeof'),{op:'symbol',key:version.startsWith('19.')?'react.transitional.element':'react.element'}),same(get(child,'$$typeof'),{op:'symbol',key:'react.portal'}));
  const descend={op:'every',items:child,value_name:'item',index_name:'index',test:sequence([call(local('walk'),[local('item')]),literal(true)])};
  // React computes traversal keys even when the public result only counts or
  // visits children. Validate those reads/coercions so a hidden getter cannot
  // disappear from an otherwise matching count. Escaping the string is not
  // observable in these two APIs' scoped outputs.
  const keyRead=bind('key',get(child,'key'),choose(either(same(local('key'),empty),same(local('key'),literal(null))),empty,{op:'string',value:local('key')}));
  const walk={op:'fn',this_mode:'strict',body:bind('child',arg(0),sequence([
    choose(either(same(child,empty),same(type(child),literal('boolean'))),{op:'set',name:'child',value:literal(null)},empty),
    choose(primitive,leaf,choose(same(type(child),literal('object')),sequence([keyRead,choose(element,leaf,descend)]),empty)),
  ]))};
  return {schema:'producttrace.library-program.v1',body:bind('visited',{op:'array',items:[]},bind('callback',arg(1),bind('context',arg(2),bind('walk',empty,sequence([
    {op:'set',name:'walk',value:walk},choose(either(same(arg(0),literal(null)),same(arg(0),empty)),empty,call(local('walk'),[arg(0)])),
    method==='count'?count:empty,
  ])))))};
}
export {childrenTraversalScope} from './children-traversal-scope.mjs';
