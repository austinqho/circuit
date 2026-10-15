import test from 'node:test';
import assert from 'node:assert/strict';
import { compileReactSources } from '../analysis/react-compiler.mjs';

const packages = {react:{version:'18.3.1', verified:true, verification_sha256:'react-18'}};
const targetCalls = (map, name) => map.edges.filter(edge => edge.relation === 'call'
  && map.nodes.find(node => node.id === edge.to)?.text.includes(`function ${name}`));

test('an exact Provider supplies its value to useContext without replacing explicit undefined by the default', () => {
  const map = compileReactSources({'App.tsx': `
    import {createContext, useContext} from 'react';
    const Mode = createContext('default');
    function consume(value) {}
    function Child(){const mode=useContext(Mode);return <button onClick={()=>consume(mode)}>Use</button>}
    export function App(){return <Mode.Provider value="provided"><div><Child/></div></Mode.Provider>}
  `}, {packages});
  const call = targetCalls(map, 'consume')[0];
  assert.equal(call.arguments[0].kind, 'literal');
  assert.equal(call.arguments[0].value, 'provided');
  assert.match(call.arguments[0].react_context_id, /^react-context:/u);
  assert.equal(map.react_values.filter(value => value.kind === 'context').length, 1);
  assert.ok(map.react_semantics.some(row => row.export === 'createContext' && row.disposition === 'modeled'));
  assert.ok(map.react_semantics.some(row => row.export === 'useContext' && row.disposition === 'modeled'));

  const explicitUndefined = compileReactSources({'App.tsx': `
    import {createContext,useContext} from 'react'; const C=createContext('default');
    function take(x){} function Child(){const x=useContext(C);return <button onClick={()=>take(x)}>x</button>}
    export function App(){return <C.Provider value={undefined}><Child/></C.Provider>}`}, {packages});
  assert.notEqual(targetCalls(explicitUndefined, 'take')[0].arguments[0].value, 'default');
});

test('a later unknown Provider spread invalidates an earlier value while a later explicit value restores certainty', () => {
  const uncertain = compileReactSources({'App.tsx': `
    import {createContext,useContext} from 'react'; const C=createContext('default');
    declare const unknownProps: object; function take(x){}
    function Child(){const x=useContext(C);return <button onClick={()=>take(x)}>x</button>}
    export function App(){return <C.Provider value="unsafe" {...unknownProps}><Child/></C.Provider>}`}, {packages});
  assert.equal(targetCalls(uncertain, 'take').some(call => call.arguments[0]?.value === 'unsafe'), false);
  assert.ok(uncertain.diagnostics.some(row => row.code === 'context_provider_value_unresolved'));

  const restored = compileReactSources({'App.tsx': `
    import {createContext,useContext} from 'react'; const C=createContext('default');
    declare const unknownProps: object; function take(x){}
    function Child(){const x=useContext(C);return <button onClick={()=>take(x)}>x</button>}
    export function App(){return <C.Provider {...unknownProps} value="safe"><Child/></C.Provider>}`}, {packages});
  assert.ok(targetCalls(restored, 'take').some(call => call.arguments[0]?.value === 'safe'));
});

test('useRef and createRef expose a live cell identity rather than freezing current as an initial capture', () => {
  const map = compileReactSources({'App.tsx': `
    import {createRef,useRef} from 'react'; const outside=createRef();
    function send(a,b){}
    export function App(){const inside=useRef('initial');return <button onClick={()=>send(inside.current,outside.current)}>Read</button>}
  `}, {packages});
  const call = targetCalls(map, 'send')[0];
  assert.deepEqual(call.arguments.map(value => value.kind), ['react_ref_current', 'react_ref_current']);
  assert.equal(new Set(call.arguments.map(value => value.ref_id)).size, 2);
  assert.equal(map.react_values.filter(value => /ref$/u.test(value.kind)).length, 2);
  assert.ok(map.react_semantics.filter(row => ['useRef','createRef'].includes(row.export))
    .every(row => row.disposition === 'modeled'));
});

test('different context objects never borrow a Provider value and exact Consumer callbacks receive their value', () => {
  const map = compileReactSources({'App.tsx': `
    import {createContext,useContext} from 'react'; const A=createContext('a');const B=createContext('b');
    function use(x){} function Child(){const value=useContext(B);return <button onClick={()=>use(value)}>B</button>}
    export function App(){return <A.Provider value="wrong"><Child/></A.Provider>}
    export function Legacy(){return <A.Consumer>{value=><button onClick={()=>use(value)}>A</button>}</A.Consumer>}
  `}, {packages});
  assert.equal(targetCalls(map, 'use')[0].arguments[0].value, 'b');
  assert.ok(targetCalls(map, 'use').some(call => call.arguments[0]?.value === 'a'
    && call.arguments[0]?.react_context_id));
  assert.ok(map.react_protocols.some(row => row.member === 'Consumer'
    && row.callback_bindings[0]?.source_id));
});

test('ambiguous Consumer callback choices retain a runtime-selection protocol without selecting a branch', () => {
  const map = compileReactSources({'App.tsx': `
    import {createContext} from 'react'; const C=createContext('default');
    declare const choose:boolean; const a=value=><button>A</button>; const b=value=><button>B</button>;
    export function App(){return <C.Consumer>{choose?a:b}</C.Consumer>}`}, {packages});
  assert.ok(map.diagnostics.some(row => row.code === 'context_consumer_render_callback_unresolved'));
  const protocol = map.react_protocols.find(row => row.member === 'Consumer');
  assert.equal(protocol.callback_bindings[0].resolution, 'runtime_selected_value');
  assert.equal(map.controls.length, 0);
});

test('an inline Consumer callback keeps the exact enclosing component captures', () => {
  const map = compileReactSources({'App.tsx': `
    import {createContext} from 'react'; const C=createContext('default'); function take(a,b){}
    function Inner({prefix}){return <C.Provider value="context"><C.Consumer>{value =>
      <button onClick={()=>take(prefix,value)}>Use</button>}</C.Consumer></C.Provider>}
    export function App(){return <Inner prefix="outer"/>}`}, {packages});
  assert.ok(targetCalls(map, 'take').some(call => call.arguments[0]?.value === 'outer'
    && call.arguments[1]?.value === 'context'));
});

test('object context defaults retain the analyzer value shape when destructured', () => {
  const map=compileReactSources({'App.tsx':`import {createContext,useContext} from 'react';
    const C=createContext({run(){},label:'default'});
    export function App(){const {run}=useContext(C);return <button onClick={run}>Run</button>}`},{packages});
  assert.equal(map.controls.length,1);
  assert.equal(map.controls[0].status,'resolved');
});
