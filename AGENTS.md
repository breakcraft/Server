# Repository Guidelines

## Project Structure & Module Organization
- `engine/`: Bun + TypeScript game server and tools. Primary scripts live in `engine/package.json` and views in `engine/view/`.
- `client/`: TypeScript web client; bundling driven by `client/bundle.ts` (outputs to `client/out/`).
- `content/`: Game assets (textures, word filters, synth data).
- `javaclient/`: Java (Gradle) client; requires Java 17+.
- Root scripts: `start.ts` (interactive CLI for subtree sync and workflows), `start.sh`/`start.bat` bootstrap runtime checks. Config persisted in `server.json`.

## Build, Test, and Development Commands
- Bootstrap menu: `./start.sh` (Linux/macOS) or `start.bat` (Windows). Help: `bun run start.ts --help`.
- Engine (server): `cd engine && bun install && bun run dev` (watch mode). Build packs: `bun run build`. Run: `bun run start`.
- Client (web): `cd client && bun install && bun run bundle.ts dev` for dev, or `bun run bundle.ts` for production. Artifacts go to `client/out/`.
- Java client: `cd javaclient && ./gradlew run` (Windows: `javaclient\\gradlew-auto.bat run`).
- Lint: `bun run lint` (root, engine-focused) or `cd engine && bun run lint`.

## Coding Style & Naming Conventions
- TypeScript: 4-space indent, semicolons, single quotes, strict mode (see `engine/eslint.config.js`, `.prettierrc`).
- Modules use ESM/NodeNext; prefer named exports. Classes: PascalCase; functions/vars: camelCase; constants: UPPER_SNAKE_CASE.
- Run formatters/lint before PRs; engine has Husky + lint-staged.

## Testing Guidelines
- No tests checked in yet. If adding, colocate `*.test.ts` and run with `bun test` (engine). Prioritize protocol handlers, DB gateways, and pack tools.

## Commit & Pull Request Guidelines
- Use Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`). PRs include summary, linked issues, UI screenshots (client), note subtree updates, and pass lint. See checklist below.

## Security & Configuration Tips
- Copy `engine/.env.example` to `engine/.env` and set secrets locally. Do not commit `.env` files.
- Requirements: Git, Node, Bun, and Java 17+. Use `bun run start.ts --status` to verify subtree state and `--update-and-sync` (or `--auto`) to pull upstream safely. Start watchers with `bun run start.ts --start-watchers`.

## Architecture Overview
- Monorepo managed via Git subtrees: `engine/`, `client/`, `content/`, `javaclient/` (see aliases in `start.ts`).
- `start.ts` automates: subtree status, safe update (with stash), auto-commit/push watchers (debounced), and periodic upstream pulls.
- Watchers push to real branch if initialized, else `auto/<subtree>/<rev>` for PRs later.

## Subtree Flow
```
local edits → debounce → git add/commit → subtree push (alias/branch)
                         ↑                       ↓
               periodic: stash → pull upstream → pop stash
```

## Database Commands (engine)
- MySQL (multiworld): `cd engine` then `bun run db:migrate`; reset: `bun run db:reset`; dev schema: `bun run db:schema`. Configure `DATABASE_URL` in `engine/.env`.
- SQLite (singleworld): `cd engine` then `bun run sqlite:migrate`; reset: `bun run sqlite:reset`; dev schema: `bun run sqlite:schema`. Default DB: `engine/db.sqlite`.

## PR Checklist
- Descriptive title and summary.
- Linked issue(s) and scope noted.
- Lint passes; minimal, focused diff.
- Screenshots for client/UI changes.
- Note subtree changes and any config/env updates.

## start.ts Quick Commands
- Status only: `bun run start.ts --status`
- Update + watchers: `bun run start.ts --update-and-sync` (alias: `--auto`)
- Watchers only: `bun run start.ts --start-watchers --debounce-ms 1500 --poll-ms 1500`
- Disable origin push: `bun run start.ts --no-origin-push --auto`
- Help: `bun run start.ts --help`
