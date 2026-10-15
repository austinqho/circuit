import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { analyzeReact } from '../analysis/index.mjs';

const fixtureRoot = fileURLToPath(new URL('./fixtures/react-analysis/', import.meta.url));

async function fixture(name) {
  const root = join(fixtureRoot, name);
  const files = {};
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else files[relative(root, path).replaceAll('\\', '/')] = await readFile(path, 'utf8');
    }
  }
  await visit(root);
  return files;
}

async function compile(name) {
  return await analyzeReact({ files: await fixture(name) });
}

function node(map, id) {
  const found = map.nodes.find(entry => entry.id === id);
  assert.ok(found, `source node ${id} must exist`);
  return found;
}

function controlsWithText(map, text) {
  return map.controls.filter(control => node(map, control.source_node_id).text.includes(text));
}

function one(values, message) {
  assert.equal(values.length, 1, message);
  return values[0];
}

function declaredFunction(map, name) {
  return map.nodes.filter(entry => new RegExp(`(?:function\\s+${name}\\s*\\(|(?:const|let)\\s+${name}\\s*=)`).test(entry.text));
}

function scenarioEdges(map, scenario) {
  return map.edges.filter(edge => edge.scenario_id === scenario.id);
}

function entityIds(map) {
  return new Set(['nodes', 'components', 'placements', 'controls', 'scenarios', 'states']
    .flatMap(key => map[key].map(value => value.id)));
}

test('public React analysis resolves local and imported handlers without claiming runtime effects', async () => {
  const map = await compile('direct');
  assert.equal(map.schema, 'producttrace.react-map.v1');
  assert.equal(map.claims.source_indexed, true);
  assert.equal(map.claims.runtime_observed, false);
  assert.equal(map.claims.source_complete, false);
  const save = one(controlsWithText(map, 'Save item'), 'one source Save item control');
  const dismiss = one(controlsWithText(map, 'Dismiss'), 'one source Dismiss control');
  assert.equal(save.status, 'resolved');
  assert.equal(dismiss.status, 'resolved');
  assert.ok(save.handler_ids.some(id => node(map, id).file === 'actions.js'),
    'the imported handler must resolve to its declaration in another source file');
  assert.ok(dismiss.handler_ids.some(id => node(map, id).text.includes('dismiss')));
  assert.equal(save.handler_ids.some(id => dismiss.handler_ids.includes(id)), false,
    'unrelated controls must not borrow one another\'s handlers');
  for (const control of [save, dismiss]) {
    assert.ok(map.edges.some(edge => edge.from === control.id && edge.relation === 'event_handler'
      && control.handler_ids.includes(edge.to)), 'the binding needs an explicit event-handler edge');
  }
  const ids = entityIds(map);
  for (const edge of map.edges) {
    assert.ok(ids.has(edge.from), `edge source ${edge.from} resolves`);
    assert.ok(ids.has(edge.to), `edge target ${edge.to} resolves`);
    assert.ok(edge.evidence_ids.length > 0, `${edge.relation} retains source evidence`);
  }
});

test('repeated child placements retain distinct callbacks and captured entity IDs', async () => {
  const map = await compile('placements');
  const child = one(map.components.filter(component => component.name === 'ItemButton'), 'one ItemButton definition');
  const placements = map.placements.filter(placement => placement.component_id === child.id && placement.parent_id);
  assert.equal(placements.length, 2, 'the two JSX placements must stay distinct');
  const [first, second] = ['item-a', 'item-b'].map(value => one(placements.filter(placement =>
    placement.props.itemId?.value === value), `one placement captures ${value}`));
  assert.notEqual(first.id, second.id);
  const targetIds = Object.fromEntries(['saveItem', 'removeItem'].map(name =>
    [name, new Set(declaredFunction(map, name).map(entry => entry.id))]));
  for (const [placement, expected, forbidden, entity, otherEntity] of [
    [first, 'saveItem', 'removeItem', 'item-a', 'item-b'],
    [second, 'removeItem', 'saveItem', 'item-b', 'item-a'],
  ]) {
    const control = one(map.controls.filter(value => value.placement_id === placement.id), 'one child button per placement');
    const scenario = one(map.scenarios.filter(value => value.control_id === control.id), 'one placement-specific scenario');
    const edges = scenarioEdges(map, scenario);
    assert.ok(edges.some(edge => ['call', 'callback_forward'].includes(edge.relation)
      && targetIds[expected].has(edge.to)), `${entity} resolves ${expected}`);
    assert.equal(edges.some(edge => targetIds[forbidden].has(edge.to)), false,
      `${entity} must not include the other placement's callback`);
    const argumentsText = JSON.stringify({ captured: scenario.captured_arguments,
      calls: edges.flatMap(edge => edge.arguments || []) });
    assert.ok(argumentsText.includes(entity), `the source-bound ${entity} argument is retained`);
    assert.equal(argumentsText.includes(otherEntity), false, 'captured IDs must not leak between placements');
  }
});

