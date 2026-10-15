import {createReactReferenceOwnerHost} from './library-owned-reference.mjs';

/** Adjacent hooks observe the renderer's lifecycle independently of the setup
 * callback being tested. Install consistently before mount: marker hooks change
 * the hook layout. A marker's execution is a host fact, not a guessed commit.
 */
export function createReactEffectEventHost(React,{phase='passive'}={}) {
  const ownerHost=createReactReferenceOwnerHost(React);
  if(!['passive','layout','insertion'].includes(phase))throw new TypeError('effect_host_phase');
  const marker=phase==='passive'?React.useEffect:phase==='layout'?React.useLayoutEffect:React.useInsertionEffect;
  return Object.freeze({protocol:'react_effect_lifecycle',phase,
    invoke({boundary,producer,args,receiver}) {
      const owner=ownerHost.captureOwner();
      marker(()=>()=>boundary.begin(owner,'disconnect'),[]);
      marker(()=>{boundary.begin(owner,'commit')});
      const value=boundary.register(owner,args,producer,receiver);
      marker(()=>{boundary.flush(owner)});
      marker(()=>()=>boundary.flush(owner),[]);
      return value;
    },
  });
}
