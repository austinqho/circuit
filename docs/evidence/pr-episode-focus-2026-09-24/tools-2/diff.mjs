import fs from 'node:fs';
const a = JSON.parse(fs.readFileSync(process.argv[2])), b = JSON.parse(fs.readFileSync(process.argv[3]));
for (const name of Object.keys(a)) {
  const A = a[name], B = b[name];
  const epSame = JSON.stringify(A.episodes) === JSON.stringify(B.episodes);
  const ids = Object.keys(A.actions);
  const changed = ids.filter(id => JSON.stringify(A.actions[id]) !== JSON.stringify(B.actions[id]));
  const members = ids.filter(id => B.actions[id].member);
  const lostRequests = changed.filter(id => A.actions[id].requests.length !== B.actions[id].requests.length);
  const attemptsChanged = Object.keys(A.attempts).filter(k => JSON.stringify(A.attempts[k].attempts) !== JSON.stringify(B.attempts[k].attempts));
  const summariesChanged = Object.keys(A.attempts).filter(k => A.attempts[k].summary !== B.attempts[k].summary);
  const byEvent = {}; for (const id of changed) byEvent[A.actions[id].event] = (byEvent[A.actions[id].event] || 0) + 1;
  const changedEpisodes = new Set(changed.map(id => A.actions[id].episode_id));
  console.log(JSON.stringify({ store: name, records: A.stats.records, actions: ids.length, episodes: A.episodes.length, episodes_identical: epSame,
    action_chain_changed: changed.length, non_carrier_members: members.length, changed_not_member: changed.filter(id => !B.actions[id].member).length,
    member_chains_that_printed_carrier_requests_before: lostRequests.length, changed_by_event: byEvent, episodes_touched: changedEpisodes.size,
    element_keys: Object.keys(A.attempts).length, attempts_changed: attemptsChanged.length, element_history_summary_changed: summariesChanged.length }));
}