test('aliased imported useState connects only the exact component state and its revealed surface', async () => {
  const map = await compile('state');
  assert.equal(map.states.length, 2, 'each genuine imported useState declaration produces one state identity');
  const states = {};
  for (const componentName of ['Editor', 'Inspector']) {
    const component = one(map.components.filter(value => value.name === componentName), `one ${componentName}`);
    states[componentName] = one(map.states.filter(value => value.component_id === component.id), `one ${componentName} state`);
    assert.equal(states[componentName].value_name, 'open');
    assert.equal(states[componentName].setter_name, 'setOpen');
  }
  assert.notEqual(states.Editor.id, states.Inspector.id, 'same variable names do not imply same state');
  for (const [componentName, title, expectedSurface, forbiddenSurface] of [
    ['Editor', 'Open editor', '<form>', '<output>'],
    ['Inspector', 'Open inspector', '<output>', '<form>'],
  ]) {
    const state = states[componentName];
    const control = one(controlsWithText(map, title), `one ${title} control`);
    const scenario = one(map.scenarios.filter(value => value.control_id === control.id), `one ${title} scenario`);
    const writes = scenarioEdges(map, scenario).filter(edge => edge.relation === 'state_write');
    assert.ok(writes.some(edge => edge.to === state.id), 'setter invocation writes its own exact state');
    assert.equal(writes.some(edge => edge.to !== state.id), false, 'no writes to the other component state');
    assert.ok(map.edges.some(edge => edge.relation === 'state_read' && edge.from === state.id), 'readers are explicit');
    assert.ok(map.edges.some(edge => edge.relation === 'conditional_render' && edge.from === state.id), 'render guard is explicit');
    const revealEdges = map.edges.filter(edge => edge.relation === 'possible_reveal' && edge.from === state.id);
    assert.ok(revealEdges.every(edge => edge.conditions.length > 0), 'possible reveals retain their source branch conditions');
    const revealed = revealEdges.map(edge => map.nodes.find(value => value.id === edge.to)?.text || '');
    assert.ok(revealed.some(text => text.includes(expectedSurface)), 'the guarded surface is a possible reveal');
    assert.equal(revealed.some(text => text.includes(forbiddenSurface)), false, 'other component surfaces must not be joined');
  }
});

test('dynamic callbacks and JSX spreads stay explicit, and a local useState lookalike is not React state', async () => {
  const map = await compile('unsupported');
  assert.equal(map.states.length, 0, 'an app-local function named useState is not the React hook');
  const dynamic = one(controlsWithText(map, 'Dynamic action'), 'dynamic event binding is still indexed');
  assert.equal(dynamic.status, 'unresolved');
  assert.deepEqual(dynamic.handler_ids, [], 'an unresolved dynamic member must not acquire an invented handler');
  assert.ok(map.diagnostics.some(entry => entry.code === 'dynamic_callback'));
  assert.ok(map.diagnostics.some(entry => entry.code === 'unsupported_spread'), 'potential handlers in unknown spreads are accounted for');
  const overridden = one(controlsWithText(map, 'Overridden action'), 'known binding before unknown spread stays indexed');
  assert.equal(overridden.status, 'unresolved', 'a later unknown spread can override the explicit event handler');
  assert.equal(map.edges.some(edge => edge.relation === 'state_write' || edge.relation === 'possible_reveal'), false,
    'a hook name alone must never justify React effect edges');
});

