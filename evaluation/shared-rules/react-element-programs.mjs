// Manually transcribed rules for the production element-data boundary. These
// builders produce ordinary shared instructions; the interpreter has no React
// names or React-specific branches. Admission tests live in a separate module.
const literal=value=>({op:'literal',value}), arg=index=>({op:'arg',index}), local=name=>({op:'local',name});
const undef={op:'undefined'}, get=(value,key)=>({op:'get',value,key}), equal=(left,right)=>({op:'equal',left,right});
const seq=(...steps)=>({op:'sequence',steps}), iff=(test,then,otherwise=undef)=>({op:'if',test,then,else:otherwise});
const bind=(name,value,body)=>({op:'bind',name,value,body}), put=(value,key,item)=>({op:'put',value,key,item});
const lookup=(value,key)=>({op:'lookup',value,key}), set=(name,value)=>({op:'set',name,value});
const not=value=>({op:'not',value}), nullish=value=>iff(equal(value,literal(null)),literal(true),equal(value,undef));
const oneOf=(value,keys)=>keys.reduceRight((tail,key)=>iff(equal(value,literal(key)),literal(true),tail),literal(false));
const each=(object,body)=>({op:'every',items:{op:'keys',value:object},value_name:'property',index_name:'index',test:seq(body,literal(true))});
const property=local('property'), props=local('props'), config=arg(1), type=local('type');
const copyChildren=bind('children',{op:'slice',value:{op:'args'},start:2},
  iff(equal(get(local('children'),'length'),literal(1)),put(props,literal('children'),{op:'at',value:local('children'),index:literal(0)}),
    iff(not(equal(get(local('children'),'length'),literal(0))),put(props,literal('children'),local('children')))));
const defaults=iff(type,get(type,'defaultProps'));

export function reactElementProgram(exportName,version) {
  const is18=version==='18.3.1', clone=exportName==='cloneElement';
  if(!['18.3.1','19.1.1'].includes(version)||!['createElement','cloneElement'].includes(exportName))throw new Error('unreviewed_element_source');
  const reserved=is18?['key','ref','__self','__source']:['key','__self','__source'];
  const copyConfig=each(config,iff(oneOf(property,reserved),undef,
    !is18&&clone ? iff(iff(equal(property,literal('ref')),equal(lookup(config,property),undef),literal(false)),undef,put(props,property,lookup(config,property)))
    : is18&&clone ? put(props,property,iff(iff(equal(lookup(config,property),undef),not(equal(local('defaults'),undef)),literal(false)),lookup(local('defaults'),property),lookup(config,property)))
    : put(props,property,lookup(config,property))));
  const body=bind('type',clone?get(arg(0),'type'):arg(0),bind('props',{op:'object',entries:{}},
    bind('key',clone?get(arg(0),'key'):literal(null),bind('ref',is18&&clone?get(arg(0),'ref'):literal(null),bind('defaults',defaults,
      seq(
        clone?each(get(arg(0),'props'),put(props,property,lookup(get(arg(0),'props'),property))):undef,
        iff(not(nullish(config)),seq(
          iff(not(equal(get(config,'key'),undef)),set('key',{op:'string',value:get(config,'key')})),
          is18?iff(not(equal(get(config,'ref'),undef)),set('ref',get(config,'ref'))):undef,
          copyConfig)),
        copyChildren,
        clone?undef:iff(local('defaults'),each(local('defaults'),iff(equal(lookup(props,property),undef),put(props,property,lookup(local('defaults'),property))))),
        {op:'object',entries:{type,key:local('key'),props,ref:is18?local('ref'):iff(equal(get(props,'ref'),undef),literal(null),get(props,'ref'))}}
      ))))));
  const messagePrefix=is18?'React.cloneElement(...): ':'';
  const invalid=iff(equal(arg(0),literal(null)),literal(messagePrefix+'The argument must be a React element, but you passed null.'),literal(messagePrefix+'The argument must be a React element, but you passed undefined.'));
  return {schema:'producttrace.library-program.v1',body:clone?iff(nullish(arg(0)),{op:'throw',value:{op:'make_error',name:'Error',message:invalid}},body):body};
}
