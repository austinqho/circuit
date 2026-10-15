// Manual source-derived calibration. Never included in model proposal context.
const arg=index=>({op:'arg',index}), local=name=>({op:'local',name}), lit=value=>({op:'literal',value});
const bind=(name,value,body)=>({op:'bind',name,value,body});
const iff=(test,then,otherwise)=>({op:'if',test,then,else:otherwise});
const set=(name,value)=>({op:'set',name,value});
const eq=(left,right)=>({op:'same',left,right});
const no=value=>({op:'not',value});
const and=(...tests)=>tests.reduceRight((rest,test)=>iff(test,rest,lit(false)),lit(true));
// The production helper compares the overlapping prefix. Do not silently add
// a length equality check: that would change the exact installed behavior.
const sameDependencies=bind('end',lit(false),{op:'every',items:local('deps'),value_name:'dep',index_name:'index',
  test:iff(local('end'),lit(true),iff(eq(local('index'),{op:'get',value:local('previous'),key:'length'}),set('end',lit(true)),
    eq(local('dep'),{op:'at',value:local('previous'),index:local('index')})))});
export const reactMemoProgram={schema:'producttrace.library-program.v1',body:
  bind('ready',lit(false),bind('previous',lit(null),bind('cached',{op:'undefined'},
    {op:'fn',this_mode:'strict',body:bind('deps',iff(eq(arg(1),{op:'undefined'}),lit(null),arg(1)),
      iff(and(local('ready'),no(eq(local('deps'),lit(null))),no(eq(local('previous'),lit(null))),sameDependencies),local('cached'),
        bind('next',{op:'call',target:arg(0),receiver:{op:'undefined'},args:{op:'array',items:[]}},
          {op:'sequence',steps:[set('previous',local('deps')),set('cached',local('next')),set('ready',lit(true)),local('cached')]}))) })))};
export const reactMemoScope={protocol:'owned_call_boundary',ownerGeneration:'host',callbackArguments:[0],resultPaths:null,
  description:'Production useMemo in an attested mounted slot and host-observed cache generation, including discarded suspended updates and restored generations. Callback invocation, original result identity, dependency Object.is comparison, undefined/null dependencies and exact cached values are checked. Cache-generation identity comes from the version-pinned adjacent private memo hook. Initial suspension/retry and render-phase re-renders are also checked in the pinned production host; development double invocation remains outside this scope; no commit claim is made. Plain data dependencies, named-import calls and original callback outcomes only.'};
