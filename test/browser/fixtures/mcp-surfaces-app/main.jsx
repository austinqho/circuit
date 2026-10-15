// Neutral fixture (no product names) for "every MCP surface says what the rows
// already hold about a request, wherever the request came from". Libraries no
// other fixture pairs this way: wouter (a route whose page-load requests carry
// bodies) and TanStack Query v5 (a poll every 300 ms and two mutations).
//   - /projects/:id mounts two GETs whose bodies hold the entity labels;
//   - a pulse poll (refetchInterval 300 ms) armed at page load;
//   - one click sends two POSTs to the same URL with different `type` bodies;
//   - a mutation answered 409 { error: "locked" } and one answered { revision };
//   - a click arms a 3 s timer that sends a DELETE;
//   - a GET the server answers 304 (ETag) and the browser reports 200;
//   - an img (alt), a canvas (aria-label) and list rows (aria-label);
//   - a flag an uninstrumented inline script watches (see inline-script.html).
// Added after the independent grade (the grader's probe shapes, rebuilt here):
//   - an index-keyed list whose first row is removed (key @0 then shows another item);
//   - a fetch with redirect: 'manual' answered 302 (an opaque response);
//   - two same-URL POSTs that differ only in a nested field, and two that differ
//     only in a long nested string;
//   - a timer whose callback schedules a promise that sends the request;
//   - a request and a response with more fields than a line shows, long values
//     and a status-like key holding an object;
//   - 150 requests with ~4 KB bodies (the include_bodies budget);
//   - a row without a handler (never stamped) around keyed buttons.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query';
import { Route, Router, Switch } from 'wouter';

const JSON_HEADERS = { 'content-type': 'application/json' };

function readJson(response) {
  return response.json();
}

function getJson(url) {
  return fetch(url).then(readJson);
}

function loadProject(id) {
  return getJson(`/api/projects/${id}`);
}

function loadTasks(id) {
  return getJson(`/api/projects/${id}/tasks`);
}

function loadPulse() {
  return getJson('/api/pulse');
}

function postEvent(type, projectId) {
  return fetch('/api/events', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ type, projectId, source: 'toolbar' }) });
}

