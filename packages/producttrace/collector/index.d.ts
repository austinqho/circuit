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

/** The session story served by GET /story and GET /story/stream in store mode (collector/story.mjs). */
export interface StoryEntity { type: string; id: string; from: 'request_url' | 'response_body' | 'page_url'; created?: boolean }
export interface StoryRequest {
  method: string;
  path: string;
  status: number | null;
  /** done: a status was recorded; pending: none yet, page still open; no_response: page closed without one; not_recorded: body capture off. */
  state: 'done' | 'pending' | 'aborted' | 'no_response' | 'not_recorded';
  aborted: boolean;
  entities: StoryEntity[];
  request_occurrence_id: string;
}
interface StoryLineBase {
  schema: 'producttrace.story.v1';
  /** Stable across calls: the action id, or `nav:…` for a navigation line. A live reader replaces a line it has seen by id. */
  id: string;
  session: string;
  /** Epoch ms. */
  at: number | null;
  /** Path + query of the page the action happened on. */
  page: string | null;
  text: string;
}
export interface StoryElement { tag: string | null; label: string | null; key: string | null }
/** A click, submit, hover or key press, with what it caused. */
export interface StoryActLine extends StoryLineBase {
  kind: 'act' | 'submit' | 'hover';
  event: string;
  action_id: string;
  element: StoryElement;
  handler: { name: string | null; file: string | null; line: number | null } | null;
  requests: StoryRequest[];
  /** Client-side navigations this action made (its line says "went to …"). */
  navigations: { to: string; from: string | null; via: string | null }[];
  entities: StoryEntity[];
  /** More about the action in plain words (handler, what ran when nothing was sent). Never in `text`. */
  detail: string | null;
}
/** Text entry into one field; `count` grows while the user keeps typing there. Never the text itself. */
export interface StoryTypeLine extends StoryLineBase { kind: 'type'; action_id: string; count: number; element: StoryElement }
/** A page change between two actions. */
export interface StoryNavigateLine extends StoryLineBase { kind: 'navigate'; entities: StoryEntity[] }
export type StoryLine = StoryActLine | StoryTypeLine | StoryNavigateLine;
export interface StorySession { session: string; started_at: number | null; ended_at?: number | null; actions: number; first_page: string | null }
export interface Story { schema: 'producttrace.story.v1'; sessions: StorySession[]; lines: StoryLine[] }
/** The story of a store directory, re-read only when its files change. */
export declare function createStoryFeed(options: { dir: string; sourceRoot?: string | null }): (options?: { session?: string }) => Promise<Story>;
