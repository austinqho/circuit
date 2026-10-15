import test from 'node:test';
import assert from 'node:assert/strict';
import { compileReactSources } from '../analysis/react-compiler.mjs';

const packages = {react:{version:'18.3.1', verified:true, verification_sha256:'react-18'}};

test('useReducer keeps one occurrence-specific value and dispatch per component placement', () => {
  const map = compileReactSources({'App.tsx': `
    import {useReducer} from 'react';
    function reducer(state, action) { return state + action; }
    function Counter({name}) {
      const [count, dispatch] = useReducer(reducer, 0);
      return <button onClick={() => dispatch(1)}>{name}:{count}</button>;
    }
    export function App(){return <><Counter name="a"/><Counter name="b"/></>}
  `}, {packages});
  const state = map.states.find(row => row.kind === 'reducer');
  assert.ok(state);
  assert.ok(state.reducer_source_id);
  assert.ok(state.initial_source_id);
  assert.equal(map.react_semantics.find(row => row.export === 'useReducer').disposition, 'modeled');
  const placements = map.placements.filter(row => row.component_id === state.component_id);
  assert.equal(placements.length, 2);
  const writes = map.edges.filter(edge => edge.relation === 'state_write' && edge.to === state.id);
  assert.equal(writes.length, 2);
  assert.equal(new Set(writes.map(edge => edge.state_placement_id)).size, 2);
  assert.ok(writes.every(edge => edge.arguments[0].value === 1));
});
