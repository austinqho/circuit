import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';
import { REACT_API_INVENTORY } from '../../analysis/react-semantics.mjs';
import { planReactHookLifecycle } from '../../analysis/react-behavior.mjs';

// Real React is the oracle. No mock hook implementation or hand-built Fiber is
// used. These finite probes validate named behaviors, not every possible program.
const repository = path.resolve(process.argv[2] || '/tmp/producttrace-librechat-autonomous');
const require = createRequire(path.join(repository, 'package.json'));
const R = require('react'), D = require('react-dom'), C = require('react-dom/client');
const S = require('react-dom/server'), W = require('react-dom/server.browser');
const {JSDOM} = require('jsdom');
assert.equal(R.version, '18.3.1');
assert.equal(D.version, '18.3.1');
const dom = new JSDOM('<body></body>', {url:'http://localhost/'});
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const e = R.createElement;
const coverage = new Set(), results = [], pathsByApi = new Map();
async function prove(name, exports, fn) {
  await fn();
  for (const api of exports) {
    coverage.add(api);
    const paths = pathsByApi.get(api) || [];
    paths.push(name);
    pathsByApi.set(api, paths);
  }
  results.push(name);
}
async function mounted(fn) {
  const container = document.createElement('div'); document.body.append(container);
  const root = C.createRoot(container);
  let unmounted = false;
  const unmount = async () => { if (!unmounted) { await R.act(async () => root.unmount()); unmounted = true; } };
  try { await fn({root, container, unmount, render: async element => R.act(async () => root.render(element))}); }
  finally { await unmount(); container.remove(); }
}

await prove('element construction does not render; children traversal and key/ref replacement',
  ['react.createElement','react.cloneElement','react.createFactory','react.isValidElement','react.Children','react.Fragment','react.createRef','react.version'], async () => {
    let rendered = 0;
    const Type = () => {rendered++; return null;};
    const ref = R.createRef(); const original = e(Type, {key:'a', ref, data:1});
    const changed = R.cloneElement(original, {key:'b', data:2}, 'new');
    assert.equal(rendered, 0); assert.equal(changed.key, 'b'); assert.equal(changed.ref, ref);
    assert.equal(changed.props.data, 2); assert.equal(changed.props.children, 'new');
    assert.equal(R.isValidElement(original), true); assert.equal(R.isValidElement([original]), false);
    assert.notEqual(ref, R.createRef()); assert.equal(ref.current, null);
    const factory = R.createFactory(Type); assert.equal(factory({data:3}).type, Type); assert.equal(rendered, 0);
    const children = [null, false, 'text', e(R.Fragment, {key:'f'}, e('b')), [e('i', {key:'i'})]];
    assert.equal(R.Children.count(children), 5);
    const seen=[]; R.Children.forEach(children, (child,index)=>seen.push([child,index])); assert.equal(seen.length,5);
    let mapped=0; const values=R.Children.map(children, child=>{mapped++; return child;});
    assert.equal(mapped,5); assert.equal(values.length,3); assert.equal(R.Children.toArray(children).length,3);
    assert.equal(R.Children.only(original),original); assert.throws(()=>R.Children.only([original]));
    await mounted(async ({render,container})=>{await render(e(R.Fragment,null,e('b',null,'x'))); assert.equal(container.innerHTML,'<b>x</b>');});
  });

