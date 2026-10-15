import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const sha256 = value => createHash('sha256').update(value).digest('hex');

export const MODEL_CATALOG = Object.freeze({
  openai: Object.freeze({
    'gpt-5.4-mini': Object.freeze({ input_per_million: 0.75, cached_input_per_million: 0.075,
      output_per_million: 4.5, source: 'https://developers.openai.com/api/docs/models/gpt-5.4-mini', checked: '2026-09-08' }),
    'gpt-5.4': Object.freeze({ input_per_million: 2.5, cached_input_per_million: 0.25,
      output_per_million: 15, source: 'https://developers.openai.com/api/docs/models/gpt-5.4', checked: '2026-09-08' }),
  }),
  anthropic: Object.freeze({
    'claude-haiku-4-5-20251001': Object.freeze({ input_per_million: 1, cached_input_per_million: 0.1,
      output_per_million: 5, supports_effort: false,
      source: 'https://platform.claude.com/docs/en/about-claude/pricing', checked: '2026-09-08' }),
    'claude-sonnet-5': Object.freeze({ input_per_million: 2, cached_input_per_million: 0.2,
      output_per_million: 10, source: 'https://platform.claude.com/docs/en/about-claude/pricing', checked: '2026-09-08' }),
    'claude-opus-5': Object.freeze({ input_per_million: 5, cached_input_per_million: 0.5,
      output_per_million: 25, source: 'https://platform.claude.com/docs/en/about-claude/pricing', checked: '2026-09-08' }),
  }),
  gemini: Object.freeze({
    'gemini-3.1-flash-lite': Object.freeze({ input_per_million: 0.25, cached_input_per_million: 0.025,
      output_per_million: 1.5, source: 'https://ai.google.dev/gemini-api/docs/pricing', checked: '2026-09-09' }),
    'gemini-3.8-flash': Object.freeze({ input_per_million: 0.75, cached_input_per_million: null,
      output_per_million: 3.75, source: 'https://ai.google.dev/gemini-api/docs/latest-model', checked: '2026-09-08',
      note: 'introductory pricing through 2026-12-31' }),
    'gemini-3.1-pro-preview': Object.freeze({ input_per_million: 2, cached_input_per_million: 0.2,
      output_per_million: 12, source: 'https://ai.google.dev/gemini-api/docs/pricing', checked: '2026-09-08' }),
  }),
});

function price(provider, model) {
  return MODEL_CATALOG[provider]?.[model] || null;
}

export function usageCostUsd(provider, model, usage) {
  const pricing = price(provider, model);
  if (!pricing || !usage) return null;
  const cached = usage.cached_input_tokens || 0;
  const input = Math.max(0, (usage.input_tokens || 0) - cached);
  if (cached && pricing.cached_input_per_million == null) return null;
  const value = input * pricing.input_per_million / 1_000_000
    + cached * (pricing.cached_input_per_million || 0) / 1_000_000
    + (usage.output_tokens || 0) * pricing.output_per_million / 1_000_000;
  return Number(value.toFixed(8));
}

export function maximumRequestCostUsd(provider, model, inputBytes, maxOutputTokens) {
  const pricing = price(provider, model);
  if (!pricing) return null;
  // UTF-8 bytes are a conservative upper bound for text token count in these
  // code/source prompts. Output is bounded by the provider request itself.
  return Number((inputBytes * pricing.input_per_million / 1_000_000
    + maxOutputTokens * pricing.output_per_million / 1_000_000).toFixed(8));
}

function safeErrorText(value) {
  return String(value || 'model_request_failed')
    .replace(/sk-(?:ant-)?[A-Za-z0-9_-]{8,}/gu, '<redacted-key>')
    .replace(/AIza[A-Za-z0-9_-]{8,}/gu, '<redacted-key>')
    .replace(/AQ\.[A-Za-z0-9._-]{8,}/gu, '<redacted-key>')
    .slice(0, 500);
}

async function requestJson({ fetchImpl, url, headers, body, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('model_request_timeout')), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body), signal: controller.signal });
    const text = await response.text();
    let value;
    try { value = JSON.parse(text); }
    catch { throw Object.assign(new Error('provider_response_not_json'), { status: response.status }); }
    if (!response.ok) {
      const message = value?.error?.message || value?.error?.status || value?.error?.type || `provider_http_${response.status}`;
      throw Object.assign(new Error(safeErrorText(message)), { status: response.status,
        code: safeErrorText(value?.error?.code || value?.error?.type || '') });
    }
    return { value, latency_ms: performance.now() - started };
  } catch (error) {
    error.latency_ms ??= performance.now() - started;
    throw error;
  } finally { clearTimeout(timeout); }
}

