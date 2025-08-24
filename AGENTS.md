# Repository Guidelines

## Getting Started
- Prereqs: Git, Node, Bun, Java 17+.
- Env: copy `engine/.env.example` → `engine/.env`. To use MySQL, set `DATABASE_URL`; otherwise SQLite at `engine/db.sqlite` is used.
- Subtrees: check status with `bun run start.ts --status`. For safe update + watchers, use `bun run start.ts --update-and-sync` (alias `--auto`).

## Project Structure
- `engine/`: Bun + TypeScript server; scripts in `engine/package.json`, views in `engine/view/`.
- `client/`: TS web client; bundled by `client/bundle.ts` → `client/out/`.
- `content/`: Assets (textures, filters, synth data).
- `javaclient/`: Java (Gradle) client; Java 17+.
- Root: `start.ts`, `start.sh`/`start.bat`, `server.json`.

## Build, Dev, Workflows
- Bootstrap: `./start.sh` or `start.bat`; help: `bun run start.ts --help`.
- Server dev: `cd engine && bun install && bun run dev` (watch). Build packs: `bun run build`. Run: `bun run start`.
- Client dev: `cd client && bun install && bun run bundle.ts dev` (watch) or `bun run bundle.ts` (prod bundle to `client/out/`).
- Java client: `cd javaclient && ./gradlew run` (Windows: `javaclient\gradlew-auto.bat run`).
- Watchers: `bun run start.ts --start-watchers --debounce-ms 1500 --poll-ms 1500`. Use `--no-origin-push` to avoid pushing to `origin`.

## Style & Naming
- TypeScript: 4‑space indent, semicolons, single quotes, strict mode.
- Modules: ESM/NodeNext; prefer named exports.
- Names: Classes PascalCase; funcs/vars camelCase; consts UPPER_SNAKE_CASE.
- Lint/format: `bun run lint` (root or `cd engine && bun run lint`); Prettier + ESLint; Husky + lint-staged.

## Testing
- Add colocated `*.test.ts` in engine; run with `bun test`. Prioritize protocol handlers, DB gateways, and pack tools.
- Aim for fast, isolated tests; prefer explicit fixtures over global state.

## Branching, Commits, PRs
- Branches: `feature|fix|chore/<scope>-<slug>`; scopes: `engine|client|content|javaclient` (e.g., `feature/engine-auth-login`).
- Conventional Commits with optional scope, e.g., `feat(engine): add login route`.
- PRs: clear summary, linked issues, repro/validation steps, screenshots for client/UI, note subtree/env changes. Lint must pass; keep diffs focused.

## Screenshots & Assets
- Attach before/after PNGs (1280×720) to PRs; names: `ui-<feature>-before/after.png`. Do not commit `client/out/`.

## CI & Hooks
- Husky + lint-staged run ESLint/Prettier on staged files. Verify locally with `bun run lint` and `bun test` (if present).
- CI (if configured) must pass lint/build/test. Avoid `--no-verify` except for emergencies.

## Database (engine)
- SQLite (default): `cd engine && bun run sqlite:migrate|sqlite:reset|sqlite:schema`.
- MySQL: `cd engine && bun run db:migrate|db:reset|db:schema`. Ensure `DATABASE_URL` in `engine/.env`.
- Resets are destructive; back up data before running `*reset`.

## Troubleshooting
- Versions: `bun --version`, `node --version`, `java -version`.
- Clean deps: remove `node_modules` in `engine/` and `client/`, then `bun install`.
- Rebuild client: delete `client/out/`, then `cd client && bun run bundle.ts dev`.
- Subtrees drifting: `bun run start.ts --status` → `--update-and-sync`.

## Releases
- SemVer; bump versions in `engine/` and `client/` as needed.
- Tag at root: `git tag -a vX.Y.Z -m "Release vX.Y.Z" && git push --tags`.
- Release notes: merged PRs, subtree updates, and any DB migrations.