function patchTask(id, changes) {
  return fetch(`/api/tasks/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(changes) }).then(readJson);
}

function archiveTask(id) {
  return fetch(`/api/tasks/${id}`, { method: 'DELETE' });
}

function postJson(url, body) {
  return fetch(url, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
}

function MoveButton({ lane }) {
  return <button type="button" onClick={() => postJson('/api/lanes/move', { lane })}>Move</button>;
}

// A list whose rows carry no handler: its <li> is never stamped, only the buttons inside.
function Lanes() {
  return (
    <ul>
      {['one', 'two'].map(lane => (
        <li key={lane} aria-label={`Lane ${lane === 'one' ? 'One' : 'Two'}`}><MoveButton key={lane} lane={lane} /></li>
      ))}
    </ul>
  );
}

function drawChart(canvas) {
  const context = canvas.getContext('2d');
  context.fillRect(10, 10, 30, 30);
}

function ProjectPage({ params }) {
  const project = useQuery({ queryKey: ['project', params.id], queryFn: () => loadProject(params.id) });
  const tasks = useQuery({ queryKey: ['tasks', params.id], queryFn: () => loadTasks(params.id) });
  const pulse = useQuery({ queryKey: ['pulse'], queryFn: loadPulse, refetchInterval: 300 });
  const lock = useMutation({ mutationFn: () => patchTask('t1', { done: true }) });
  const finish = useMutation({ mutationFn: () => patchTask('t2', { title: 'Beta', done: true }) });
  const [selected, setSelected] = useState(null);
  const [zoomed, setZoomed] = useState(false);
  const [config, setConfig] = useState(null);
  const [armed, setArmed] = useState(false);
  const [items, setItems] = useState(['Alpha', 'Beta', 'Gamma']);
  const [opened, setOpened] = useState(null);

  function onNotify() {
    postEvent('pulse', params.id);
    postEvent('follow', params.id);
  }

  function onArchiveLater() {
    setArmed(true);
    setTimeout(() => { archiveTask('t3'); }, 3000);
  }

  function onCheckConfig() {
    fetch('/api/config').then(readJson).then(value => setConfig(value.theme));
  }

  function onStar() {
    document.body.setAttribute('data-star', 'on');
  }

  function onFollow() {
    fetch('/api/redirect', { redirect: 'manual' });
  }

  function onSearchTwice() {
    postJson('/api/search', { kind: 'filter', opts: { sort: 'asc', size: 10 } });
    postJson('/api/search', { kind: 'filter', opts: { sort: 'desc', size: 10 } });
    postJson('/api/upload', { kind: 'note', payload: { text: `${'x'.repeat(90)}a` } });
    postJson('/api/upload', { kind: 'note', payload: { text: `${'x'.repeat(90)}b` } });
  }

  function onDelayThenSave() {
    setTimeout(() => { Promise.resolve().then(() => postJson('/api/audit', { step: 'delayed' })); }, 500);
  }

  function onBulk() {
    postJson('/api/bulk', { alpha: 'a value longer than the thirty-two character cap', beta: 'b1', gamma: 'g1', delta: 'd1', epsilon: 'e1', title: 'a title that is longer than thirty-two characters' });
  }

  function onLoadMany() {
    for (let index = 0; index < 150; index += 1) fetch(`/api/blob?i=${index}`);
  }

  return (
    <main>
      <h1>{project.data ? project.data.name : 'Loading'}</h1>
      <p>pulse {pulse.data ? pulse.data.count : '-'}; config {config || '-'}; {armed ? 'archive armed' : 'idle'}</p>
      <img alt="Team logo" width="40" height="40" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" onClick={() => setZoomed(!zoomed)} />
      <canvas aria-label="Burn-down chart" width="120" height="50" ref={node => node && drawChart(node)} onClick={() => setZoomed(false)} />
      <ul>
        {(tasks.data ? tasks.data.items : []).map(task => (
          <li key={task.id} aria-label={`Task ${task.title}`} onClick={() => setSelected(task.id)}>
            {task.title}{selected === task.id ? ' (selected)' : ''}
            <button type="button" onClick={event => { event.stopPropagation(); setSelected(task.id); }}>Open</button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onNotify}>Notify</button>
      <button type="button" onClick={() => lock.mutate()}>Lock Alpha</button>
      <button type="button" onClick={() => finish.mutate()}>Finish Beta</button>
      <button type="button" onClick={onArchiveLater}>Archive later</button>
      <button type="button" onClick={onCheckConfig}>Check config</button>
      <button type="button" onClick={onStar}>Star</button>
      <button type="button" onClick={onFollow}>Follow link</button>
      <button type="button" onClick={onSearchTwice}>Search twice</button>
      <button type="button" onClick={onDelayThenSave}>Delay then save</button>
      <button type="button" onClick={onBulk}>Bulk</button>
      <button type="button" onClick={onLoadMany}>Load many</button>
      <ol>
        {items.map((item, index) => (
          <li key={index} aria-label={`Item ${item}`} onClick={() => setOpened(item)}>
            {item}
            <button type="button" onClick={event => { event.stopPropagation(); setOpened(item); }}>Open item</button>
          </li>
        ))}
      </ol>
      <button type="button" onClick={() => setItems(items.slice(1))}>Remove first</button>
      <Lanes />
      <p>{opened ? `opened ${opened}` : ''}</p>
      <p>{lock.isError ? 'lock failed' : ''}{lock.data ? `lock ${lock.data.error || 'ok'}` : ''}{finish.data ? ` revision ${finish.data.revision}` : ''}{zoomed ? ' zoomed' : ''}</p>
    </main>
  );
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <Switch>
          <Route path="/projects/:id" component={ProjectPage} />
          <Route>not found</Route>
        </Switch>
      </Router>
    </QueryClientProvider>
  );
}

createRoot(document.getElementById('root')).render(<App />);
