import {validateReactExecutionRule} from './react-execution-rule.mjs';

/** React 18's renderer brackets a second development render with the DevTools
 * setStrictMode notification. Track that bracket, not a guessed call count.
 * Effect cleanup/setup rehearsal uses another renderer path and is not covered
 * by this notification. */
export function createReactStrictReplayObserver(config) {
  let context = null, stacks = new Map();
  const refresh = () => {
    const next = config.context();
    if (next !== context) { context = next; stacks = new Map(); }
  };
  return {
    signal(rendererId, replaying) {
      if (!config.enabled()) return;
      refresh();
      if (typeof replaying !== 'boolean') return;
      const stack = stacks.get(rendererId) || [];
      if (!replaying) {
        if(stack.overflow){stack.overflow--;return;}
        const frame = stack.pop();
        if (frame?.record) config.observe({...frame.record, operation:'finished',
          observation_id:config.id('strict_replay_end'), replay_id:frame.record.observation_id});
        return;
      }
      stacks.set(rendererId,stack);
      if(stack.length>=64){stack.overflow=(stack.overflow||0)+1;return;}
      const frame={fiber:null,record:null};stack.push(frame);
      const renderer = config.renderer(rendererId);
      if (renderer?.rendererPackageName !== 'react-dom' || renderer.bundleType !== 1
          || renderer.version !== '18.3.1' || typeof renderer.getCurrentFiber !== 'function') return;
      const fiber = renderer.getCurrentFiber();
      if (!fiber) return;
      const boundary = config.boundary(fiber), owner = config.identity(fiber);
      if (!boundary || !owner) return;
      const record = {schema:'producttrace.react-strict-replay.v1', kind:'react_strict_replay',
        runtime_observed:true, operation:'started', observation_id:config.id('strict_replay'),
        manifest_key:boundary.entry.key, source_call_id:boundary.entry.source_call_id,
        semantic_id:boundary.entry.semantic_id, origin_observation_id:boundary.origin,
        input_identity:boundary.input_identity, boundary:boundary.identity, owner,
        renderer:{id:rendererId, version:renderer.version, package:renderer.rendererPackageName, bundle_type:renderer.bundleType}};
      frame.fiber=fiber;frame.record=record;config.observe(record);
    },
    current(fiber) {
      if (!config.enabled() || !fiber) return null;
      refresh();
      const matches = [];
      for (const stack of stacks.values()) {
        const frame = stack.at(-1);
        if (!stack.overflow && frame?.record && (frame.fiber === fiber || frame.fiber === fiber.alternate)) matches.push(frame);
      }
      return matches.length === 1 ? matches[0].record.observation_id : null;
    },
  };
}

/** A valid bracket points back to an admitted JSX input and the exact renderer
 * owner. Later lifecycle records must independently match this owner. */
export function checkReactStrictReplay(record, {fingerprint, entry, origin, start}) {
  const fail = reason => ({schema:'producttrace.react-strict-replay-join.v1', status:'unresolved', reason, runtime_observed:false});
  if (!record || record.schema !== 'producttrace.react-strict-replay.v1' || record.kind !== 'react_strict_replay'
      || record.runtime_observed !== true || record.map_fingerprint !== fingerprint
      || typeof record.session !== 'string' || !record.session) return fail('strict_replay_context_required');
  const scoped = value => typeof value === 'string' && value.startsWith(record.session + ':') && value.length > record.session.length + 1;
  if (!scoped(record.observation_id) || record.occurrence_id !== record.observation_id + ':occurrence'
      || !Array.isArray(record.evidence_ids) || !record.evidence_ids.includes(record.observation_id)
      || !record.evidence_ids.every(scoped)) return fail('strict_replay_occurrence_required');
  const rule = entry?.boundary_rule;
  if (!validateReactExecutionRule(rule).valid || rule.kind !== 'boundary_type'
      || record.semantic_id !== 'react/StrictMode/18.3.1' || entry.semantic_id !== record.semantic_id
      || entry.key !== record.manifest_key || entry.source_call_id !== record.source_call_id)
    return fail('strict_replay_rule_required');
  if (!origin || origin.session !== record.session || origin.observation_id !== record.origin_observation_id
      || origin.manifest_key !== record.manifest_key || origin.operation !== 'element_created'
      || origin.boundary_input?.identity !== record.input_identity || origin.boundary_input?.field !== 'props'
      || !scoped(record.input_identity)) return fail('strict_replay_input_required');
  const identity = row => row && ['root_id','instance_id','mount_id'].every(key => typeof row[key] === 'string' && row[key]);
  if (!identity(record.owner) || !identity(record.boundary) || record.owner.root_id !== record.boundary.root_id
      || record.boundary.tag !== rule.renderer.tag || !Number.isSafeInteger(record.boundary.mode)
      || rule.renderer.strict_render_mask === 0 || !(record.boundary.mode & rule.renderer.strict_render_mask)
      || record.renderer?.version !== '18.3.1' || record.renderer.package !== 'react-dom'
      || record.renderer.bundle_type !== 1 || !Number.isSafeInteger(record.renderer.id)) return fail('strict_replay_renderer_required');
  if (!['started','finished'].includes(record.operation)) return fail('strict_replay_operation_required');
  if (record.operation === 'finished' && (!start || start.status !== 'resolved'
      || start.runtime.session !== record.session || start.runtime.operation !== 'started'
      || start.runtime.replay_id !== record.replay_id
      || JSON.stringify(start.runtime.owner) !== JSON.stringify(record.owner)
      || JSON.stringify(start.runtime.boundary) !== JSON.stringify(record.boundary)
      || start.source.source_call_id !== record.source_call_id
      || start.runtime.input_identity !== record.input_identity || start.runtime.origin_observation_id !== record.origin_observation_id
      || JSON.stringify(start.runtime.renderer) !== JSON.stringify(record.renderer))) return fail('strict_replay_start_required');
  return {schema:'producttrace.react-strict-replay-join.v1', status:'resolved', reason:null, runtime_observed:true,
    source:{source_call_id:record.source_call_id, semantic_id:record.semantic_id},
    runtime:{claim:'observed_renderer_development_replay_bracket', session:record.session,
      operation:record.operation, replay_id:record.operation === 'started' ? record.observation_id : record.replay_id,
      owner:{...record.owner}, boundary:{...record.boundary}, renderer:{...record.renderer},
      origin_observation_id:record.origin_observation_id,input_identity:record.input_identity,effect_rehearsal_proven:false}};
}
