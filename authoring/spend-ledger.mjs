import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Shared by foreground work and scheduled wakeups. Reservations survive crashes;
// no caller may silently reset a ledger or reclaim an unknown charge.
export class SpendLedger {
  constructor(file) { this.file = path.resolve(file); }
  transact(change) {
    const lock = this.file + '.lock';
    fs.mkdirSync(lock);
    try {
      const state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Number.isFinite(state.cap_usd) || state.cap_usd <= 0 || state.cap_usd > 20 || !Array.isArray(state.entries) || state.entries.some(e => !Number.isFinite(e.actual_usd ?? e.reserved_usd) || (e.actual_usd ?? e.reserved_usd) < 0)) throw new Error('invalid_spend_ledger');
      if (state.deadline_at !== undefined && (typeof state.deadline_at !== 'string' || !Number.isFinite(Date.parse(state.deadline_at)))) throw new Error('invalid_spend_deadline');
      const result = change(state);
      const temp = this.file + '.' + randomUUID() + '.tmp';
      fs.writeFileSync(temp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
      fs.renameSync(temp, this.file);
      return result;
    } finally { fs.rmdirSync(lock); }
  }
  // Call only after an explicit user request to resume. Unknown charges are
  // charged against the cap at their full reservation; they are never erased or
  // interpreted as free. This is separate from automatic retry/repair behavior.
  resume({ authorization, deadlineAt }) {
    if (typeof authorization !== 'string' || !authorization.trim()) throw new Error('resume_authorization_required');
    if (typeof deadlineAt !== 'string' || !Number.isFinite(Date.parse(deadlineAt)) || Date.parse(deadlineAt) <= Date.now())
      throw new Error('future_resume_deadline_required');
    this.transact(state => {
      if (state.entries.some(entry => entry.status === 'reserved')) throw new Error('active_request_prevents_resume');
      if (state.stopped && !['unknown_billing', 'repeated_failure_or_no_progress'].includes(state.stopped))
        throw new Error('spending_safety_stop_cannot_resume');
      const used = state.entries.reduce((total, entry) => total + (entry.actual_usd ?? entry.reserved_usd), 0);
      if (used >= state.cap_usd) throw new Error('overnight_spend_cap');
      state.resumptions = [...(state.resumptions || []), { authorized_at: new Date().toISOString(), authorization,
        previous_stop: state.stopped, previous_deadline: state.deadline_at ?? null, accounted_usd: used }];
      for (const entry of state.entries) if (entry.status === 'unknown') entry.status = 'accounted_unknown';
      state.stopped = null;
      state.consecutive_failures = 0;
      state.last_failure = null;
      state.deadline_at = deadlineAt;
    });
  }
  reserve(maximum, label) {
    return this.transact(state => {
      if (state.deadline_at && Date.now() >= Date.parse(state.deadline_at)) throw new Error('overnight_deadline_reached');
      if (state.stopped) throw new Error('paid_testing_stopped:' + state.stopped);
      if (state.entries.some(e => e.status === 'reserved' || e.status === 'unknown')) throw new Error('outstanding_model_reservation');
      if (!Number.isFinite(maximum) || maximum <= 0) throw new Error('request_cost_bound_missing');
      const used = state.entries.reduce((n,e) => n + (e.actual_usd ?? e.reserved_usd), 0);
      if (used + maximum > state.cap_usd) throw new Error('overnight_spend_cap');
      const id = randomUUID();
      state.entries.push({ id, label, reserved_usd: maximum, actual_usd: null,
        status: 'reserved', started_at: new Date().toISOString() });
      return id;
    });
  }
  settle(id, actual) {
    this.transact(state => {
      const entry = state.entries.find(e => e.id === id);
      if (!entry || entry.status !== 'reserved') throw new Error('invalid_reservation');
      if (!Number.isFinite(actual) || actual < 0) {
        entry.status = 'unknown'; state.stopped = 'unknown_billing';
      } else {
        entry.actual_usd = actual; entry.status = 'settled';
        if (actual > entry.reserved_usd) state.stopped = 'provider_exceeded_cost_bound';
      }
      entry.ended_at = new Date().toISOString();
    });
  }
  outcome(passed, reason) {
    this.transact(state => {
      state.consecutive_failures = passed ? 0 : (state.consecutive_failures || 0) + 1;
      if (!passed && (state.last_failure === reason || state.consecutive_failures >= 2)) state.stopped = 'repeated_failure_or_no_progress';
      state.last_failure = passed ? null : reason;
    });
  }
  wrap(provider, label) {
    return { ...provider, generate: async request => {
      const bytes = 2 * Buffer.byteLength(request.system + request.input + JSON.stringify(request.schema)) + 2048;
      const maximum = provider.maximumRequestCostUsd(bytes, request.maxOutputTokens);
      let id;
      try { id = this.reserve(maximum, label); }
      catch (error) {
        // Reservation failure happens before the provider is called. Preserve
        // that distinction instead of reporting an unknown-billing API error.
        throw Object.assign(error, { stage: 'spending', attempt_metadata: {
          cost_usd: 0, latency_ms: 0, provider_called: false,
        } });
      }
      let result;
      try { result = await provider.generate(request); }
      catch (error) { this.settle(id, error?.attempt_metadata?.cost_usd); throw error; }
      this.settle(id, result.cost_usd);
      return result;
    } };
  }
}