await prove('hook caches preserve owning mount, captures, dependencies, and queued updates',
  ['react.useState','react.useReducer','react.useCallback','react.useMemo','react.useRef','react.useId','react.useDebugValue'], async () => {
    const instances={}; let initializations=0, calculations=0, formatterCalls=0;
    function Probe({name, value, dep}) {
      const [state,setState]=R.useState(()=>{initializations++; return 0;});
      const [count,dispatch]=R.useReducer((state,action)=>state+action,2,value=>value*2);
      const cb=R.useCallback(()=>value,[dep]); const memo=R.useMemo(()=>{calculations++;return {value};},[dep]);
      const ref=R.useRef(value), id=R.useId(); R.useDebugValue(value,()=>{formatterCalls++;return value;});
      instances[name]={state,setState,count,dispatch,cb,memo,ref,id}; return e('span',null,state);
    }
    await mounted(async ({render,unmount})=>{
      const tree=(value,dep)=>e(R.Fragment,null,e(Probe,{key:'a',name:'a',value,dep}),e(Probe,{key:'b',name:'b',value:'b',dep:0}));
      await render(tree('old',0)); const first={...instances.a}, second={...instances.b};
      assert.notEqual(first.ref,second.ref); assert.notEqual(first.id,second.id);
      await render(tree('new',0)); assert.equal(instances.a.cb,first.cb); assert.equal(instances.a.cb(),'old');
      assert.equal(instances.a.memo,first.memo); assert.equal(instances.a.ref,first.ref); assert.equal(instances.a.ref.current,'old');
      await R.act(async()=>{first.setState(x=>x+1);first.setState(x=>x+1);first.dispatch(3);});
      assert.equal(instances.a.state,2);assert.equal(instances.a.count,7);assert.equal(instances.b.state,0);
      assert.equal(instances.a.setState,first.setState);assert.equal(instances.a.dispatch,first.dispatch);
      await render(tree('last',1));assert.notEqual(instances.a.cb,first.cb);assert.equal(instances.a.cb(),'last');
      assert.equal(initializations,2);assert.equal(calculations,3);assert.equal(formatterCalls,0);
      await unmount();
    });
  });

await prove('effect phase ordering, old cleanup captures, handle replacement and unmount',
  ['react.useEffect','react.useLayoutEffect','react.useInsertionEffect','react.useImperativeHandle','react.forwardRef'], async () => {
    const events=[], ref=R.createRef();
    const Probe=R.forwardRef(function Probe({value},ref) {
      R.useInsertionEffect(()=>{events.push(`insert:${value}`);return()=>events.push(`remove:${value}`);},[value]);
      R.useLayoutEffect(()=>{events.push(`layout:${value}`);return()=>events.push(`unlayout:${value}`);},[value]);
      R.useEffect(()=>{events.push(`effect:${value}`);return()=>events.push(`uneffect:${value}`);},[value]);
      R.useImperativeHandle(ref,()=>({value}),[value]); return e('i');
    });
    await mounted(async ({render,unmount})=>{
      await render(e(Probe,{value:'a',ref})); assert.deepEqual(events,['insert:a','layout:a','effect:a']); const first=ref.current;
      await render(e(Probe,{value:'a',ref}));assert.equal(ref.current,first);assert.equal(events.length,3);
      await render(e(Probe,{value:'b',ref})); assert.equal(ref.current.value,'b');assert.notEqual(ref.current,first);
      for(const [old,next] of [['remove:a','insert:b'],['unlayout:a','layout:b'],['uneffect:a','effect:b']]) assert.ok(events.indexOf(old)<events.indexOf(next));
      await unmount();assert.equal(ref.current,null); for(const name of ['remove:b','unlayout:b','uneffect:b']) assert.ok(events.includes(name));
    });
  });

await prove('StrictMode rehearses layout/passive effects but not insertion effects in React 18', ['react.StrictMode'], async()=>{
  let renderCount=0,insert=0,layout=0,effect=0,cleanup=0;
  function Probe(){renderCount++;R.useInsertionEffect(()=>{insert++;},[]);R.useLayoutEffect(()=>{layout++;},[]);R.useEffect(()=>{effect++;return()=>cleanup++;},[]);return null;}
  await mounted(async({render,unmount})=>{await render(e(R.StrictMode,null,e(Probe)));assert.equal(renderCount,2);assert.equal(insert,1);assert.equal(layout,2);assert.equal(effect,2);assert.equal(cleanup,1);await unmount();assert.equal(cleanup,2);});
});

await prove('context bypasses memo bailout; providers and portals preserve React ownership',
  ['react.createContext','react.useContext','react.memo','react-dom.createPortal'], async()=>{
    const Context=R.createContext('default'), seen=[], host=document.createElement('aside');document.body.append(host);
    let clicks=0, renders=0;
    const Child=R.memo(function Child(){renders++;const value=R.useContext(Context);seen.push(value);return D.createPortal(e('button',null,String(value)),host);});
    await mounted(async({render})=>{
      await render(e('div',{onClick:()=>clicks++},e(Child)));assert.equal(seen.at(-1),'default');
      await render(e(Context.Provider,{value:'provided'},e('div',{onClick:()=>clicks++},e(Child))));assert.equal(seen.at(-1),'provided');
      const before=renders;await render(e(Context.Provider,{value:undefined},e('div',{onClick:()=>clicks++},e(Child))));assert.equal(seen.at(-1),undefined);assert.ok(renders>before);
      await R.act(async()=>host.querySelector('button').click());assert.equal(clicks,1);
      let consumer;await render(e(Context.Provider,{value:'consumer'},e(Context.Consumer,null,value=>{consumer=value;return null;})));assert.equal(consumer,'consumer');
    });host.remove();
  });

