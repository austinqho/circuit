// Neutral fixture (server-outbound): a wouter app. A <Link> route change opens
// a project page; each button's handler calls one backend route whose handler
// calls other servers (see server.js). Knows nothing about Tracer.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Link, Route, Switch, useLocation } from 'wouter';

function Home() {
  return <nav><h1>Projects</h1><Link href="/projects/p1">Open Harbor survey</Link></nav>;
}

function ProjectPage({ params }) {
  const [, navigate] = useLocation();
  const [status, setStatus] = useState('idle');
  const id = params.id;
  async function loadProject() {
    const response = await fetch(`/api/projects/${id}`);
    const project = await response.json();
    setStatus(`loaded ${project?.name ?? 'nothing'}`);
  }
  async function archiveProject() {
    const response = await fetch(`/api/projects/${id}/archive`, { method: 'POST' });
    setStatus(`archive ${response.status}`);
    navigate(`/projects/${id}/archived`);
  }
  async function syncProject() {
    const response = await fetch(`/api/projects/${id}/sync`, { method: 'POST' });
    setStatus(`sync ${response.status}`);
  }
  async function sendWebhook() {
    const response = await fetch(`/api/projects/${id}/webhook`, { method: 'POST' });
    setStatus(`webhook ${response.status}`);
  }
  async function showOverview() {
    const response = await fetch(`/api/projects/${id}/overview`);
    const overview = await response.json();
    setStatus(`overview ${overview.remote?.replicas ?? '?'}`);
  }
  async function forwardTraced() {
    const response = await fetch(`/api/projects/${id}/forward`, { method: 'POST' });
    setStatus(`forward ${response.status}`);
  }
  async function touchProject() {
    const response = await fetch(`/api/projects/${id}/touch`, { method: 'POST' });
    setStatus(`touch ${response.status}`);
  }
  async function proxyProject() {
    const response = await fetch(`/api/projects/${id}/proxy`);
    setStatus(`proxy ${response.status}`);
  }
  async function runChain() {
    const response = await fetch('/api/chain/5', { method: 'POST' });
    setStatus(`chain ${response.status}`);
  }
  return (
    <main>
      <h1>Project {id}</h1>
      <p role="status">{status}</p>
      <button type="button" aria-label="Load project" onClick={loadProject}>Load project</button>
      <button type="button" aria-label="Archive project" onClick={archiveProject}>Archive project</button>
      <button type="button" aria-label="Sync with peer" onClick={syncProject}>Sync with peer</button>
      <button type="button" aria-label="Send webhook" onClick={sendWebhook}>Send webhook</button>
      <button type="button" aria-label="Show overview" onClick={showOverview}>Show overview</button>
      <button type="button" aria-label="Run chain" onClick={runChain}>Run chain</button>
      <button type="button" aria-label="Forward traced" onClick={forwardTraced}>Forward traced</button>
      <button type="button" aria-label="Touch project" onClick={touchProject}>Touch project</button>
      <button type="button" aria-label="Proxy project" onClick={proxyProject}>Proxy project</button>
      <Link href="/">Back</Link>
    </main>
  );
}

function Archived({ params }) {
  return <main><h1>Archived {params.id}</h1><Link href={`/projects/${params.id}`}>Return to project</Link></main>;
}

function App() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/projects/:id/archived" component={Archived} />
      <Route path="/projects/:id" component={ProjectPage} />
    </Switch>
  );
}

createRoot(document.getElementById('root')).render(<App />);
