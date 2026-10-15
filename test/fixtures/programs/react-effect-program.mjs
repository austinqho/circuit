// Manual calibration from the pinned React renderer's effect registration,
// dependency comparison and commit hook lists. No new interpreter instruction.
import {p,arg,local,lit,undef,array,bind,call} from './programs.mjs';
const set=(name,value)=>({op:'set',name,value});
const sequence=(...steps)=>({op:'sequence',steps});
const equal=(left,right)=>({op:'same',left,right});
const get=(value,key)=>({op:'get',value,key});
const branch=(test,then,otherwise=undef)=>({op:'if',test,then,else:otherwise});
const invoke=target=>call(target,array());
const cleanup=branch(equal({op:'type',value:local('cleanup')},lit('function')),invoke(local('cleanup')));
const sameDeps=branch(equal(local('deps'),undef),lit(false),
  branch(equal(get(local('pending'),1),undef),lit(false),
    branch(equal(local('deps'),lit(null)),lit(false),
      branch(equal(get(local('pending'),1),lit(null)),lit(false),
        branch(equal(get(local('deps'),'length'),get(get(local('pending'),1),'length')),
          {op:'every',items:local('deps'),value_name:'dependency',index_name:'index',test:equal(local('dependency'),{op:'at',value:get(local('pending'),1),index:local('index')})},lit(false))))));
export const effectProgram=p(bind('pending',undef,bind('deps',undef,bind('active',lit(false),bind('cleanup',undef,
  {op:'fn',this_mode:'strict',body:
    branch(equal(arg(0),lit('register')),sequence(set('pending',arg(1)),undef),
      branch(equal(arg(0),lit('disconnect')),sequence(cleanup,set('cleanup',undef),set('active',lit(false)),undef),
        branch(equal(arg(0),lit('commit')),
          branch(branch(local('active'),sameDeps,lit(false)),undef,
            sequence(cleanup,set('cleanup',invoke(get(local('pending'),0))),set('deps',get(local('pending'),1)),set('active',lit(true)),undef)),
          {op:'frontier',reason:'unknown_host_event'})))},
)))));