await prove('external store resubscribes by subscribe identity and releases ownership on unmount', ['react.useSyncExternalStore'],async()=>{
  let value=1, latest, subscribeCount=0,unsubscribeCount=0;const listeners=new Set();
  const subscribe=fn=>{subscribeCount++;listeners.add(fn);return()=>{unsubscribeCount++;listeners.delete(fn);};};
  function Probe({subscribe}){latest=R.useSyncExternalStore(subscribe,()=>value,()=>1);return e('b',null,latest);}
  await mounted(async({render,unmount})=>{await render(e(Probe,{subscribe}));assert.equal(latest,1);value=2;await R.act(async()=>{for(const fn of listeners)fn();});assert.equal(latest,2);
    await render(e(Probe,{subscribe:fn=>subscribe(fn)}));assert.equal(subscribeCount,2);assert.equal(unsubscribeCount,1);await unmount();assert.equal(unsubscribeCount,2);assert.equal(listeners.size,0);});
});

await prove('transition scopes run immediately; deferred value can retain prior render', ['react.startTransition','react.useTransition','react.useDeferredValue','react.act'],async()=>{
  let set, start, state;const observed=[];
  function Probe(){const [value,update]=R.useState('old');const [pending,transition]=R.useTransition();const deferred=R.useDeferredValue(value);set=update;start=transition;state={value,deferred,pending};observed.push({...state});return e('b',null,deferred);}
  await mounted(async({render})=>{await render(e(Probe));const order=[];
    await R.act(async()=>{start(()=>{order.push('scope');set('next');});order.push('after');});assert.deepEqual(order,['scope','after']);assert.equal(state.value,'next');assert.equal(state.deferred,'next');
    await R.act(async()=>set('urgent'));assert.ok(observed.some(row=>row.value==='urgent'&&row.deferred==='next'));assert.equal(state.deferred,'urgent');
    const direct=[];R.startTransition(()=>direct.push('scope'));direct.push('after');assert.deepEqual(direct,['scope','after']);
  });
});

await prove('lazy loader caches by type; suspension does not commit child effects', ['react.lazy','react.Suspense'],async()=>{
  let resolve,loads=0,effects=0;const promise=new Promise(done=>resolve=done);
  const Lazy=R.lazy(()=>{loads++;return promise;});assert.equal(loads,0);
  function Ready(){R.useEffect(()=>{effects++;},[]);return e('b',null,'ready');}
  await mounted(async({render,container})=>{await render(e(R.Suspense,{fallback:e('i',null,'waiting')},e(Lazy)));assert.equal(loads,1);assert.equal(container.textContent,'waiting');assert.equal(effects,0);
    await R.act(async()=>resolve({default:Ready}));assert.equal(container.textContent,'ready');assert.equal(effects,1);
    await render(e(R.Suspense,{fallback:'waiting'},e(Lazy)));assert.equal(loads,1);
  });
});

