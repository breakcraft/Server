# Repository Guidelines



## Project Structure and Module Organization

- `engine/`: Bun + TypeScript game server and tools. Primary scripts live in `engine/package.json`. Views in `engine/view/`.
- `client/`: TypeScript web client. Bundling driven by `client/bundle.ts` and outputs to `client/out/`.
- `content/`: Game assets (textures, word filters, synth data).
- `javaclient/`: Java (Gradle) client. Requires Java 17+.
- Root scripts: `start.ts` (interactive CLI for subtree sync and workflows), `start.sh` and `start.bat` (bootstrap runtime checks). Config is persisted in `server.json`.


## Architecture Overview

- Monorepo managed with Git subtrees: `engine/`, `client/`, `content/`, `javaclient/`. See subtree aliases in `start.ts`.
- `start.ts` automates subtree status, safe updates using stash, debounced auto-commit and push via watchers, and periodic upstream pulls.
- Watcher push behavior: pushes to the real branch when repo is initialized. If not, pushes to `auto/<subtree>/<rev>` so you can open a PR later.
- Periodic update flow: stash local edits, pull upstream, pop stash.

### Subtree Flow

```
local edits → debounce → git add/commit → subtree push (alias or branch)
                         ↑                       ↓
               periodic: stash → pull upstream → pop stash
```


## Getting Started

- Prerequisites: Git, Node, Bun, Java 17+.
- Environment: copy `engine/.env.example` to `engine/.env` and set secrets locally. Do not commit `.env` files.
- Subtrees: check status with `bun run start.ts --status`. For safe update and watchers, run `bun run start.ts --update-and-sync` (alias `--auto`).


## Build, Development, and Workflows

- Bootstrap menu: `./start.sh` on Linux or macOS, `start.bat` on Windows. Help: `bun run start.ts --help`.
- Engine (server):
  - Dev watch: `cd engine && bun install && bun run dev`.
  - Build packs: `bun run build`.
  - Run server: `bun run start`.
- Client (web):
  - Dev: `cd client && bun install && bun run bundle.ts dev`.
  - Production bundle: `bun run bundle.ts` (artifacts in `client/out/`).
- Java client: `cd javaclient && ./gradlew run` or on Windows `javaclient\gradlew-auto.bat run`.
- Watchers: `bun run start.ts --start-watchers --debounce-ms 1500 --poll-ms 1500`. To avoid pushing to `origin`, use `--no-origin-push`.
- Example combined command: `bun run start.ts --no-origin-push --auto`.


## start.ts Quick Commands

- Status only: `bun run start.ts --status`
- Update and watchers: `bun run start.ts --update-and-sync` (alias `--auto`)
- Watchers only: `bun run start.ts --start-watchers --debounce-ms 1500 --poll-ms 1500`
- Disable origin push: `bun run start.ts --no-origin-push --auto`
- Help: `bun run start.ts --help`


## Coding Style and Naming Conventions

- TypeScript: 4 space indent, semicolons, single quotes, strict mode. See `engine/eslint.config.js` and `.prettierrc`.
- Modules: ESM with NodeNext. Prefer named exports.
- Naming: classes PascalCase, functions and variables camelCase, constants UPPER_SNAKE_CASE.
- Run formatters and lint before PRs. Engine uses Husky and lint-staged.


## Testing Guidelines

- Current status: no tests checked in.
- If adding tests, colocate `*.test.ts` in `engine` and run with `bun test`.
- Prioritize: protocol handlers, database gateways, pack tools.
- Aim for fast, isolated tests. Prefer explicit fixtures over global state.


## Branching, Commits, and Pull Requests

- Branch naming: `feature|fix|chore/<scope>-<slug>`. Scopes: `engine|client|content|javaclient`.
  - Example: `feature/engine-auth-login`.
- Conventional Commits. Optional scope is allowed, for example `feat(engine): add login route`.
- PRs: include a clear summary, linked issues, reproduction or validation steps, screenshots for client or UI changes, and notes about subtree or environment changes. Lint must pass. Keep diffs focused.


## PR Checklist

- Descriptive title and summary.
- Linked issue references and clear scope.
- Lint passes. Focused diff.
- Screenshots for client or UI changes.
- Note subtree changes and any config or environment updates.


## Screenshots and Assets

- Attach before and after PNGs at 1280x720 to PRs. Filenames: `ui-<feature>-before.png` and `ui-<feature>-after.png`.
- Do not commit `client/out/`.


## CI and Hooks

- Husky and lint-staged run ESLint and Prettier on staged files. Verify locally using `bun run lint` and `bun test` if tests are present.
- Continuous integration, when configured, must pass lint, build, and test.


## Database Commands for `engine`

- SQLite workflow (default):
  - `cd engine && bun run sqlite:migrate`
  - `bun run sqlite:reset`
  - `bun run sqlite:schema`
  - Default file: `engine/db.sqlite`.
- MySQL workflow (multiworld):
  - `cd engine && bun run db:migrate`
  - `bun run db:reset`
  - `bun run db:schema`
  - Configure `DATABASE_URL` in `engine/.env`.
- Resets are destructive. Back up data before running any `*reset` command.


## Troubleshooting

- Version checks: `bun --version`, `node --version`, `java -version`.
- Clean dependencies: remove `node_modules` in `engine` and `client`, then run `bun install` in each.
- Rebuild client: delete `client/out/`, then run `cd client && bun run bundle.ts dev`.
- Subtrees drifting: run `bun run start.ts --status` then `--update-and-sync`.


## Security and Configuration Tips

- Copy `engine/.env.example` to `engine/.env` and keep secrets local. Do not commit `.env` files.
- Requirements: Git, Node, Bun, Java 17+. Use `bun run start.ts --status` to verify subtree state and `--update-and-sync` to pull upstream safely. Start watchers using `bun run start.ts --start-watchers`.


## Releases

- Semantic Versioning. Bump versions in `engine` and `client` as needed.
- Tag at the root:
  - `git tag -a vX.Y.Z -m "Release vX.Y.Z" && git push --tags`
- Release notes should summarize merged PRs, subtree updates, and any database migrations.

