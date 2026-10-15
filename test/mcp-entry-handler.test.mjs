// The frontend credit abstention (D-G1-13) reaches the MCP surface as
// `stopped_at: "entry_handler"`, never as the backend `handler` stop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFrontier } from '../analysis/causal-chain.mjs';
import { renderChainLine } from '../mcp/tools.mjs';

const because = 'no element-bound handler observed in instrumented code (uninstrumented and third-party handlers are not seen); global listeners: [function:abc:1:2]';
const record = { action_id: 'action:x:1', chain: [{ kind: 'dom.action', action_id: 'action:x:1' }], handler_abstention: { stopped_at: 'entry_handler', because } };

test('chainFrontier renders the abstention as stopped_at entry_handler', () => {
  for (const backendInstrumented of [true, false]) {
    const frontier = chainFrontier(record, { backendInstrumented });
    assert.equal(frontier.stopped_at, 'entry_handler');
    assert.equal(frontier.stop_reason, 'no_element_bound_handler');
    assert.equal(frontier.because, because);
  }
});

test('the MCP chain line says "stopped at entry_handler", not "stopped at handler"', () => {
  const frontier = chainFrontier(record, { backendInstrumented: false });
  const line = renderChainLine({ stops: [{ stop: 'dispatch', action_id: 'action:x:1', event: 'keydown' }], outcome: { writes: [] }, frontier });
  assert.match(line, /stopped at entry_handler \/ because no element-bound handler observed in instrumented code \(uninstrumented and third-party handlers are not seen\); global listeners: \[function:abc:1:2\]$/u);
  assert.doesNotMatch(line, /stopped at handler\b/u);
});
