export interface CollectorOptions {
  host?: string;
  port?: number;
  outputPath?: string;
  /** G6 store mode: append into a Tracer store directory (records.jsonl, spans.jsonl, runs.jsonl, manifests/). */
  store?: { dir: string; manifest?: object | null; label?: string | null; source?: object | null; sourceRoot?: string | null };
  /** Store mode: how GET /story words segments and shows body values (see StoryOptions). */
  story?: { titleOf?: StoryOptions['titleOf']; values?: StoryOptions['values'] };
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
export interface StoryEntity { type: string; id: string; from: 'request_url' | 'request_body' | 'response_body' | 'page_url'; created?: boolean; /** Named by another entity's body (`teamId`, `user.id` inside a response), not the request's own subject. */ reference?: boolean }
/**
 * A value a request or response body carried. Secrets are never read.
 * personal: an email or a person's name (shown, masked or dropped by `values.personal`);
 * content: a short title or name; long: only its `length`; id: an identifier.
 */
export interface StoryValue { key: string; owner: string | null; class: 'personal' | 'content' | 'long' | 'id'; from: 'request_body' | 'response_body'; value?: string; length?: number }
/** A list a GET returned: `count` items read, `total` when the server said, `at_least` when the body was cut. */
export interface StoryList { type: string | null; count: number; total?: number; at_least?: boolean; /** Item id → its short title, for the first 100 items (only when content values are shown). */ names?: Record<string, string> }
export interface StoryNavigation { to: string; from: string | null; via: string | null }
export interface StoryRequest {
  method: string;
  path: string;
  status: number | null;
  /** done: a status was recorded; pending: none yet, page still open; no_response: page closed (or 30 s passed) without one; not_recorded: body capture off. */
  state: 'done' | 'pending' | 'aborted' | 'no_response' | 'not_recorded';
  aborted: boolean;
  entities: StoryEntity[];
  request_occurrence_id: string;
  /** Order within its page load, shared with navigations. */
  sequence: number | null;
  list?: StoryList;
  values?: StoryValue[];
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
  navigations: StoryNavigation[];
  entities: StoryEntity[];
  /** More about the action in plain words (handler, what ran when nothing was sent). Never in `text`. */
  detail: string | null;
  /** The form the control belongs to (runtime ref), so a segment can join a form's lines. */
  form: string | null;
  values?: StoryValue[];
}
/** Text entry into one field; `count` grows while the user keeps typing there. Never the text itself. `navigations`: the URL a search box synced to, last one last. */
export interface StoryTypeLine extends StoryLineBase { kind: 'type'; action_id: string; count: number; element: StoryElement; navigations?: StoryNavigation[]; form: string | null; /** The field's `name` attribute: links it to the submitted body's key. */ field: string | null; secret?: true }
/** A page change between two actions. */
export interface StoryNavigateLine extends StoryLineBase { kind: 'navigate'; entities: StoryEntity[]; navigations: StoryNavigation[] }
/** A page load (`open:<session>`), with the requests the app made before the first action. */
export interface StoryOpenLine extends StoryLineBase { kind: 'open'; requests: StoryRequest[]; navigations: StoryNavigation[]; entities: StoryEntity[]; values?: StoryValue[] }
/** Scrolling that moved at least one screen (consecutive scrolls of one target are one line). */
export interface StoryScrollLine extends StoryLineBase { kind: 'scroll'; at_end: number | null; target_ref: string | null; viewport: number | null; screens: number; /** 'down', 'up', or 'down and back up' / 'up and back down' when it ended about where it started. */ direction: string | null }
export type StoryLine = StoryActLine | StoryTypeLine | StoryNavigateLine | StoryOpenLine | StoryScrollLine;
/**
 * One goal: consecutive lines of a session joined by a shared form, entity id
 * or page. `title` is a task caption in the voice of the narration spec §7
 * ("Opened the Discussions page and created a discussion titled “Q3 plan”.");
 * `steps` are its sub-actions, one per line.
 */
export interface StorySegment {
  schema: 'producttrace.story.v1';
  /** `seg:<first line id>`: stable while the segment grows. */
  id: string;
  session: string;
  /** null when no verb matched (the title then names the first sub-action). */
  verb: 'registered' | 'logged_in' | 'logged_out' | 'created' | 'edited' | 'deleted' | 'sent' | 'opened_app' | 'opened' | 'drafting' | 'scrolled' | 'browsed' | 'navigated' | null;
  title: string;
  /** template: the package's wording; custom: `titleOf` replaced it. */
  title_source: 'template' | 'custom';
  page: string | null;
  lines: string[];
  /** One caption per line, past tense and verb first ("Typed “Ada” into the “First Name” field."); `facts`: what was there (who was signed in, what loaded or was made). */
  steps: { line: string; text: string; facts: string[] }[];
  entities: { type: string; id: string; created?: boolean }[];
  values: StoryValue[];
  started_at: number | null;
  ended_at: number | null;
  duration_ms: number | null;
  /** 1–10, GUM's scale: 10 shown outright, lower as the title leans on less. */
  confidence: number;
  /** The session's last segment while its page is still open. */
  open: boolean;
  /** Earlier segments that created an entity this one touches. */
  related: string[];
  /** Everything the title was built from (verb, object, qualifiers, place). */
  facts: Record<string, unknown>;
}
/** The session as a handful of observations, one per segment that says something. */
/** The session: `text` is its goals joined with ", then"; `observations` one per goal that says something. */
export interface StoryNarrative { session: string; text: string; observations: { text: string; cites: string[]; confidence: number }[]; source: 'template' }
export interface StoryOptions {
  session?: string;
  /** Replace a segment's wording (an annotator); return null to keep the package's. Never changes grouping. */
  titleOf?: (facts: Record<string, unknown>, segment: StorySegment) => string | null;
  /** How body values are shown: personal values shown, masked (`a•••@example.com`) or dropped; content shown or only its length. */
  values?: { personal?: 'show' | 'mask' | 'drop'; content?: 'show' | 'length' };
}
export interface StorySession { session: string; started_at: number | null; ended_at?: number | null; actions: number; first_page: string | null }
export interface Story { schema: 'producttrace.story.v1'; sessions: StorySession[]; lines: StoryLine[]; segments: StorySegment[]; narrative: StoryNarrative[] }
/** The story of a store directory, re-read only when its files change. GET /story/stream sends `line`, `segment` and `narrative` events. */
export declare function createStoryFeed(options: { dir: string; sourceRoot?: string | null; titleOf?: StoryOptions['titleOf']; values?: StoryOptions['values'] }): (options?: { session?: string }) => Promise<Story>;
