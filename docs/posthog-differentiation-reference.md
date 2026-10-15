# Tracer differentiation from PostHog — thesis and source reference

Saved: 2026-09-09. This is a product-strategy reference, not an implementation or coverage claim.

## How to use this reference

When discussing differentiation, distinguish three things: the user's desired
product, what PostHog actually says, and what Tracer has demonstrated. Quote the
user-supplied article in the appendix accurately; cite its original URL. Use a
fresh search of official PostHog documentation when making current feature claims.
Do not treat this snapshot as a permanently current competitor inventory.

The exact other side conversation was not exposed in the task listing. The user
supplied its opening sentence ("I am trying to pitch my product") and explicitly
pointed to **trying posthog**. The early user messages and comparison findings
from that task have now been read and incorporated below. The full separate side
conversation has not been retrieved. Primary sources are the current user
message, the supplied article and the early trying posthog transcript.

## Earlier context from “trying posthog”

Read from task `01a02640-f1ee-7481-9ccb-8df598b5eb2b`, early transcript records
9–1729. These are historical conversation observations, not a fresh rerun of
PostHog or a universal statement about its current capabilities.

- At record 9 the user requested a real LibreChat comparison of product analytics,
  session replay and AI observability using PostHog's installation wizard.
- At records 379 and 495 the user asked where the dashboard was and what all the
  buttons meant. At records 763 and 862 they asked whether actions between chat
  messages were captured and whether the chronology came from events or replay.
- At record 1133 the user described a package that keeps up with PRs and produces
  a unified sequence of user actions, model interactions and tool calls, including
  simultaneous activity, exact message/transcript/artifact identities and outcomes.
  That record explicitly names continual learning and learning how power users
  operate the product as goals. Simple narrated sessions are the interface to an
  evidence substrate, rather than the entire underlying product.
- At record 1394 the user challenged the wizard's selective instrumentation and
  asked whether missing IDs prevent reliable learning-data joins.
- At record 1511 the user asked for a closer inspection of PostHog replay metadata.
  The assistant's answer at record 1729 corrected its earlier overstatement:
  the observed PostHog recording included chronological events, DOM metadata,
  visible transcripts, user/session identity and a conversation ID recoverable
  from the URL. The inspected events lacked several message/run/tool/outcome joins.
  That finding concerns the tested integration, not a storage limitation of PostHog.

**Continuity with the present thesis:** personal chat-created views are the access
layer. Automatically maintained, entity-linked execution evidence is the proposed
foundation. Continual learning is one consumer of that foundation; a human's
marketing or engineering analysis is another. A click or copy is an observation,
not automatically an endorsement or a valid training label.

**Pitch framing:** Tracer is an automatically maintained product-evidence layer
for AI products. It aims to connect what users do, what agents do, and what
actually happens—then let every teammate explore that record in a personal,
shareable workspace without becoming an analytics engineer.

## The user's thesis

Telemetry is often secondary work. Engineers customize it to the company's early
needs, then maintenance falls behind as the product changes. The user describes
this happening at Windsurf; that is a firsthand anecdote supplied by the user,
not an independently verified claim about Windsurf or all companies.

The proposed Tracer experience:

- Attach Tracer once. Have it follow subsequent repository changes and deployed
  runtime behavior without ongoing manual event-definition work.
- Make the main interface two tabs: **Chat** and **Logs**. Chat should perform
  product operations, not merely explain which buttons to find elsewhere.
- Let each teammate create a personal workspace and generate tables or views
  through conversation, with no SQL required.
- Let marketing and engineering ask different questions without changing each
  other's collection rules, tables or metric definitions.
- Make analyses easy to share and fork. An agent can point out that a teammate
  already created something similar and offer that work as a starting point.
- Support broadly discoverable templates and analyses, with explicit sharing
  scope. Forking a public template need not expose another company's underlying
  data or confer access to it.
- Grow toward generated interfaces that adapt to the person and question, rather
  than requiring every user to learn a large analytics application's controls.
- Reduce anxiety about missed events, broken tracking and accidental damage to
  someone else's work. Retain evidence so new questions can be asked later,
  within the information actually captured and retained.

Exact user phrases that capture the intent:

> "the interface shld honestly be two tabs: chat and logs"

> "we want to give everyone their own sandbox to experiment with data."

> "make the product be able to weld itself to the user."

The user's phrases "it collects everything", "no set up at all" and "literally
unbreakable" express the aspiration. They must not be represented as verified
current guarantees. A repository analysis alone cannot reconstruct an interaction
that was never observed, and a pushed PR is not evidence that deployed users ran it.