await prove('class mount/update snapshot/callback/unmount and PureComponent bailout', ['react.Component','react.PureComponent','react.Profiler','react-dom.findDOMNode'],async()=>{
  const ref=R.createRef(),log=[],profile=[];let pureRenders=0;
  class ClassProbe extends R.Component{state={count:0};componentDidMount(){log.push('mount');}getSnapshotBeforeUpdate(){return 'snapshot';}componentDidUpdate(p,s,snapshot){log.push(snapshot);}componentWillUnmount(){log.push('unmount');}render(){return e('b',null,this.state.count);}}
  class Pure extends R.PureComponent{render(){pureRenders++;return e('i',null,this.props.value);}}
  await mounted(async({render,unmount})=>{const tree=()=>e(R.Profiler,{id:'p',onRender:(id,phase)=>profile.push([id,phase])},e(ClassProbe,{ref}),e(Pure,{value:'same'}));await render(tree());assert.deepEqual(log,['mount']);assert.equal(D.findDOMNode(ref.current).tagName,'B');
    await R.act(async()=>ref.current.setState(s=>({count:s.count+1}),()=>log.push('set-callback')));assert.deepEqual(log,['mount','snapshot','set-callback']);
    await R.act(async()=>ref.current.forceUpdate(()=>log.push('force-callback')));assert.equal(log.at(-1),'force-callback');
    await render(tree());assert.equal(pureRenders,1);assert.ok(profile.some(row=>row[1]==='mount'));assert.ok(profile.some(row=>row[1]==='update'));await unmount();assert.equal(log.at(-1),'unmount');
  });
});

await prove('root flush and unmount are distinct from scheduling; server HTML hydrates before effects',
  ['react-dom/client.createRoot','react-dom/client.hydrateRoot','react-dom.createRoot','react-dom.hydrateRoot','react-dom.flushSync','react-dom.version'],async()=>{
    const container=document.createElement('div');document.body.append(container);const root=D.createRoot(container);
    await R.act(async()=>D.flushSync(()=>root.render(e('b',null,'flush'))));assert.equal(container.textContent,'flush');await R.act(async()=>root.unmount());assert.throws(()=>root.render(e('b')));container.remove();
    let effects=0;function App(){R.useEffect(()=>{effects++;},[]);return e('button',null,'hydrate');}
    for(const hydrate of [C.hydrateRoot,D.hydrateRoot]){const host=document.createElement('div');host.innerHTML=S.renderToString(e(App));document.body.append(host);const prior=host.firstChild;const before=effects;assert.equal(effects,before);let hydrated;await R.act(async()=>{hydrated=hydrate(host,e(App));});assert.equal(host.firstChild,prior);assert.equal(effects,before+1);await R.act(async()=>hydrated.unmount());host.remove();}
  });

await prove('legacy render/hydrate callbacks and unmount return values', ['react-dom.render','react-dom.hydrate','react-dom.unmountComponentAtNode'],async()=>{
  for(const hydrate of [false,true]){const host=document.createElement('div');document.body.append(host);if(hydrate)host.innerHTML='<b>legacy</b>';let called=0;
    await R.act(async()=>{(hydrate?D.hydrate:D.render)(e('b',null,'legacy'),host,()=>called++);});assert.equal(called,1);assert.equal(host.textContent,'legacy');
    let removed;await R.act(async()=>{removed=D.unmountComponentAtNode(host);});assert.equal(removed,true);assert.equal(D.unmountComponentAtNode(host),false);host.remove();}
});

await prove('server string/static/legacy/pipeable/Web streams do not run client effects',
  REACT_API_INVENTORY.filter(row=>row.surface==='react-dom/server').map(row=>`${row.surface}.${row.export}`), async()=>{
    let effects=0;function App(){R.useEffect(()=>{effects++;},[]);return e('b',null,'server');}
    assert.equal(S.renderToString(e(App)),'<b>server</b>');assert.equal(S.renderToStaticMarkup(e(App)),'<b>server</b>');
    for(const render of [S.renderToNodeStream,S.renderToStaticNodeStream]){let text='';for await(const chunk of render(e(App)))text+=chunk;assert.equal(text,'<b>server</b>');}
    const callbacks=[];let pipeable;
    const text=await new Promise((resolve,reject)=>{const stream=new PassThrough();let body='';stream.on('data',chunk=>body+=chunk);stream.on('end',()=>resolve(body));stream.on('error',reject);
      pipeable=S.renderToPipeableStream(e(App),{onShellReady(){callbacks.push('shell');pipeable.pipe(stream);},onAllReady(){callbacks.push('all');},onShellError:reject,onError:reject});});
    assert.equal(text,'<b>server</b>');assert.deepEqual(callbacks,['shell','all']);
    const stream=await W.renderToReadableStream(e(App));await stream.allReady;assert.equal(await new Response(stream).text(),'<b>server</b>');assert.equal(effects,0);assert.equal(S.version,'18.3.1');
  });