test('recursive components and calls terminate with an explicit frontier', { timeout: 5000 }, async () => {
  const map = await compile('cycles');
  assert.ok(map.controls.length > 0, 'reachable source controls remain accounted for');
  assert.ok(map.diagnostics.some(entry => ['recursive_component', 'analysis_limit'].includes(entry.code)),
    'cycle or bounded frontier must be visible');
  assert.ok(map.placements.length < 100, 'a two-component cycle must not expand indefinitely');
  assert.equal(map.claims.source_complete, false);
});

test('source ordering and an independently loaded identical snapshot do not change IDs or graph meaning', async () => {
  const files = await fixture('placements');
  const first = await analyzeReact({ files });
  const reverse = await analyzeReact({ files: Object.fromEntries(Object.entries(files).reverse()) });
  const independent = await analyzeReact({ files: await fixture('placements') });
  const canonical = map => ({ fingerprint: map.fingerprint,
    entities: ['nodes', 'components', 'placements', 'controls', 'scenarios', 'states'].map(key =>
      [key, map[key].map(value => value.id).sort()]),
    edges: map.edges.map(value => value.id).sort() });
  assert.deepEqual(canonical(first), canonical(reverse));
  assert.deepEqual(canonical(first), canonical(independent));
  assert.equal(JSON.stringify(first).includes(fixtureRoot), false, 'physical fixture path cannot enter source identity');
});

test('syntax errors are reported and do not turn into a successful source-index claim', async () => {
  const map = await compile('invalid');
  assert.ok(map.diagnostics.some(entry => entry.code === 'syntax_error'));
  assert.equal(map.claims.source_indexed, false);
  assert.equal(map.claims.source_complete, false);
  assert.equal(map.claims.runtime_observed, false);
});

test('default and namespace React imports preserve state placement identity in repeated components', async () => {
  const map = await compile('state-placements');
  assert.equal(map.states.length, 2, 'both import forms resolve to genuine React state definitions');
  const component = one(map.components.filter(value => value.name === 'Panel'), 'one Panel definition');
  const state = one(map.states.filter(value => value.component_id === component.id), 'one source state binding');
  const placements = map.placements.filter(value => value.component_id === component.id);
  assert.equal(placements.length, 2, 'two source placements instantiate that state binding separately');
  for (const placement of placements) {
    const control = one(map.controls.filter(value => value.placement_id === placement.id), 'one Show panel control per placement');
    const scenario = one(map.scenarios.filter(value => value.control_id === control.id), 'one scenario per placement');
    const writes = scenarioEdges(map, scenario).filter(edge => edge.relation === 'state_write');
    assert.ok(writes.length > 0);
    assert.ok(writes.every(edge => edge.to === state.id && edge.state_placement_id === placement.id),
      'a source state binding must be disambiguated by the exact component placement');
    assert.ok(map.edges.some(edge => edge.relation === 'possible_reveal' && edge.from === state.id
      && edge.state_placement_id === placement.id && edge.placement_id === placement.id));
  }
});

