import test from 'node:test';
import assert from 'node:assert/strict';
import { compileReactSources } from '../analysis/react-compiler.mjs';

const packages = {react:{version:'18.3.1',verified:true,verification_sha256:'react'}};

test('class lifecycle and queued member callbacks retain source identities without claiming a mount', () => {
  const map = compileReactSources({'App.tsx': `
    import React, {PureComponent} from 'react';
    const Context=React.createContext('default');
    export class A extends React.Component {
      static contextType=Context; state={n:0};
      componentDidMount(){this.setState(s=>({n:s.n+1}),()=>mounted(this.state.n));}
      componentDidUpdate(){updated();} componentWillUnmount(){removed();}
      render(){return <button onClick={()=>this.forceUpdate(()=>forced())}>A</button>}
    }
    export class B extends PureComponent { render(){return <i/>} }
  `}, {packages});
  const classes = map.react_semantics.filter(row =>
    ['Component','PureComponent'].includes(row.export) && row.usage_kind !== 'value_read');
  assert.equal(classes.length, 2);
  assert.equal(map.react_semantics.filter(row =>
    row.export === 'Component' && row.usage_kind === 'value_read').length, 1);
  const a = classes.find(row => row.export === 'Component');
  assert.equal(a.disposition, 'modeled');
  assert.ok(a.causal_bindings.inputs['class.contextType']);
  for (const member of ['render','componentDidMount','componentDidUpdate','componentWillUnmount']) {
    assert.ok(a.causal_bindings.callbacks.find(callback => callback.slot === member)?.source_id, member);
  }
  const protocols = map.react_protocols.filter(row => row.semantic_application_id === a.id);
  assert.deepEqual(protocols.map(row => row.member).sort(), ['forceUpdate','setState']);
  assert.ok(protocols.every(row => row.callback_bindings.some(binding => binding.source_id)
    && row.claim === 'source_contract' && row.runtime_observed === false));
});

test('local class lookalikes cannot acquire React class semantics', () => {
  const map = compileReactSources({'App.tsx': `class Component{}; class A extends Component {render(){return null}}`}, {packages});
  assert.equal(map.react_semantics.some(row => row.export === 'Component'), false);
  assert.equal(map.react_protocols.length, 0);
});