for (const api of ['useEffect','useLayoutEffect','useInsertionEffect']) await prove(`executable ${api} plans match real dependency comparisons and cleanup provenance`, [`react.${api}`], async()=>{
  const log=[];let previous=null;const object={};
  function Probe({value,id}){R[api](()=>{log.push(['setup',id]);return()=>log.push(['cleanup',id]);},[value]);return null;}
  await mounted(async({render,unmount})=>{
    for(const [index,value] of [NaN,NaN,0,-0,object,object,{}].entries()){
      const next={rootId:'r',instanceId:'i',mountId:'m',slotId:'effect',renderId:String(index),callbackId:String(index),committed:true,dependencies:[{known:true,value}]};
      const predicted=planReactHookLifecycle({api,version:'18.3.1',event:'commit',previous,next});
      const before=log.length;await render(e(Probe,{value,id:String(index)}));
      assert.deepEqual(log.slice(before),predicted.operations.map(operation=>[operation.kind,operation.callbackId]));
      if(predicted.operations.some(operation=>operation.kind==='setup'))previous={...next,cleanupId:String(index)};
    }
    const predicted=planReactHookLifecycle({api,version:'18.3.1',event:'unmount',previous});const before=log.length;
    await unmount();assert.deepEqual(log.slice(before),predicted.operations.map(operation=>[operation.kind,operation.callbackId]));
  });
});

await prove('Suspense hides layout effects, restores them, and abandons uncommitted effects',
  ['react.Suspense','react.useLayoutEffect','react.useEffect'],async()=>{
  const log=[];let suspended=false,resolve;const pending=new Promise(done=>resolve=done);
  function Child(){if(suspended)throw pending;R.useLayoutEffect(()=>{log.push('layout');return()=>log.push('cleanup');},[]);return e('b',null,'content');}
  await mounted(async({render,container})=>{const tree=()=>e(R.Suspense,{fallback:e('i',null,'fallback')},e(Child));await render(tree());assert.deepEqual(log,['layout']);
    suspended=true;await render(tree());assert.ok(container.querySelector('i'));assert.deepEqual(log,['layout','cleanup']);
    suspended=false;await R.act(async()=>resolve());assert.equal(container.querySelector('i'),null);assert.deepEqual(log,['layout','cleanup','layout']);
  });
  let finish,ready=false,effects=0;const later=new Promise(done=>finish=done);
  function NeverCommitted(){if(!ready)throw later;R.useEffect(()=>{effects++;},[]);return null;}
  await mounted(async({render,unmount})=>{await render(e(R.Suspense,{fallback:'pending'},e(NeverCommitted)));await unmount();ready=true;await R.act(async()=>finish());assert.equal(effects,0);});
});

await prove('a transition can retain revealed content while its replacement suspends',
  ['react.startTransition','react.Suspense'],async()=>{
  let choose,ready=false,resolve;const pending=new Promise(done=>resolve=done);
  function Page({name}){if(name==='new'&&!ready)throw pending;return e('b',null,name);}
  function App(){const[name,set]=R.useState('old');choose=set;return e(R.Suspense,{fallback:'waiting'},e(Page,{name}));}
  await mounted(async({render,container})=>{await render(e(App));await R.act(async()=>R.startTransition(()=>choose('new')));assert.equal(container.textContent,'old');ready=true;await R.act(async()=>resolve());assert.equal(container.textContent,'new');});
});

await prove('an urgent update can supersede an interrupted transition without committing its effects',
  ['react.startTransition','react.useState','react.useEffect','react.Suspense'],async()=>{
  let choose,ready=false,resolve;const pending=new Promise(done=>resolve=done),renders=[],effects=[];
  function App(){const[value,set]=R.useState('old');choose=set;renders.push(value);if(value==='slow'&&!ready)throw pending;
    R.useEffect(()=>{effects.push(`setup:${value}`);return()=>effects.push(`cleanup:${value}`);},[value]);return e('b',null,value);}
  await mounted(async({render,container})=>{await render(e(R.Suspense,{fallback:'waiting'},e(App)));assert.deepEqual(effects,['setup:old']);
    await R.act(async()=>R.startTransition(()=>choose('slow')));assert.ok(renders.includes('slow'));assert.equal(container.textContent,'old');assert.equal(effects.includes('setup:slow'),false);
    await R.act(async()=>choose('urgent'));assert.equal(container.textContent,'urgent');assert.deepEqual(effects,['setup:old','cleanup:old','setup:urgent']);
    ready=true;await R.act(async()=>resolve());assert.equal(container.textContent,'urgent');assert.equal(effects.includes('setup:slow'),false);
  });
});