test('lexical shadowing stays isolated while reassigned local handlers require runtime identity', async () => {
  const map = await compile('shadowing');
  assert.equal(map.states.length, 0, 'the parameter shadows the React import');
  const control = one(controlsWithText(map, 'Reassigned handler'), 'the reassigned handler is indexed');
  const handlerText = control.handler_ids.map(id => node(map, id).text).join('\n');
  assert.equal(/function\s+original\s*\(/.test(handlerText), true);
  assert.equal(/function\s+replacement\s*\(/.test(handlerText), true);
  assert.equal(control.status,'resolved');
  assert.equal(control.callback_selection,'runtime_required',
    'source indexing may retain both local definitions but cannot statically choose which function object handled the event');
});

test('early returns preserve falsy fallthrough guards on controls and downstream calls', async () => {
  const map = await compile('review-regressions');
  const control = one(controlsWithText(map, 'Guarded action'), 'one guarded action');
  assert.ok(control.conditions.some(condition => condition.text === 'blocked' && condition.branch === 'falsy'),
    'the returned button requires the early-exit condition to be false');
  const scenario = one(map.scenarios.filter(value => value.control_id === control.id), 'one guarded scenario');
  const calls = scenarioEdges(map, scenario).filter(edge => edge.relation === 'call'
    && /^function\s+perform\s*\(/.test(node(map, edge.to).text));
  assert.ok(calls.length > 0, 'the downstream direct call remains represented');
  assert.ok(calls.every(edge => edge.conditions.some(condition => condition.text === 'skip' && condition.branch === 'falsy')),
    'the call cannot lose the handler\'s early-return branch');
});

test('custom children and unused JSX are not promoted to rendered controls', async () => {
  const map = await compile('review-regressions');
  assert.deepEqual(controlsWithText(map, 'Hidden child'), [], 'NullView does not render its children');
  assert.ok(map.diagnostics.some(entry => entry.code === 'unsupported_children'),
    'unsupported custom children forwarding remains visible');
  assert.deepEqual(controlsWithText(map, 'Unused element'), [],
    'creating a JSX value does not prove that the component returns or renders it');
});

test('relative imports cannot underflow the supplied repository and borrow a root file', async () => {
  const map = await compile('review-regressions');
  const control = one(controlsWithText(map, 'Outside import'), 'one outside-import control');
  assert.equal(control.status, 'unresolved');
  assert.deepEqual(control.handler_ids, []);
  assert.ok(map.diagnostics.some(entry => entry.code === 'unresolved_import'
    && node(map, entry.node_id).text.includes('../actions.js')));
});

test('unsupported loops expose a source frontier instead of an unconditional body call', async () => {
  const map = await compile('review-regressions');
  const control = one(controlsWithText(map, 'Loop action'), 'one loop action');
  const scenario = one(map.scenarios.filter(value => value.control_id === control.id), 'one loop scenario');
  assert.ok(map.diagnostics.some(entry => entry.code === 'unsupported_control_flow'
    && node(map, entry.node_id).text.includes('while (pending)')));
  assert.equal(scenarioEdges(map, scenario).some(edge => ['call', 'callback_forward'].includes(edge.relation)
    && /^function\s+loopWork\s*\(/.test(node(map, edge.to).text)), false,
    'an unresolved loop body must not be presented as a verified unconditional call');
  assert.equal(map.claims.source_complete, false);
});

test('ambiguous barrels and conditional children forwarding abstain from callback attribution', () => {
  const map = analyzeReact({ files: {
    'App.jsx': `import { Button } from './barrel.js';
      function hidden() {}
      function Conditional({ children, show }) { if (show) return <div>{children}</div>; return null; }
      function EarlyExit({ children, show }) { if (!show) return null; return <div>{children}</div>; }
      export function App() { return <><Button onClick={hidden}>Ambiguous</Button><Conditional show={false}><button onClick={hidden}>Hidden conditional child</button></Conditional><EarlyExit show={false}><button onClick={hidden}>Hidden fallthrough child</button></EarlyExit></>; }`,
    'barrel.js': "export * from './a.jsx'; export * from './b.jsx';",
    'a.jsx': 'export function Button(props) { return <button {...props} />; }',
    'b.jsx': 'export function Button(props) { return <button {...props} />; }',
  } });
  assert.deepEqual(controlsWithText(map, 'Hidden conditional child'), []);
  assert.deepEqual(controlsWithText(map, 'Hidden fallthrough child'), []);
  const ambiguous = map.diagnostics.filter(entry => entry.code === 'unresolved_component'
    && node(map, entry.node_id).text.includes('Button'));
  assert.ok(ambiguous.length > 0, 'duplicate star exports must not resolve whichever declaration was visited first');
  const buttonIds = new Set(map.components.filter(component => component.name === 'Button').map(component => component.id));
  assert.equal(map.placements.some(placement => placement.parent_id && buttonIds.has(placement.component_id)), false);
});
