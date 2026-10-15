/** A free, unauthenticated connection check. It cannot establish API-key validity. */
export async function checkOpenAIConnectivity({ fetchImpl = fetch, timeoutMs = 3000 } = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl('https://api.openai.com/v1/models', { signal: controller.signal });
    await response.body?.cancel();
    return { ready: response.status === 401 || response.status === 200, status: response.status,
      reason: response.status === 401 || response.status === 200 ? null : 'unexpected_connectivity_response' };
  } catch { return { ready: false, status: null, reason: 'provider_network_unavailable' }; }
  finally { clearTimeout(timer); }
}
