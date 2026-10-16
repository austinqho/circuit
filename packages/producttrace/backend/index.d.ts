export type NodeBackendAdapter = 'http' | 'express' | 'mongoose' | 'mongodb' | 'undici';

export interface BackendSpan {
  schema: 'producttrace.backend-span.v1';
  source: 'opentelemetry';
  service_name: string;
  name: string;
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  kind: 'internal' | 'server' | 'client' | 'producer' | 'consumer' | 'unknown';
  status: { code: number; message?: string };
  attributes: Record<string, unknown>;
  start_time: [number, number] | null;
  end_time: [number, number] | null;
  instrumentation: { name: string; version: string | null } | null;
}

export interface OpenTelemetryReadableSpan {
  name: string;
  kind: number;
  status: { code: number; message?: string };
  attributes: Record<string, unknown>;
  startTime: [number, number];
  endTime: [number, number];
  parentSpanContext?: { spanId: string };
  resource?: { attributes?: Record<string, unknown> };
  instrumentationScope?: { name: string; version?: string };
  spanContext(): { traceId: string; spanId: string };
}

export declare function normalizeOpenTelemetrySpan(
  span: OpenTelemetryReadableSpan,
  options?: { serviceName?: string; captureContent?: boolean },
): BackendSpan;

export declare function createProductTraceSpanExporter(options: {
  onSpan(span: BackendSpan): void;
  serviceName: string;
  /** Retain database query and result content. Defaults to false. */
  captureContent?: boolean;
}): {
  export(spans: OpenTelemetryReadableSpan[], done: (result: { code: number }) => void): void;
  shutdown(): Promise<void>;
};

export declare function startNodeBackendTelemetry(options: {
  onSpan(span: BackendSpan): void;
  serviceName: string;
  adapters?: NodeBackendAdapter[];
  /** Database statements and results are excluded unless explicitly enabled. */
  captureContent?: boolean;
  /** Called with every SDK span as it starts (numeric OTel SpanKind); errors are swallowed. */
  onSpanStart?(span: unknown): void;
}): {
  instrumentations: Array<{ name: string; version: string }>;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
};

export declare const BACKEND_SPAN_SCHEMA: 'producttrace.backend-span.v1';
export declare const NODE_BACKEND_ADAPTERS: readonly NodeBackendAdapter[];
