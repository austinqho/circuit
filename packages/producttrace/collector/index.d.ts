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

/** One sentence of a session story (collector/story.mjs). Served by GET /story and GET /story/stream in store mode. */
export interface StoryEntity { type: string; id: string; from: 'request_url' | 'response_body' | 'page_url'; created?: boolean }
export interface StoryRequest { method: string; path: string; status: number | null; aborted: boolean; entities: StoryEntity[]; request_occurrence_id: string }
export interface StoryLine {
  schema: 'producttrace.story.v1';
  /** Stable across calls: the action id, or `nav:<action id>`. */
  id: string;
  kind: 'act' | 'submit' | 'hover' | 'type' | 'navigate';
  session: string;
  /** Epoch ms of the user action. */
  at: number | null;
  /** Path + query the page was on (runtime builds since labels/page). */
  page: string | null;
  text: string;
  event?: string;
  count?: number;
  element?: { tag: string | null; label: string | null; key: string | null };
  handler?: { name: string | null; file: string | null; line: number | null } | null;
  requests?: StoryRequest[];
  entities?: StoryEntity[];
  outcome?: string | null;
  action_id?: string;
}
export interface StorySession { session: string; started_at: number | null; ended_at?: number | null; actions: number; first_page: string | null }
export interface Story { schema: 'producttrace.story.v1'; sessions: StorySession[]; lines: StoryLine[] }
export declare function storyOf(store: object, options?: { session?: string }): Story;
export declare function createStoryFeed(options: { dir: string; sourceRoot?: string | null }): (options?: { session?: string }) => Promise<Story>;
export declare function idsInUrl(url: string, from: StoryEntity['from']): StoryEntity[];
export declare const STORY_SCHEMA: 'producttrace.story.v1';