## Proposed positioning

**Attach Tracer to your product, then ask questions in your own workspace. Tracer
maintains the connection between product changes and observed behavior; each
answer can be inspected, customized, shared and forked without changing anyone
else's tracking.**

This is a proposed promise to validate. Its strongest potential distinction is
continuously maintained, source-linked execution evidence underneath independently
editable analyses. A smaller interface and chat are experience choices, not by
themselves unique technical capabilities.

```text
Repository revision + observed runtime execution
                      |
          Versioned evidence and coverage
                      |
       Shared definitions where agreement matters
                      |
       +--------------+----------------+
       |              |                |
 Marketing view  Engineering view   Personal experiment
       |              |                |
       +--- share / fork definitions --+
```

"Read only" should mean analysis cannot mutate the customer's product data or
another person's work. Instrumentation still executes code and consumes resources;
its overhead and effect on the application need measurement. Saved views and
workspace settings can change without changing the underlying evidence.

## What PostHog's pasted thesis actually says

The article argues that agents and humans need consistent business meaning:
approved metrics, authoritative tables and known joins. Its catalog describes
existing data rather than duplicating it. Agents propose definitions; humans
approve them. Edits remove approval, while changes to a source insight flag drift.
The article supports SQL-backed and insight-backed definitions and also discusses
Markdown definitions. It measures correct answers, reuse of approved metrics and
continued catalog growth.

The article does not establish that a semantic layer requires an exhaustive,
company-wide setup before anyone can explore. It explicitly considers ongoing
catalog growth. Nor does it argue that users must manually write SQL or navigate
all of PostHog's screens. Treat the user's UX criticism as a hypothesis to test,
not as a factual absence of conversational tools.

Shared semantics and personal sandboxes solve different problems. A marketer can
fork a view, change a cohort, or invent a draft metric without changing the team's
approved MRR definition. Two views can disagree because their definitions differ;
the agent should show that difference rather than silently give both the same
metric name. Tracer can adopt shared definitions while making experimentation
independent, reversible and conversational.

## Verified overlap with PostHog — checked 2026-09-09

