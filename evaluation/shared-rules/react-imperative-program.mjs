import {effectProgram} from './react-effect-program.mjs';
import {arg,local,lit,undef,array,bind,call} from './programs.mjs';
const get=(value,key)=>({op:'get',value,key});
const equal=(left,right)=>({op:'same',left,right});
const branch=(test,then,otherwise=undef)=>({op:'if',test,then,else:otherwise});
const fn=body=>({op:'fn',this_mode:'strict',body});
const invoke=(target,...args)=>call(target,array(...args));
const isFunction=value=>equal({op:'type',value},lit('function'));

/** Reuse the effect state machine. Only the registration's setup closure and
 * dependency list differ. These operations are transcribed from the pinned
 * imperativeHandleEffect and mount/updateImperativeHandle implementations. */
export function imperativeCallbackProgram({refCleanup=false}={}) {
  const program=structuredClone(effectProgram);
  const cleanup=refCleanup?branch(isFunction(local('refCleanup')),invoke(local('refCleanup')),invoke(local('ref'),lit(null))):invoke(local('ref'),lit(null));
  const setup=fn(branch(isFunction(local('ref')),
    bind('handle',invoke(local('create')),bind('refCleanup',invoke(local('ref'),local('handle')),fn(cleanup))),
    branch(equal(local('ref'),lit(null)),undef,branch(equal(local('ref'),undef),undef,
      {op:'sequence',steps:[invoke(get(local('ref'),'write'),invoke(local('create'))),fn(invoke(get(local('ref'),'write'),lit(null)))]}))));
  const dependencies=branch(equal(local('inputs'),undef),undef,branch(equal(local('inputs'),lit(null)),lit(null),
    {op:'concat',items:[local('inputs'),array(local('ref'))]}));
  const frame=bind('ref',get(arg(1),0),bind('create',get(arg(1),1),bind('inputs',get(arg(1),2),array(setup,dependencies))));
  const visit=node=>{if(!node||typeof node!=='object')return;
    if(node.op==='set'&&node.name==='pending'){node.value=frame;return;}
    Object.values(node).forEach(visit);
  };visit(program);return program;
}

export const imperativeCallbackLayout={callbackArguments:[0,1],nullableCallbackArguments:[0],callbackReturnArguments:[0],stableCallbackArguments:[0],objectRefArguments:[0],dependencyArgument:2};
