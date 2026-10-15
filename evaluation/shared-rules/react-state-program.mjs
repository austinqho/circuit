// React 18.3.1 mountState/mountReducer/basicStateReducer. Scheduling is a
// renderer observation, not something these value-calculation rules simulate.
import {p,arg,array,call,same,choose,lit,undef,field} from './programs.mjs';
export function reactStateProgram(api) {
  if(!['useState','useReducer'].includes(api))throw new TypeError('state_api');
  const input=field(arg(1),api==='useState'?0:1);
  const initializer=field(arg(1),api==='useState'?0:2);
  const initialize=choose(api==='useState'?same({op:'type',value:initializer},lit('function')):{op:'not',value:same(initializer,undef)},
    call(initializer,api==='useState'?array():array(input)),input);
  const previous=field(arg(1),0),action=field(arg(1),1),reducer=field(arg(1),2);
  const update=api==='useReducer'?call(reducer,array(previous,action)):
    choose(same({op:'type',value:action},lit('function')),call(action,array(previous)),action);
  return p(choose(same(arg(0),lit('initialize')),initialize,
    choose(same(arg(0),lit('update')),update,
      choose(same(arg(0),lit('compare')),same(previous,action),
        {op:'frontier',reason:'unknown_state_operation'}))));
}
