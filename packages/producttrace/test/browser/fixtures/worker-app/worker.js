// Fetches on the page's behalf. Nothing here is instrumented.
self.addEventListener('message', async event => {
  if (event.data?.op !== 'load') return;
  const response = await fetch(event.data.path);
  const body = await response.json().catch(() => null);
  self.postMessage({ path: event.data.path, status: response.status, body });
});