function parsedProposal(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('provider_response_text_missing');
  try { return JSON.parse(text); }
  catch { throw new Error('provider_structured_output_parse_failed'); }
}

function openAiText(response) {
  if (typeof response.output_text === 'string') return response.output_text;
  return (response.output || []).flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text').map(item => item.text).join('');
}

function anthropicSchema(value) {
  if (!value || typeof value !== 'object') return value;
  const unsupported = new Set(['$schema', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
    'multipleOf', 'minLength', 'maxLength', 'maxItems']);
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (unsupported.has(key) || (key === 'minItems' && child > 1)) continue;
    if (['properties', '$defs', 'definitions'].includes(key))
      result[key] = Object.fromEntries(Object.entries(child).map(([name, schema]) => [name, anthropicSchema(schema)]));
    else if (['anyOf', 'allOf', 'oneOf'].includes(key)) result[key] = child.map(anthropicSchema);
    else if (key === 'items') result[key] = anthropicSchema(child);
    else result[key] = child;
  }
  if (!Array.isArray(result.type)) return result;
  // The service rejected a nullable enum encoded as a type array. Use explicit
  // typed alternatives instead, keeping enum membership aligned in each branch.
  // The original schema still enforces every removed bound before admission.
  const types = result.type;
  const applicable = {
    properties: ['object'], required: ['object'], additionalProperties: ['object'],
    items: ['array'], minItems: ['array'], pattern: ['string'], format: ['string'],
  };
  const matches = (type, item) => type === 'null' ? item === null
    : type === 'integer' ? Number.isInteger(item)
      : type === 'array' ? Array.isArray(item)
        : type === 'object' ? item !== null && typeof item === 'object' && !Array.isArray(item)
          : typeof item === type;
  const alternatives = types.flatMap(type => {
    const branch = Object.fromEntries(Object.entries(result).filter(([key]) => !['type', 'enum'].includes(key)
      && (!applicable[key] || applicable[key].includes(type))));
    branch.type = type;
    if (result.enum) {
      branch.enum = result.enum.filter(item => matches(type, item));
      if (!branch.enum.length) return [];
    }
    return [branch];
  });
  if (!alternatives.length) throw new Error('provider_schema_empty_union');
  return { anyOf: alternatives };
}

function geminiSchema(value) {
  if (Array.isArray(value)) return value.map(geminiSchema);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === '$schema' || key === 'pattern' || key === 'const') continue;
    if (key === 'properties' || key === '$defs') {
      result[key] = Object.fromEntries(Object.entries(child).map(([name, schema]) => [name, geminiSchema(schema)]));
    } else result[key] = geminiSchema(child);
  }
  if (Object.hasOwn(value, 'const')) {
    if (!['string', 'number'].includes(typeof value.const)) {
      throw new TypeError('gemini_schema_const_requires_string_or_number');
    }
    const allowed = Array.isArray(value.enum) ? value.enum.filter(item => Object.is(item, value.const)) : [value.const];
    if (allowed.length !== 1) throw new TypeError('gemini_schema_const_conflicts_with_enum');
    result.enum = allowed;
  }
  if (typeof value.pattern === 'string') {
    const instruction = `Must match the regular expression ${JSON.stringify(value.pattern)}.`;
    result.description = result.description ? `${result.description} ${instruction}` : instruction;
  }
  return result;
}

function preservesGeminiConstraints(schema, value) {
  if (!schema || typeof schema !== 'object') return true;
  if (Object.hasOwn(schema, 'const') && !Object.is(value, schema.const)) return false;
  if (typeof schema.pattern === 'string' && (typeof value !== 'string' || !new RegExp(schema.pattern, 'u').test(value))) {
    return false;
  }
  if (schema.properties && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [name, child] of Object.entries(schema.properties)) {
      if (Object.hasOwn(value, name) && !preservesGeminiConstraints(child, value[name])) return false;
    }
  }
  if (schema.items && Array.isArray(value)) {
    return value.every(item => preservesGeminiConstraints(schema.items, item));
  }
  return true;
}

function normalizedUsage(value, requiredFields, normalize) {
  if (!value || typeof value !== 'object'
    || requiredFields.some(field => typeof value[field] !== 'number'
      || !Number.isFinite(value[field]) || value[field] < 0)) return null;
  return normalize(value);
}

