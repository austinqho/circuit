# circuit

The home of **producttrace**: install it into a React app, click through the app, and read what every user did as plain sentences with the real IDs each action touched.

To use the package, read [packages/producttrace/README.md](packages/producttrace/README.md).

## What's in this repo

| Path                     | What it is                                                               |
| ------------------------ | ------------------------------------------------------------------------ |
| `packages/producttrace/` | The package. This is the only thing published to npm.                    |
| `examples/`              | Real open-source React apps with producttrace installed, for live demos. |
| `apps/`                  | The test website and the harness agents use to click through apps.       |
| `docs/adr/`              | Decisions that shouldn't be re-argued (why runtime, why no model, ...).  |
| `GLOSSARY.md`            | The project's words: action, episode, frontier, store, ...               |

## Working on it

```sh
npm install        # installs every workspace and builds the package runtime
npm run check      # lint + typecheck + tests, the same thing CI runs
```

Other commands: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format`.

Every change goes through a pull request. CI must be green, and nobody merges their own PR. Agents working here should start with [AGENTS.md](AGENTS.md).
