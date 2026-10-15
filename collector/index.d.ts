export interface CollectorOptions {
  host?: string;
  port?: number;
  outputPath?: string;
  /** G6 store mode: append into a Tracer store directory (records.jsonl, spans.jsonl, runs.jsonl, manifests/). */
  store?: { dir: string; manifest?: object | null; label?: string | null; source?: object | null; sourceRoot?: string | null };
}

export interface CollectorStatus {
  received: number;
  errors: number;
  file: string;
}

export interface Collector {
  url: string;
  outputPath: string;
  store: { dir: string; run_id: string; build: string } | null;
  ready: Promise<unknown[]>;
  status(): CollectorStatus;
  close(): Promise<void>;
}

export declare function createCollector(options?: CollectorOptions): Collector;
