# M1 live build

The launcher builds the pinned M1 LibreChat fixture with ProductTrace's autonomous build gates, then leaves the application and Tracer viewer running as detached, headless services.

## Start and stop

```sh
scripts/m1-live.sh
scripts/m1-live.sh stop
```

Starting is idempotent: if all four services are healthy, it returns without rebuilding or replacing them. PID files, logs, the live runtime rows, and collector output live under `.m1-live/` in this repository. The launcher uses `nohup` plus Node's detached POSIX-session spawn (`setsid` semantics on macOS).

## URLs

- LibreChat: <http://127.0.0.1:3081/>
- Tracer live activity: <http://127.0.0.1:8123/fiber-demo?productPort=3081>
- Backend health: <http://localhost:3080/health>
- Collector status: <http://127.0.0.1:8787/health>

Login:

- Email: `tracer-m1@example.test`
- Password: `Tracer-M1-2026!`

## What to try

Open the Tracer live activity URL and drive LibreChat in the embedded application. A useful full chain is:

1. Log in.
2. Send a chat message.
3. Expand the new Activity card on the right.
4. Inspect the effect-rooted first-party handler id and source span, outbound request id, matched backend route and handler, and database stops as those spans arrive.

Feedback, regenerate, edit and resubmit, conversation rename/delete, agent creation, and agent chat exercise the same pipeline. Internal capture and bridge transports remain in raw logs where applicable but are filtered from the displayed product path. Actions with a request root to the earliest eligible entry-handler continuation containing that request; a DOM-only action roots to its mutation receipt. Field input, focus, and keystroke context is coalesced into the submit or mutation episode it causes instead of becoming a separate unresolved card.

The live server imports the same exact-parent backend joiner, effect-rooted entry-handler indexer, and workflow-episode indexer used by evidence runs. A card is updated in place as its request, route, handler, and database spans arrive; it is not finalized by a timer.

## Build and runtime policy

- The autonomous build must pass marker presence, runtime smoke, and enabled/disabled Agent Builder parity before services are left running.
- Attribution is generic. There are no LibreChat-specific rules in the ProductTrace package.
- ProductTrace runtime attribution performs no model calls.
- The live LibreChat fixture uses the real `OPENAI_API_KEY` already configured in the fixture `.env`, so chat completions are real provider replies. The key is not copied into this document or logs by the launcher.
- The final7 scripted verification is separate: it uses the deterministic local OpenAI-compatible fixture and does not call a model.
