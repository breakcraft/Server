Server CLI Usage Guide

Overview

- Orchestrates this monorepo’s subtrees (engine, content, client, javaclient).
- Provides interactive menus and non-interactive flags to update, build, and sync.
- Can auto-commit subtree changes, push to subtree remotes, periodically pull from upstream, and push the Server repo to origin.

Prerequisites

- Git, Node, Bun, and Java 17+ installed and on PATH.
- Run via `./start.sh` (macOS/Linux) or `start.bat` (Windows), or `bun run start.ts`.

Quick Commands

- Show status: `bun run start.ts --status`
- One-shot update + start watchers: `bun run start.ts --update-and-sync`
- Start watchers only: `bun run start.ts --start-watchers`
- Help: `bun run start.ts --help`

CLI Flags

- `--status`: Show per-subtree status and exit.
- `--start-watchers`: Start auto-commit/push watchers (runs in foreground).
- `--update-and-sync` (alias `--auto`): Stash if needed, update all subtrees to the configured `rev`, show status, push Server if ahead, then start watchers.
- `--origin-push`: Force-enable pushing the Server repo to `origin` after updates/commits.
- `--no-origin-push`: Disable pushing the Server repo to `origin`.
- `--poll-ms <n>`: Interval for polling local subtree changes (default 1500 ms).
- `--debounce-ms <n>`: Debounce interval for auto-commit after local changes (default 1500 ms).
- `--pull-ms <n>`: Interval for periodic upstream subtree pulls (default 60000 ms).
- `-h`, `--help`: Show brief usage.

Interactive Menu (run `bun run start.ts`)

- Start Server: Runs Engine server normally.
- Update Source: Stash/commit if necessary, pull all subtrees, show status, push Server if ahead. Optionally start watchers.
- Run Web Client: Opens the browser to the engine’s web client.
- Run Java Client: Runs the legacy Java client.
- Advanced Options:
  - Start Server (engine dev): Starts dev server with watch.
  - Start Auto Sync Watchers: Starts auto-commit/push and periodic upstream pulls.
  - Update + Start Auto Sync: Runs update flow then starts watchers.
  - Show Subtree Status: Prints per-subtree remote/init/pending changes.
  - Sync Settings: Toggle origin push and tune poll/debounce/pull intervals.
  - Initialize Subtrees (advanced/unsafe): Converts directories into true subtrees, with backups.
  - Clean-build Server: Cleans then builds the engine.
  - Build Web Client: Builds TS client and copies artifacts into engine/public.
  - Build Java Client: Builds Java client.
  - Push Subtree Changes: Commit local subtree changes and push upstream.
  - Change Version: Switches `rev` (e.g., 225 or 244) and pulls all subtrees.

Auto Sync Details

- Local-change watchers:
  - Polls each subtree path every `--poll-ms`.
  - Debounces `--debounce-ms`, then `git add -A <subtree>` and `git commit`.
  - Pushes that subtree to its remote (or `auto/<prefix>/<rev>` when not initialized).
  - Pushes the Server repo to `origin` if ahead (respects `--no-origin-push`).
- Periodic upstream pulls:
  - Every `--pull-ms`, attempts `git subtree pull` on initialized subtrees.
  - Temporarily stashes if the tree is dirty and reapplies after the pull.
  - Pushes the Server repo to `origin` if ahead.

Configuration (`server.json`)

- `rev`: Branch/tag to track on subtree remotes (e.g., `225`, `244`).
- `autoPushOrigin`: true/false to push Server to origin automatically (default: true).
- `pollIntervalMs`: Poll interval for local-change detection (default: 1500).
- `debounceMs`: Debounce interval before auto-commit (default: 1500).
- `pullIntervalMs`: Periodic upstream pull interval (default: 60000).

Examples

- Update and begin continuous syncing with custom intervals:
  `bun run start.ts --update-and-sync --poll-ms 1000 --debounce-ms 1200 --pull-ms 45000`

- Start watchers without pushing to origin:
  `bun run start.ts --start-watchers --no-origin-push`

Notes

- Pushing to `origin` requires your local branch to have permission and a configured remote; errors are logged and ignored.
- If a subtree isn’t initialized, pushes go to an `auto/<prefix>/<rev>` branch on the subtree remote.
- Use Ctrl+C to stop watchers; any temporary stashes created during periodic pulls are popped afterward.