export function createModelProvider({ provider, model, apiKey, reasoningEffort = 'low', fetchImpl = fetch }) {
  if (!['openai', 'anthropic', 'gemini'].includes(provider)) throw new TypeError(`Unsupported provider: ${provider}`);
  if (typeof model !== 'string' || !model) throw new TypeError('model is required');
  if (typeof apiKey !== 'string' || !apiKey) throw new TypeError(`${provider} API key is required`);
  const catalog = price(provider, model);
  const generate = async ({ system, input, schema, maxOutputTokens, timeoutMs }) => {
    let result;
    let text;
    let usage;
    let finishReason;
    if (provider === 'openai') {
      result = await requestJson({ fetchImpl, url: 'https://api.openai.com/v1/responses', timeoutMs,
        headers: { authorization: `Bearer ${apiKey}` }, body: { model, store: false, instructions: system,
          input, max_output_tokens: maxOutputTokens, reasoning: { effort: reasoningEffort },
          text: { format: { type: 'json_schema', name: 'library_contract_proposal', strict: true,
            schema: { ...schema, $schema: undefined } } } } });
      text = openAiText(result.value);
      usage = normalizedUsage(result.value.usage, ['input_tokens', 'output_tokens'], row => ({
        input_tokens: row.input_tokens || 0,
        cached_input_tokens: row.input_tokens_details?.cached_tokens || 0,
        output_tokens: row.output_tokens || 0,
        reasoning_output_tokens: row.output_tokens_details?.reasoning_tokens || 0 }));
      finishReason = result.value.status || null;
    } else if (provider === 'anthropic') {
      result = await requestJson({ fetchImpl, url: 'https://api.anthropic.com/v1/messages', timeoutMs,
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: { model,
          max_tokens: maxOutputTokens, system, messages: [{ role: 'user', content: input }],
          output_config: { ...(catalog?.supports_effort === false ? {} : { effort: reasoningEffort }),
            format: { type: 'json_schema', schema: anthropicSchema(schema) } } } });
      text = (result.value.content || []).filter(row => row.type === 'text').map(row => row.text).join('');
      usage = normalizedUsage(result.value.usage, ['input_tokens', 'output_tokens'], row => ({
        input_tokens: (row.input_tokens || 0) + (row.cache_read_input_tokens || 0)
          + (row.cache_creation_input_tokens || 0),
        cached_input_tokens: row.cache_read_input_tokens || 0, output_tokens: row.output_tokens || 0,
        reasoning_output_tokens: 0 }));
      finishReason = result.value.stop_reason || null;
    } else {
      result = await requestJson({ fetchImpl,
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        timeoutMs, headers: { 'x-goog-api-key': apiKey }, body: {
          systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: input }] }],
          generationConfig: { maxOutputTokens, responseMimeType: 'application/json',
            responseJsonSchema: geminiSchema(schema), thinkingConfig: { thinkingLevel: reasoningEffort } },
        } });
      text = (result.value.candidates?.[0]?.content?.parts || []).map(row => row.text || '').join('');
      usage = normalizedUsage(result.value.usageMetadata, ['promptTokenCount', 'candidatesTokenCount'], row => ({
        input_tokens: row.promptTokenCount || 0, cached_input_tokens: row.cachedContentTokenCount || 0,
        output_tokens: (row.candidatesTokenCount || 0) + (row.thoughtsTokenCount || 0),
        reasoning_output_tokens: row.thoughtsTokenCount || 0 }));
      finishReason = result.value.candidates?.[0]?.finishReason || null;
    }
    // Cache creation has TTL-dependent pricing. These adapters do not request
    // it; if a server adds it, retain an unknown bill instead of undercounting.
    const unmodeledCacheCreation = provider === 'anthropic' && result.value.usage?.cache_creation_input_tokens > 0;
    const metadata = { response_text_sha256: sha256(text || ''), usage,
      cost_usd: unmodeledCacheCreation ? null : usageCostUsd(provider, model, usage), latency_ms: result.latency_ms,
      finish_reason: finishReason };
    try {
      const proposal = parsedProposal(text);
      if (provider === 'gemini' && !preservesGeminiConstraints(schema, proposal)) {
        throw new Error('provider_structured_output_constraint_failed');
      }
      return { proposal, ...metadata };
    }
    catch (error) { error.attempt_metadata = metadata; throw error; }
  };
  return Object.freeze({ provider, model, reasoning_effort: reasoningEffort, pricing: catalog,
    maximumRequestCostUsd: (inputBytes, maxOutputTokens) => maximumRequestCostUsd(provider, model, inputBytes, maxOutputTokens),
    generate });
}