await prove('hydration mismatch reports recovery; class error boundaries receive descendant errors',
  ['react-dom/client.hydrateRoot','react.Component'],async()=>{
  const host=document.createElement('div');host.innerHTML='<b>server</b>';document.body.append(host);const errors=[];let root;
  await R.act(async()=>{root=C.hydrateRoot(host,e('b',null,'client'),{onRecoverableError:error=>errors.push(error)});});
  assert.equal(host.textContent,'client');assert.ok(errors.length);await R.act(async()=>root.unmount());host.remove();
  const log=[];
  class Boundary extends R.Component{state={failed:false};static getDerivedStateFromError(){return{failed:true};}componentDidCatch(error){log.push(error.message);}render(){return this.state.failed?e('i',null,'recovered'):this.props.children;}}
  function Broken(){throw new Error('expected-boundary-probe');}
  await mounted(async({render,container})=>{await render(e(Boundary,null,e(Broken)));assert.equal(container.textContent,'recovered');assert.deepEqual(log,['expected-boundary-probe']);});
});

await prove('stream abort leaves pending boundary recovery instead of claiming completion',
  ['react-dom/server.renderToPipeableStream','react.Suspense'],async()=>{
  const pending=new Promise(()=>{});function Blocked(){throw pending;}const errors=[];let handle;
  const body=await new Promise((resolve,reject)=>{const destination=new PassThrough();let body='';destination.on('data',chunk=>body+=chunk);destination.on('end',()=>resolve(body));destination.on('error',reject);
    handle=S.renderToPipeableStream(e(R.Suspense,{fallback:e('i',null,'pending')},e(Blocked)),{onShellReady(){handle.pipe(destination);handle.abort();},onShellError:reject,onError:error=>errors.push(error)});
  });
  assert.ok(body.includes('pending'));assert.ok(errors.length);assert.ok(body.includes('$RX'),'aborted boundary is marked for client recovery');
});

await prove('public unstable aliases and legacy batching/subtree callbacks',
  ['react.unstable_act','react-dom.unstable_batchedUpdates','react-dom.unstable_renderSubtreeIntoContainer'],async()=>{
    assert.equal(R.unstable_act,R.act);let acted=false;await R.unstable_act(async()=>{acted=true;});assert.equal(acted,true);
    const calls=[];const value=D.unstable_batchedUpdates(argument=>{calls.push(argument);return argument+1;},4);assert.deepEqual(calls,[4]);assert.equal(value,5);
    const parentHost=document.createElement('div'),childHost=document.createElement('div');document.body.append(parentHost,childHost);
    class Parent extends R.Component{render(){return e('b');}}let parent,completed=0;
    await R.act(async()=>{parent=D.render(e(Parent),parentHost);});
    await R.act(async()=>D.unstable_renderSubtreeIntoContainer(parent,e('i',null,'subtree'),childHost,()=>completed++));
    assert.equal(childHost.textContent,'subtree');assert.equal(completed,1);
    await R.act(async()=>{D.unmountComponentAtNode(childHost);D.unmountComponentAtNode(parentHost);});parentHost.remove();childHost.remove();
  });

const missing=REACT_API_INVENTORY.map(row=>`${row.surface}.${row.export}`).filter(key=>!coverage.has(key));
assert.deepEqual(missing,[],'Every inventory export needs at least one actual React probe');
dom.window.close();
console.log(JSON.stringify({version:R.version, export_smoke_coverage:coverage.size, behavior_groups:results,
  api_paths:Object.fromEntries([...pathsByApi].sort(([left],[right])=>left.localeCompare(right))),
  limitations:['Finite public-API probes, not exhaustive semantic verification.', 'DevTools formatter invocation and exhaustive lifecycle permutations remain untested.', 'Source contracts do not themselves supply runtime instance/capture evidence.']},null,2));
