// Neutral fixture frontend (no product names): every request is a TanStack
// Query mutation fired from a button. The backend (server.cjs) decides which
// server code reads, writes and answers.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';

const TOKEN = 'token-u1';
async function call(method, url, { token = TOKEN, body } = {}) {
  const response = await fetch(url, { method, headers: { 'content-type': 'application/json', ...(token ? { 'x-user-token': token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${response.status} ${data?.error || ''}`.trim());
  return data;
}

const ACTIONS = [
  ['count', 'Count tasks (public)', () => call('GET', '/api/public/task-count', { token: null })],
  ['guest', 'Open project as guest', () => call('GET', '/api/projects/p1/tasks', { token: null })],
  ['tasks', 'Open project', () => call('GET', '/api/projects/p1/tasks')],
  ['rename', 'Rename first task', () => call('PATCH', '/api/projects/p1/tasks/t1', { body: { title: 'Renamed' } })],
  ['summary', 'Summarize project', () => call('POST', '/api/projects/p1/summary')],
  ['ping', 'Ping project', () => call('POST', '/api/projects/p1/ping')],
  ['archive', 'Archive project', () => call('POST', '/api/projects/p1/archive')],
  ['explode', 'Run failing job', () => call('POST', '/api/projects/p1/explode')],
  ['missing', 'Open missing project', () => call('GET', '/api/projects/zz/tasks')],
  ['stats', 'Project stats', () => call('GET', '/api/projects/p1/stats')],
  ['owner', 'Project owner', () => call('GET', '/api/projects/p1/owner')],
  ['whoami', 'Who am I', () => call('GET', '/api/whoami')],
];

function ActionButton({ testid, label, run }) {
  const mutation = useMutation({ mutationFn: run });
  const text = mutation.isLoading ? 'working' : mutation.isError ? `error: ${mutation.error.message}` : mutation.isSuccess ? 'done' : 'idle';
  return (
    <li>
      <button type="button" data-testid={testid} onClick={() => mutation.mutate()}>{label}</button>
      <output data-testid={`${testid}-state`}>{text}</output>
    </li>
  );
}

function App() {
  return <main><h1>Projects</h1><ul>{ACTIONS.map(([testid, label, run]) => <ActionButton key={testid} testid={testid} label={label} run={run} />)}</ul></main>;
}

const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