| Capability | Official evidence | Implication for differentiation |
| --- | --- | --- |
| Automatic event capture | [Autocapture](https://posthog.com/docs/product-analytics/autocapture) documents capture of interactions and other event categories without per-event tracking code. | Automatic clicks alone are not unique. Compare coverage, semantic identity and maintenance across product changes. |
| Conversational analysis and creation | [PostHog AI](https://posthog.com/docs/posthog-ai) documents plain-English queries, SQL, insights, dashboards and other product operations. | Chat and no-SQL creation alone are not unique. Compare how much setup and UI navigation a user actually needs. |
| Governed definitions and drift | [Semantic-layer article](https://posthog.com/blog/semantic-layer) describes human-approved definitions, snapshots and drift flags. | Personal views should preserve clarity about shared versus experimental meanings. |
| Automated setup and change-driven feedback | [PostHog AI platform handbook](https://github.com/PostHog/posthog.com/blob/master/contents/handbook/engineering/ai/ai-platform.md) describes a setup wizard and a vision of agents adding instrumentation and evaluating shipped changes. | Do not claim PostHog ignores maintenance or code. Distinguish documented direction from demonstrated end-to-end coverage. |

These sources do not settle whether PostHog offers the exact personal-workspace,
analysis-forking and teammate-discovery experience proposed here. That remains a
specific competitive workflow to investigate rather than an asserted missing feature.

## What would make the distinction real

1. **Maintenance:** After a change adds or moves a control, changes a callback or
   dependency, or changes a backend route, show how Tracer updates its evidence
   without developer-authored event repairs. Report any unsupported connections.
2. **Independence:** A marketer creates and edits a view; prove the engineer's
   saved view, the raw evidence and collection configuration are unchanged.
3. **Trust:** Trace an answer to the relevant execution, code revision, query and
   metric definition. Missing coverage must be visible, not converted into zero.
4. **Reuse:** Find a relevant teammate's analysis, show its definition and owner,
   and fork it without overwriting the original or granting new data access.
5. **Simplicity:** Ask a first-time nontechnical user to answer a real question
   from Chat. Measure setup, manual corrections and navigation against the same
   task in PostHog, including PostHog AI rather than only its dashboard editor.

An illustrative target interaction:

> User: "Show trial users who tried to send a message but never got a reply."
>
> Agent: "Here is a personal view. It uses observed send attempts and responses;
> these rows have missing backend coverage. Sam has a similar analysis using a
> different timeout. Would you like to fork that definition?"
>
> User: "Use thirty seconds and group by signup campaign."
>
> Agent updates that user's view, preserves the earlier version and leaves Sam's
> view and the underlying capture configuration alone. Campaign data must already
> be available or the missing source must be identified.

This example is a desired workflow, not a claim that it is implemented today.

## Source provenance

- Pasted title: **Building a semantic layer: What it is and how we did it at PostHog**.
- Authors: Lizzie Epton and Thiago Rocha Salvatore, as credited in the supplied text.
- Official article: https://posthog.com/blog/semantic-layer
- Official page date observed during lookup: August 19, 2026.
- Local pasted source: `/Users/austinho/.codex/attachments/c68a616c-5589-477b-ac2d-50f8ff168ce5/pasted-text.txt`.
- The appendix preserves the supplied text, including wording and typos. It is
  not a newly scraped replacement. The live page can change independently.

## Appendix: complete user-supplied PostHog text

Building a semantic layer: What it is and how we did it at PostHog 
Ask Claude, Cursor, and PostHog AI the same question: "what was our MRR last month?", and you'll get three different queries and three different numbers.
I did exactly this, half-expecting the tools to agree. They didn't; one summed a Stripe table, one found a slightly different Stripe table, and one tried to reconstruct recurring revenue from raw events and got the proration wrong. Every method and number was plausible, but there was no way to tell which was right.
The problem is what "MRR" means at PostHog, which table holds it, and how it's calculated all lives in people's heads. So every agent session reinvents the definition from scratch, slightly differently.
Humans have this problem too. Every new analyst needs to learns which revenue table is the real one and how Stripe is connected. Agents just amplify the issue by answering confidently and hallucinating to fill the gaps in their knowledge, and nobody thinks to double check it.
You can't fix it with a smarter model. You need to give every agent a single place to read the definition from so "MRR", and every other metric you want to define, mean the same thing on every call. That place is the semantic layer, and this is the story of building it into PostHog's context warehouse.
What is a semantic layer?
A semantic layer is a dictionary of definitions that everyone (agent and human) reads from. You define MRR once, approve it once, and every query you run from then on returns the same number.
The most important thing to understand about it is what it doesn't do. It doesn't copy your data, replace your warehouse, or move a single row of data. It sits on top of the data you already have and describes it, "this is what MRR means, this is the table to trust, this is how these two sources connect." It's a map, not a second copy of the territory. That's why it's called a layer.
It fixes is three kinds of knowledge that only exists as tribal memory:
What our metrics are: MRR isn't just "revenue", it's a specific calculation over a specific source.
Which tables to trust (and which tables to avoid): A mature project imports dozens of sources and builds hundreds of data models. Plenty of them could answer "revenue." Only one is current and blessed as accurate by the finance team. Others can be useful too, but there might be tables that we should avoid, e.g. they have been deprecated.
How the data joins together: The Stripe customer ID maps to an organization property, but only after it's reformatted, and nothing tells you that except the analyst who figured it out last time.
If you're a small company with a handful of tables you interact with regularly, you probably know where everything is. But, as you grow, you add more data sources and models, the meaning of those tables stop being obvious, least of all to an AI agent seeing your schema for the first time.
Semantic layer /sɪˈmæntɪk ˈleɪə/ – noun. 
A governed catalog of definitions that sits on top of your existing data and tells people and machines what it means: what each metric is, which tables to trust, and how sources connect. It describes the data; it doesn't copy or move it.

Glossary
- Catalog: the structured, queryable inventory the semantic layer maintains.
- Metric: a named, governed definition of a business measure, like MRR.
- Governed: nothing becomes official until a human approves it.
Where this lives: The context warehouse
The context warehouse is where PostHog pulls together everything an agent needs to answer questions. That includes product events, imported sources like your Stripe data, and data models. The semantic layer makes sure agents know what your data means and can interpret it correctly.
A catalog actually stores the semantic layer. What integrates it so fully is that it is just SQL. Every definition shows up as ordinary tables. Metrics are a table. There's no bespoke "catalog API" for an agent to learn; if it can run execute-sql, it already knows how to read the entire semantic layer. Discovery is a query, not an integration.
The reason three tools gave three MRR numbers is that each had to invent an answer. When you have a catalog, it becomes the first thing any agent checks: is there an approved metric? If so, it runs the governed definition instead of writing its own SQL. Same question, same number, every time.
AI generated, human owned
Agents are genuinely good at proposing improvements to your data governance. Point one at your schema and it'll happily draft metric definitions, suggest canonical tables, and spot likely joins from column names and sample data. Letting agents do the first pass is useful, but letting it edit doesn't improve trust, it muddles it further.
So everything an agent creates lands as proposed. Nothing an agent touches is ever canonical on its own. A human promotes it, approving a metric, certifying a table, accepting a join. We added two guardrails to verify any definition changes even after approval:
Editing an approved metric's definition drops it straight back to proposed. Changing what a number means re-opens the question of whether it's right.
If a metric was built from an existing insight and someone edits that insight, the metric gets flagged as drifted. It's a signal that the definition it was born from has moved and a human should re-review.
These give agents one simple rule to live by: a result is canonical only when status = 'approved' and is_drifted = false. Everything else including proposed, drifted, and archived, gets labeled non-canonical, and a well-trained agent will tell you so rather than passing it off as gospel.
The design decisions we made (and the ones we didn't)
The interesting part of building this was the tempting-looking architecture choices we walked away from. Almost every simplification you reach for breaks in a way that shows up later as a wrong number. Here are a few of the choices we didn't make:
"Why not just make every metric a SQL query?"
This is the first thing everyone suggests: funnels and trends all compile down to SQL eventually, so why not require every metric to be SQL and be done with it? Because the same metric written by hand as SQL gives a different number than the insight it came from.
Take activation, which at PostHog is a funnel. To make it SQL-only, someone must rewrite that funnel by hand. PostHog's funnel engine does a lot under the hood: steps happen in order, per person, inside a conversion window, with exclusions and deduplication applied. A hand-written SQL version gets some of that wrong.
Storing the metric as the same funnel definition the insight uses, and running it through the same engine, makes that mismatch impossible. The metric and the dashboard execute identical queries. That guarantee is why we support insight-shaped metrics, not just SQL.
So where does that definition live? When you create a metric from an insight, PostHog snapshots the insight's query and stores it on the metric server-side. That snapshot is what runs, which is how the metric and the insight stay in lockstep.
It also means the metric can notice when it falls out of step. Because the snapshot is stored but the insight keeps evolving, PostHog compares the two every time you read the metric and flags it as drifted if someone has changed the insight underneath it. Nothing runs in the background, the check happens live.
"Why not write definitions in plain English?"
A good part of it is. Users can define how the agent should calculate a given metric using a Markdown structure. However, plain English is limited because it is less deterministic than insight-backed and SQL-backed metrics.
"Why not just point a metric at an existing insight?"
Insights already blend SQL, funnels, and trends. Pointing at one would keep the metric and the dashboard in lockstep. The problem is that insights are shared objects that people edit all day. "Editing the definition resets approval" is impossible to enforce on something everyone's mutating.
Instead of pointing at the insight, metric-create takes the insight, snapshots its query, and remembers where it came from. You get lockstep awareness with the drift flag, without handing governance to an object anyone can change on a whim.
"Why not build a semantic query language, like dbt?"
That's the "right" long-term answer for composing non-SQL metrics into arbitrary queries, and it's exactly what we chose not to build in v1. It's a whole new language for both humans and agents to learn, plus a compiler to maintain forever. Even dbt won't let you plain-SELECT a metric in a random editor, you must go through their compiling API.
Our metric-run endpoint is the same architecture minus the language. If usage data later shows people really need in-editor composition, there's a path we can take to get there. Until then, it's complexity we haven't earned.
SQL metrics are defined over a saved view. Create the view first, point the metric at it, and the metric stays composable with plain SQL. Views are already PostHog's "queryable named SQL" primitive, so we reused them instead of inventing a parallel one.
What's next for semantic layering in PostHog
The PostHog semantic layer is in beta right now, you can work with it through MCP tools, PostHog's UI, and SQL.
We're measuring success around this by checking:
Do agents get questions right? The bar we set is ≥80% on a fixed set of golden questions, clearly above a baseline with no catalog.
When an approved metric exists, do agents actually use it instead of deriving their own number?
Does the catalog keep growing through everyday use, or does it spike during setup and then go silent?
As more of what we build becomes agent-driven, reliable data is the difference between an AI you can trust and one you can't.
The semantic layer is in beta. Get started with these instructions, or setup the PostHog MCP and ask your agent to recommend a new semantic layer catalog.

Written by Lizzie Epton (Developer Marketer) and Thiago Rocha Salvatore (Product Engineer) from PostHog.