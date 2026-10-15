// Entry point: `producttrace/backend`. OpenTelemetry spans for Express, http/undici and MongoDB.
export {
  startNodeBackendTelemetry,
  createProductTraceSpanExporter,
  normalizeOpenTelemetrySpan,
  BACKEND_SPAN_SCHEMA,
  NODE_BACKEND_ADAPTERS,
} from './backend/index.js';
