import child_process from 'child_process';
import fs from 'fs';
import path from 'path';

import { ExitPromptError } from '@inquirer/core';
import { confirm, input, number, password, select } from '@inquirer/prompts';

// Subtree configuration
const subtreeRemotes = [
    { prefix: 'engine', alias: 'engine-ts', url: 'https://github.com/breakcraft/Engine-TS' },
    { prefix: 'content', alias: 'content', url: 'https://github.com/breakcraft/Content' },
    { prefix: 'client', alias: 'client-ts', url: 'https://github.com/breakcraft/Client-TS' },
    { prefix: 'javaclient', alias: 'client-java', url: 'https://github.com/breakcraft/Client-Java' }
];

function ensureRemote(alias: string, url: string) {
    try {
        child_process.execSync(`git remote get-url ${alias}`, { stdio: 'ignore' });
    } catch {
        child_process.execSync(`git remote add ${alias} ${url}`, { stdio: 'inherit' });
    }
}

function isDirEmpty(dir: string): boolean {
    try {
        const entries = fs.readdirSync(dir);
        return entries.length === 0;
    } catch {
        return true;
    }
}

function subtreePull(prefix: string, alias: string, branch: string) {
    // Fetch + subtree pull keeps subtrees up to date
    child_process.execSync(`git fetch ${alias} ${branch} --depth=1`, { stdio: 'inherit' });
    try {
        child_process.execSync(`git subtree pull --prefix=${prefix} ${alias} ${branch} --squash`, { stdio: 'inherit' });
    } catch (e) {
        // If the subtree was never added, attempt an initial add only if directory is missing or empty
        const exists = fs.existsSync(prefix);
        if (!exists || isDirEmpty(prefix)) {
            try {
                child_process.execSync(`git subtree add --prefix=${prefix} ${alias} ${branch} --squash`, { stdio: 'inherit' });
                return;
            } catch (e2) {
                throw e2;
            }
        }
        throw e;
    }
}

function runOnOs(exec: string, cwd?: string) {
    const start = (process.platform == 'darwin' ? 'open' : process.platform == 'win32' ? 'start' : 'xdg-open');

    child_process.execSync(`${start} ${exec}`, {
        stdio: 'inherit',
        cwd
    });
}

let config = {
    rev: 'unset'
};

const SERVER_REMOTE_URL = 'https://github.com/breakcraft/Server.git';

let running = true;
const POLL_INTERVAL_MS = 1500;
const DEBOUNCE_MS = 1500;
const PULL_INTERVAL_MS = 60000; // periodically sync from upstream

type Subtree = { prefix: string; alias: string; url: string };

async function chooseUpdateAction(): Promise<'commit-push' | 'stash' | 'cancel'> {
    const isTTY = !!process.stdin.isTTY && !!process.stdout.isTTY;
    if (isTTY) {
        try {
            return await select({
                message: 'Uncommitted changes detected. How should we proceed?',
                choices: [
                    { name: 'Commit & Push subtree changes, then update', value: 'commit-push' },
                    { name: 'Temporarily Stash changes, update, then reapply', value: 'stash' },
                    { name: 'Cancel', value: 'cancel' }
                ]
            }, { clearPromptOnDone: true });
        } catch {
            // fall through to numeric input fallback
        }
    }

    // Fallback for environments where interactive select may freeze
    const ans = await input({
        message: 'Uncommitted changes detected. Enter 1=Commit&Push, 2=Stash, 3=Cancel (default 2):',
        default: '2'
    }, { clearPromptOnDone: true });
    switch ((ans || '2').trim()) {
        case '1': return 'commit-push';
        case '3': return 'cancel';
        default: return 'stash';
    }
}

function hasUncommittedChanges(): boolean {
    try {
        const out = child_process.execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
        return out.length > 0;
    } catch {
        return false;
    }
}

function autoStash(message: string): boolean {
    try {
        child_process.execSync(`git stash push -u -m "${message.replace(/"/g, '\\"')}"`, { stdio: 'inherit' });
        return true;
    } catch {
        return false;
    }
}

function autoStashPop(): void {
    try {
        child_process.execSync('git stash pop', { stdio: 'inherit' });
    } catch {
        console.log('Note: Reapplying stashed changes resulted in conflicts. Please resolve and commit.');
    }
}

function listSubtreeChanges(prefix: string): string {
    try {
        return child_process.execSync(`git status --porcelain -- ${prefix}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    } catch {
        return '';
    }
}

function showSubtreeStatus(remotes: Subtree[], rev: string) {
    console.log('Subtree Status:\n');
    for (const r of remotes) {
        const exists = fs.existsSync(r.prefix);
        const empty = exists ? isDirEmpty(r.prefix) : true;
        const init = isSubtreeInitialized(r.prefix);
        const pushBranch = init ? rev : `auto/${r.prefix}/${rev}`;
        let changes = '';
        try {
            changes = child_process.execSync(`git status --porcelain -- ${r.prefix}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
        } catch {}
        console.log(`- ${r.prefix}:`);
        console.log(`  remote: ${r.alias} (${r.url})`);
        console.log(`  dir: ${exists ? (empty ? 'exists (empty)' : 'exists') : 'missing'}`);
        console.log(`  initialized: ${init ? 'yes' : 'no'}`);
        console.log(`  pull: ${init ? 'enabled' : 'skipped (not initialized)'}`);
        console.log(`  push target: ${r.alias}/${pushBranch}`);
        if (changes) {
            const lines = changes.split('\n');
            const show = lines.slice(0, 5).join('\n');
            console.log('  pending changes:');
            console.log(show + (lines.length > 5 ? '\n  ...' : ''));
        } else {
            console.log('  pending changes: none');
        }
        console.log('');
    }
}

async function commitAndPushSubtree(prefix: string, alias: string, branch: string, url: string) {
    // Check changes
    const changes = listSubtreeChanges(prefix);
    if (!changes.trim().length) {
        console.log(`No local changes detected under ${prefix}.`);
        return;
    }

    console.log(`Local changes under ${prefix} to commit:`);
    console.log(changes);

    const doCommit = await confirm({
        message: `Commit ${prefix} changes?`,
        default: true
    }, { clearPromptOnDone: true });
    if (!doCommit) return;

    const defaultMsg = `chore(${prefix}): local updates (${new Date().toISOString()})`;
    const msg = await input({
        message: 'Commit message:',
        default: defaultMsg
    }, { clearPromptOnDone: true });

    // Stage and commit only the subtree changes
    child_process.execSync(`git add -A ${prefix}`, { stdio: 'inherit' });
    try {
        child_process.execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { stdio: 'inherit' });
    } catch {
        console.log('No commit created (possibly nothing new to commit).');
    }

    // Push subtree
    ensureRemote(alias, url);
    console.log(`Pushing '${prefix}' to ${alias}/${branch}...`);
    try {
        child_process.execSync(`git subtree push --prefix=${prefix} ${alias} ${branch}`, { stdio: 'inherit' });
    } catch {
        console.log('Subtree push failed. Trying split + manual push...');
        try {
            const tempName = `subtree/${prefix}/${branch}/${Date.now()}`;
            child_process.execSync(`git subtree split --prefix=${prefix} -b ${tempName}`, { stdio: 'inherit' });
            child_process.execSync(`git push ${alias} ${tempName}:${branch}`, { stdio: 'inherit' });
            child_process.execSync(`git branch -D ${tempName}`, { stdio: 'inherit' });
        } catch {
            console.log('Manual split/push also failed. Please inspect your git history or push manually.');
        }
    }
}

function isSubtreeInitialized(prefix: string): boolean {
    try {
        const out = child_process.execSync(`git log --grep="git-subtree-dir: ${prefix}" -n 1 --pretty=format:%H`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
        return out.length > 0;
    } catch {
        return false;
    }
}

async function startAutoUpdateWatchers(remotes: Subtree[], branch: string) {
    console.log('Auto-update watchers enabled. Press Ctrl+C to stop.');
    // Ensure remotes exist
    for (const r of remotes) ensureRemote(r.alias, r.url);

    const lastStatus = new Map<string, string>();
    const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const pulling = new Set<string>();
    const initialized = new Map<string, boolean>();
    const warnedNotInit = new Set<string>();

    for (const r of remotes) {
        initialized.set(r.prefix, isSubtreeInitialized(r.prefix));
    }

    async function handleSubtree(prefix: string, alias: string, url: string) {
        if (pulling.has(prefix)) return; // skip while pulling to avoid conflicts
        let status = '';
        try {
            status = child_process.execSync(`git status --porcelain -- ${prefix}`, {
                stdio: ['ignore', 'pipe', 'ignore']
            }).toString();
        } catch {
            status = '';
        }

        const prev = lastStatus.get(prefix) || '';
        if (status === prev) return; // no change since last tick
        lastStatus.set(prefix, status);
        if (!status.trim().length) return; // clean

        // Debounce commits to batch rapid saves
        if (debounceTimers.has(prefix)) clearTimeout(debounceTimers.get(prefix)!);

        debounceTimers.set(
            prefix,
            setTimeout(async () => {
                // Re-check before committing to avoid spurious commits
                let confirmStatus = '';
                try {
                    confirmStatus = child_process.execSync(`git status --porcelain -- ${prefix}`, {
                        stdio: ['ignore', 'pipe', 'ignore']
                    }).toString();
                } catch { /* ignore */ }
                if (!confirmStatus.trim().length) return;

                const defaultMsg = `chore(${prefix}): auto-commit via watcher (${new Date().toISOString()})`;
                try {
                    child_process.execSync(`git add -A ${prefix}`, { stdio: 'inherit' });
                    child_process.execSync(`git commit -m "${defaultMsg.replace(/"/g, '\\"')}"`, { stdio: 'inherit' });
                } catch {
                    // nothing to commit
                }

                try {
                    const pushBranch = initialized.get(prefix) ? branch : `auto/${prefix}/${branch}`;
                    if (!initialized.get(prefix) && !warnedNotInit.has(prefix)) {
                        console.log(`Pushing ${prefix} changes to ${alias}/${pushBranch} (subtree not initialized).`);
                        console.log(`Open a PR from ${pushBranch} into ${branch} on ${alias} if desired.`);
                        warnedNotInit.add(prefix);
                    }
                    child_process.execSync(`git subtree push --prefix=${prefix} ${alias} ${pushBranch}`, { stdio: 'inherit' });
                } catch {
                    try {
                        const pb = initialized.get(prefix) ? branch : `auto/${prefix}/${branch}`;
                        const tempName = `subtree/${prefix}/${pb}/${Date.now()}`;
                        child_process.execSync(`git subtree split --prefix=${prefix} -b ${tempName}`, { stdio: 'inherit' });
                        child_process.execSync(`git push ${alias} ${tempName}:${pb}`, { stdio: 'inherit' });
                        child_process.execSync(`git branch -D ${tempName}`, { stdio: 'inherit' });
                    } catch {
                        console.log(`Auto-push failed for ${prefix}. You may need to push manually.`);
                    }
                }
            }, DEBOUNCE_MS)
        );
    }

    const interval: ReturnType<typeof setInterval> = setInterval(() => {
        for (const r of remotes) handleSubtree(r.prefix, r.alias, r.url);
    }, POLL_INTERVAL_MS);

    // Periodic upstream pulls with temporary stash if needed
    const pullTick = async () => {
        let stashed = false;
        if (hasUncommittedChanges()) {
            stashed = autoStash(`auto-stash before periodic subtree pull (${new Date().toISOString()})`);
        }
        try {
            for (const r of remotes) {
                if (pulling.has(r.prefix)) continue;
                pulling.add(r.prefix);
                try {
                    if (initialized.get(r.prefix)) {
                        const before = child_process.execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
                        subtreePull(r.prefix, r.alias, branch);
                        try {
                            child_process.execSync(`git commit -am "chore(${r.prefix}): merge updates from ${r.alias}/${branch}"`, { stdio: 'inherit' });
                        } catch { /* nothing to commit */ }
                        const after = child_process.execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
                        if (before !== after) {
                            let push = true;
                            try {
                                const remoteHead = child_process.execSync(`git rev-parse origin/${branch}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
                                push = remoteHead !== after;
                            } catch { /* remote branch missing */ }
                            if (push) {
                                child_process.execSync(`git push origin ${branch}`, { stdio: 'inherit' });
                            }
                        }
                    } else {
                        if (!warnedNotInit.has(r.prefix)) {
                            console.log(`Skipping periodic pull for ${r.prefix}: subtree not initialized.`);
                            warnedNotInit.add(r.prefix);
                        }
                    }
                } catch {
                    console.log(`Periodic pull failed for ${r.prefix}. You may need to resolve merges manually.`);
                } finally {
                    pulling.delete(r.prefix);
                }
            }
        } finally {
            if (stashed) {
                console.log('Reapplying stashed changes after periodic pull...');
                autoStashPop();
            }
        }
    };

    void pullTick();
    const pullInterval: ReturnType<typeof setInterval> = setInterval(() => { void pullTick(); }, PULL_INTERVAL_MS);

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    await new Promise<void>(() => {});
    clearInterval(interval);
    clearInterval(pullInterval);
}

async function handleCliArgs(): Promise<boolean> {
    const argv = process.argv.slice(2);
    if (!argv.length) return false;

    // ensure config present
    if (!fs.existsSync('server.json')) {
        await promptConfig();
    }
    config = JSON.parse(fs.readFileSync('server.json', 'utf8'));

    // Non-interactive: just show subtree status
    if (argv.includes('--status')) {
        for (const r of subtreeRemotes) ensureRemote(r.alias, r.url);
        showSubtreeStatus(subtreeRemotes as Subtree[], config.rev);
        return true;
    }

    // Non-interactive: start watchers only
    if (argv.includes('--start-watchers')) {
        for (const r of subtreeRemotes) ensureRemote(r.alias, r.url);
        await startAutoUpdateWatchers(subtreeRemotes as Subtree[], config.rev);
        return true; // foreground run
    }

    // Non-interactive: update, show status, then start watchers
    if (argv.includes('--update-and-sync') || argv.includes('--auto')) {
        // default behavior: stash dirty tree, update all subtrees, show status, start watchers
        let stashed = false;
        if (hasUncommittedChanges()) {
            stashed = autoStash(`auto-stash before CLI update-and-sync (${new Date().toISOString()})`);
        }
        try {
            for (const r of subtreeRemotes) ensureRemote(r.alias, r.url);
            for (const r of subtreeRemotes) subtreePull(r.prefix, r.alias, config.rev);
        } finally {
            if (stashed) {
                console.log('Reapplying stashed changes...');
                autoStashPop();
            }
        }
        try {
            showSubtreeStatus(subtreeRemotes as Subtree[], config.rev);
        } catch {}
        await startAutoUpdateWatchers(subtreeRemotes as Subtree[], config.rev);
        return true; // foreground run
    }

    return false;
}
async function main() {
    if (!fs.existsSync('server.json')) {
        await promptConfig();
    }

    config = JSON.parse(fs.readFileSync('server.json', 'utf8'));

    // Ensure subtree directories exist (they should, as part of this repo)
    const requiredDirs = ['engine', 'content', 'client', 'javaclient'];
    const missing = requiredDirs.filter(d => !fs.existsSync(d));
    if (missing.length) {
        console.error('Missing required directories:', missing.join(', '));
        console.error('This repository expects subtrees to be present.');
        process.exit(1);
    }

    if (!fs.existsSync('engine/.env')) {
        child_process.spawnSync('bun install', {
            shell: true,
            stdio: 'inherit',
            cwd: 'engine'
        });

        child_process.spawnSync('bun run setup', {
            shell: true,
            stdio: 'inherit',
            cwd: 'engine'
        });
    }

    const choice = await select({
        message: 'What would you like to do?',
        choices: [{
            name: 'Start Server',
            description: 'Starts the server normally',
            value: 'start'
        }, {
            name: 'Update Source',
            description: 'Pull the latest commits for all subtrees',
            value: 'update'
        }, {
            name: 'Run Web Client',
            description: 'Opens your browser to play using the modern web client (TypeScript)',
            value: 'web'
        }, {
            name: 'Run Java Client',
            description: 'Opens the legacy Java applet to play using the original client',
            value: 'java'
        }, {
            name: 'Advanced Options',
            description: 'View more options',
            value: 'advanced'
        }, {
            name: 'Quit',
            description: '',
            value: 'quit'
        }]
    }, { clearPromptOnDone: true });

    if (choice === 'start') {
        child_process.execSync('bun start', {
            stdio: 'inherit',
            cwd: 'engine'
        });
    } else if (choice === 'update') {
        // Auto-stash local changes to allow subtree pulls without failure
        let stashed = false;
        if (hasUncommittedChanges()) {
            const action = await chooseUpdateAction();

            if (action === 'cancel') {
                console.log('Update cancelled to avoid losing local changes.');
                return;
            }

            if (action === 'commit-push') {
                // For each subtree with changes, commit and push
                for (const r of subtreeRemotes) {
                    const ch = listSubtreeChanges(r.prefix);
                    if (ch.trim().length) {
                        await commitAndPushSubtree(r.prefix, r.alias, config.rev, r.url);
                    }
                }
                // If other non-subtree changes still exist, offer to stash them
                if (hasUncommittedChanges()) {
                    const doStash = await confirm({
                        message: 'Other uncommitted changes detected outside subtrees. Stash them before updating?',
                        default: true
                    }, { clearPromptOnDone: true });
                    if (doStash) {
                        stashed = autoStash(`auto-stash before subtree pull (${new Date().toISOString()})`);
                    } else {
                        console.log('Update cancelled due to remaining uncommitted changes.');
                        return;
                    }
                }
            } else if (action === 'stash') {
                stashed = autoStash(`auto-stash before subtree pull (${new Date().toISOString()})`);
            }
        }

        try {
            // Ensure remotes exist, then pull each subtree on configured branch
            for (const r of subtreeRemotes) ensureRemote(r.alias, r.url);
            for (const r of subtreeRemotes) subtreePull(r.prefix, r.alias, config.rev);
        } finally {
            if (stashed) {
                console.log('Reapplying stashed changes...');
                autoStashPop();
            }
            // Show a status summary after update completes
            try {
                showSubtreeStatus(subtreeRemotes as Subtree[], config.rev);
            } catch {}
            // After updating (and possibly reapplying stash), offer to commit+push any remaining changes
            let anyChanges = false;
            for (const r of subtreeRemotes) {
                if (listSubtreeChanges(r.prefix).trim().length) { anyChanges = true; break; }
            }
            if (anyChanges) {
                const doPush = await confirm({
                    message: 'Detected local changes in subtrees. Commit & push them now?',
                    default: true
                }, { clearPromptOnDone: true });
                if (doPush) {
                    for (const r of subtreeRemotes) {
                        const ch = listSubtreeChanges(r.prefix);
                        if (ch.trim().length) {
                            await commitAndPushSubtree(r.prefix, r.alias, config.rev, r.url);
                        }
                    }
                }
            }

            // Offer to start watchers for automatic commit+push on changes
            const enableWatch = await confirm({
                message: 'Enable file watchers to auto-commit & push subtree changes on save?',
                default: false
            }, { clearPromptOnDone: true });
            if (enableWatch) {
                running = false; // stop returning to the main menu
                await startAutoUpdateWatchers(subtreeRemotes, config.rev);
                return; // not reached unless watchers stop
            }
        }
    } else if (choice === 'web') {
        if (process.platform === 'win32' || process.platform === 'darwin') {
            runOnOs('http://localhost/rs2.cgi');
        } else {
            runOnOs('http://localhost:8888/rs2.cgi');
        }
    } else if (choice === 'java') {
        const command = process.platform === 'win32' ? 'gradlew' : './gradlew';
        if (config.rev === '225') {
            child_process.execSync(`${command} run --args="10 0 highmem members"`, {
                stdio: 'inherit',
                cwd: 'javaclient'
            });
        } else {
            child_process.execSync(`${command} run --args="10 0 highmem members 32"`, {
                stdio: 'inherit',
                cwd: 'javaclient'
            });
        }
    } else if (choice === 'advanced') {
        await promptAdvanced();
    } else if (choice === 'quit') {
        running = false;
    }
}

async function promptConfig() {
    const rev = await select({
        message: 'What version are you interested in?',
        choices: [{
            name: '225',
            description: 'May 18, 2004',
            value: '225'
        }, {
            name: '244',
            description: 'June 28, 2004',
            value: '244'
        }]
    }, { clearPromptOnDone: true });

    config.rev = rev;
    fs.writeFileSync('server.json', JSON.stringify(config, null, 2));
}

async function promptAdvanced() {
    const choice = await select({
        message: 'What would you like to do?',
        choices: [{
            name: 'Start Server (engine dev)',
            description: 'Starts the server and watches for .ts file changes to reload',
            value: 'start-dev'
        }, {
            name: 'Start Auto Sync Watchers',
            description: 'Auto-commit & push subtree changes and periodically pull from upstream',
            value: 'auto-sync'
        }, {
            name: 'Update + Start Auto Sync',
            description: 'Update subtrees now, then start auto-commit/push watchers',
            value: 'update-and-sync'
        }, {
            name: 'Show Subtree Status',
            description: 'Display init state, push target, and local changes per subtree',
            value: 'subtree-status'
        }, {
            name: 'Initialize Subtrees (advanced/unsafe)',
            description: 'Convert existing directories to real git subtrees with backups',
            value: 'init-subtrees'
        }, {
        // todo:
        //     name: 'Reconfigure Server',
        //     description: 'Edit the environment config for the server',
        //     value: 'configure'
        // }, {
            name: 'Clean-build Server',
            description: '',
            value: 'clean-build'
        }, {
            name: 'Build Web Client',
            description: '',
            value: 'build-web'
        }, {
            name: 'Build Java Client',
            description: '',
            value: 'build-java'
        }, {
            name: 'Push Subtree Changes',
            description: 'Commit local subtree changes and push upstream',
            value: 'push-subtree'
        }, {
            name: 'Change Version',
            description: '',
            value: 'change-version'
        }, {
            name: 'Back',
            description: 'Go back',
            value: 'back'
        }]
    }, { clearPromptOnDone: true });

    if (choice === 'start-dev') {
        child_process.execSync('bun run dev', {
            stdio: 'inherit',
            cwd: 'engine'
        });
    } else if (choice === 'auto-sync') {
        // Start watchers in foreground; use another terminal for dev server
        await startAutoUpdateWatchers(subtreeRemotes as Subtree[], config.rev);
    } else if (choice === 'update-and-sync') {
        // Perform the same update flow as main menu, then start watchers automatically
        let stashed = false;
        if (hasUncommittedChanges()) {
            const action = await chooseUpdateAction();

            if (action === 'cancel') return;

            if (action === 'commit-push') {
                for (const r of subtreeRemotes) {
                    const ch = listSubtreeChanges(r.prefix);
                    if (ch.trim().length) {
                        await commitAndPushSubtree(r.prefix, r.alias, config.rev, r.url);
                    }
                }
                if (hasUncommittedChanges()) {
                    const doStash = await confirm({
                        message: 'Other uncommitted changes detected outside subtrees. Stash them before updating?',
                        default: true
                    }, { clearPromptOnDone: true });
                    if (doStash) {
                        stashed = autoStash(`auto-stash before subtree pull (${new Date().toISOString()})`);
                    } else {
                        console.log('Update cancelled due to remaining uncommitted changes.');
                        return;
                    }
                }
            } else if (action === 'stash') {
                stashed = autoStash(`auto-stash before subtree pull (${new Date().toISOString()})`);
            }
        }

        try {
            for (const r of subtreeRemotes) ensureRemote(r.alias, r.url);
            for (const r of subtreeRemotes) subtreePull(r.prefix, r.alias, config.rev);
        } finally {
            if (stashed) {
                console.log('Reapplying stashed changes...');
                autoStashPop();
            }
        }

        // Immediately start watchers; keep in foreground
        running = false;
        await startAutoUpdateWatchers(subtreeRemotes as Subtree[], config.rev);
    } else if (choice === 'subtree-status') {
        // Ensure remotes exist for accurate reporting
        for (const r of subtreeRemotes) ensureRemote(r.alias, r.url);

        console.log('Subtree Status:\n');
        for (const r of subtreeRemotes) {
            const exists = fs.existsSync(r.prefix);
            const empty = exists ? isDirEmpty(r.prefix) : true;
            const init = isSubtreeInitialized(r.prefix);
            const pushBranch = init ? config.rev : `auto/${r.prefix}/${config.rev}`;
            let changes = '';
            try {
                changes = child_process.execSync(`git status --porcelain -- ${r.prefix}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
            } catch { /* ignore */ }
            console.log(`- ${r.prefix}:`);
            console.log(`  remote: ${r.alias} (${r.url})`);
            console.log(`  dir: ${exists ? (empty ? 'exists (empty)' : 'exists') : 'missing'}`);
            console.log(`  initialized: ${init ? 'yes' : 'no'}`);
            console.log(`  pull: ${init ? 'enabled' : 'skipped (not initialized)'}`);
            console.log(`  push target: ${r.alias}/${pushBranch}`);
            if (changes) {
                const lines = changes.split('\n');
                const show = lines.slice(0, 5).join('\n');
                console.log('  pending changes:');
                console.log(show + (lines.length > 5 ? '\n  ...' : ''));
            } else {
                console.log('  pending changes: none');
            }
            console.log('');
        }
    } else if (choice === 'init-subtrees') {
        // Warn user
        const proceed = await confirm({
            message: 'This will back up each subtree dir and attempt git subtree add. Proceed?',
            default: false
        }, { clearPromptOnDone: true });
        if (!proceed) return;

        // Ensure remotes
        for (const r of subtreeRemotes) ensureRemote(r.alias, r.url);

        // Option: stash repo changes to avoid conflicts
        let stashed = false;
        if (hasUncommittedChanges()) {
            const doStash = await confirm({
                message: 'Uncommitted changes detected. Temporarily stash while initializing?',
                default: true
            }, { clearPromptOnDone: true });
            if (doStash) {
                stashed = autoStash(`auto-stash before subtree initialization (${new Date().toISOString()})`);
            }
        }

        // helper: copy unique files from src->dst (skip ones that already exist)
        function copyUnique(srcDir: string, dstDir: string, copied: string[]) {
            const entries = fs.readdirSync(srcDir, { withFileTypes: true });
            for (const ent of entries) {
                if (ent.name === '.git') continue;
                const s = path.join(srcDir, ent.name);
                const d = path.join(dstDir, ent.name);
                if (ent.isDirectory()) {
                    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
                    copyUnique(s, d, copied);
                } else if (ent.isFile()) {
                    if (!fs.existsSync(d)) {
                        fs.mkdirSync(path.dirname(d), { recursive: true });
                        fs.copyFileSync(s, d);
                        copied.push(path.relative(process.cwd(), d));
                    }
                }
            }
        }

        for (const r of subtreeRemotes) {
            // Skip if already initialized
            if (isSubtreeInitialized(r.prefix)) {
                console.log(`${r.prefix}: already initialized. Skipping.`);
                continue;
            }

            // Fetch branch
            try {
                child_process.execSync(`git fetch ${r.alias} ${config.rev} --depth=1`, { stdio: 'inherit' });
            } catch {}

            const prefix = r.prefix;
            const exists = fs.existsSync(prefix);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupDir = `${prefix}.backup.${timestamp}`;

            if (exists && !isDirEmpty(prefix)) {
                console.log(`${prefix}: backing up current directory to ${backupDir} ...`);
                let renamed = false;
                try {
                    fs.renameSync(prefix, backupDir);
                    renamed = true;
                } catch (err) {
                    console.log(`${prefix}: rename failed (${(err as Error).message}). Attempting copy fallback...`);
                    // Fallback: copy entire tree, then try to clear original dir
                    const copyAll = (srcDir: string, dstDir: string) => {
                        const entries = fs.readdirSync(srcDir, { withFileTypes: true });
                        for (const ent of entries) {
                            if (ent.name === '.git') continue;
                            const s = path.join(srcDir, ent.name);
                            const d = path.join(dstDir, ent.name);
                            if (ent.isDirectory()) {
                                if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
                                copyAll(s, d);
                            } else if (ent.isFile()) {
                                fs.mkdirSync(path.dirname(d), { recursive: true });
                                fs.copyFileSync(s, d);
                            }
                        }
                    };
                    try {
                        fs.mkdirSync(backupDir, { recursive: true });
                        copyAll(prefix, backupDir);
                        console.log(`${prefix}: backup copied to ${backupDir}.`);
                        // Try to clear original directory so subtree add can proceed
                        try {
                            fs.rmSync(prefix, { recursive: true, force: true });
                            fs.mkdirSync(prefix, { recursive: true });
                            renamed = true; // treat as cleared
                        } catch (clearErr) {
                            console.log(`${prefix}: could not clear original directory (${(clearErr as Error).message}).`);
                            console.log(`Please close any process using files in '${prefix}' and rerun initialization. Backup is at ${backupDir}.`);
                            // Continue to next subtree without attempting add
                            continue;
                        }
                    } catch (copyErr) {
                        console.log(`${prefix}: backup copy failed (${(copyErr as Error).message}). Aborting initialization for this subtree.`);
                        continue;
                    }
                }
                if (!renamed) {
                    // Should not reach here; safety
                    console.log(`${prefix}: backup step did not complete. Skipping.`);
                    continue;
                }
            } else {
                // Ensure parent exists
                fs.mkdirSync(path.dirname(prefix), { recursive: true });
            }

            // Attempt subtree add
            try {
                child_process.execSync(`git subtree add --prefix=${prefix} ${r.alias} ${config.rev} --squash`, { stdio: 'inherit' });
            } catch (e) {
                console.log(`${prefix}: subtree add failed.`);
                // Restore backup if we moved it
                if (fs.existsSync(backupDir) && !fs.existsSync(prefix)) {
                    fs.renameSync(backupDir, prefix);
                }
                continue;
            }

            // Overlay any unique local files from backup (do not overwrite remote files)
            const copied: string[] = [];
            if (fs.existsSync(backupDir)) {
                console.log(`${prefix}: copying unique files from backup into subtree ...`);
                try {
                    copyUnique(backupDir, prefix, copied);
                } catch {}
            }

            // Stage and commit
            try {
                child_process.execSync(`git add -A ${prefix}`, { stdio: 'inherit' });
                const msg = `init-subtree(${prefix}): add ${r.alias}/${config.rev} (backup ${path.basename(backupDir)})`;
                child_process.execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { stdio: 'inherit' });
            } catch {}

            console.log(`${prefix}: initialized as subtree. Backup kept at ${backupDir}.`);
            if (copied.length) {
                console.log(`${prefix}: ${copied.length} unique files restored from backup.`);
            }
        }

        if (stashed) {
            console.log('Reapplying stashed changes...');
            autoStashPop();
        }
    } else if (choice === 'push-subtree') {
        // Choose which subtree to push
        const subtree = await select({
            message: 'Select a subtree to push:',
            choices: subtreeRemotes.map(r => ({ name: r.prefix, value: r.prefix }))
        }, { clearPromptOnDone: true });

        const remote = subtreeRemotes.find(r => r.prefix === subtree)!;
        ensureRemote(remote.alias, remote.url);

        // Show and (optionally) commit local changes under the subtree
        let changes = '';
        try {
            changes = child_process.execSync(`git status --porcelain -- ${subtree}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
        } catch { /* ignore */ }

        if (changes.trim().length) {
            console.log('Detected local changes under', subtree);
            console.log(changes);

            const doCommit = await confirm({
                message: `Commit these ${subtree} changes before pushing?`,
                default: true
            }, { clearPromptOnDone: true });

            if (doCommit) {
                const defaultMsg = `chore(${subtree}): local updates before subtree push (${new Date().toISOString()})`;
                const msg = await input({
                    message: 'Commit message:',
                    default: defaultMsg
                }, { clearPromptOnDone: true });

                // Stage and commit only the subtree changes
                child_process.execSync(`git add -A ${subtree}`, { stdio: 'inherit' });
                try {
                    child_process.execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { stdio: 'inherit' });
                } catch (e) {
                    console.log('No commit created (possibly nothing new to commit). Continuing...');
                }
            }
        } else {
            console.log(`No local changes detected under ${subtree}.`);
        }

        // Push subtree to its upstream remote/branch
        console.log(`Pushing '${subtree}' to ${remote.alias}/${config.rev}...`);
        try {
            child_process.execSync(`git subtree push --prefix=${subtree} ${remote.alias} ${config.rev}`, { stdio: 'inherit' });
        } catch (e) {
            // Provide a helpful hint if push fails (e.g., history too complex)
            console.log('Subtree push failed. Trying split + manual push...');
            try {
                // Create a temporary split branch and push it
                const tempName = `subtree/${subtree}/${config.rev}/${Date.now()}`;
                child_process.execSync(`git subtree split --prefix=${subtree} -b ${tempName}`, { stdio: 'inherit' });
                child_process.execSync(`git push ${remote.alias} ${tempName}:${config.rev}`, { stdio: 'inherit' });
                // Clean up temp branch locally
                child_process.execSync(`git branch -D ${tempName}`, { stdio: 'inherit' });
            } catch (e2) {
                console.log('Manual split/push also failed. Please inspect your git history or push manually.');
            }
        }
    } else if (choice === 'configure') {
        // todo: has issues with input appearing right now
        child_process.spawnSync('bun run setup', {
            shell: true,
            stdio: 'inherit',
            cwd: 'engine'
        });
    } else if (choice === 'clean-build') {
        child_process.execSync('bun run clean', {
            stdio: 'inherit',
            cwd: 'engine'
        });

        child_process.execSync('bun run build', {
            stdio: 'inherit',
            cwd: 'engine'
        });
    } else if (choice === 'build-web') {
        child_process.execSync('bun run build', {
            stdio: 'inherit',
            cwd: 'client'
        });

        // Copy built assets into the engine's public directory
        if (fs.existsSync('client/out/client.js')) {
            fs.copyFileSync('client/out/client.js', 'engine/public/client/client.js');
        }
        if (fs.existsSync('client/out/deps.js')) {
            fs.copyFileSync('client/out/deps.js', 'engine/public/client/deps.js');
        }
        // Optional extras if present
        if (fs.existsSync('client/out/mapview.js')) {
            fs.copyFileSync('client/out/mapview.js', 'engine/public/client/mapview.js');
        }
        if (fs.existsSync('client/out/bzip2.wasm')) {
            fs.copyFileSync('client/out/bzip2.wasm', 'engine/public/client/bzip2.wasm');
        }
        if (fs.existsSync('client/out/tinymidipcm.wasm')) {
            fs.copyFileSync('client/out/tinymidipcm.wasm', 'engine/public/client/tinymidipcm.wasm');
        }
    } else if (choice === 'build-java') {
        child_process.execSync('gradlew build', {
            stdio: 'inherit',
            cwd: 'javaclient'
        });
    } else if (choice === 'change-version') {
        await promptConfig();
        // Auto-stash local changes while switching versions and pulling
        let stashed = false;
        if (hasUncommittedChanges()) {
            const proceed = await confirm({
                message: 'Uncommitted changes detected. Temporarily stash and update subtrees?',
                default: true
            }, { clearPromptOnDone: true });
            if (!proceed) {
                console.log('Version change cancelled to avoid losing local changes.');
                return;
            }
            stashed = autoStash(`auto-stash before version change (${new Date().toISOString()})`);
        }

        try {
            // Update all subtrees to the selected branch
            for (const r of subtreeRemotes) ensureRemote(r.alias, r.url);
            for (const r of subtreeRemotes) subtreePull(r.prefix, r.alias, config.rev);
        } finally {
            if (stashed) {
                console.log('Reapplying stashed changes...');
                autoStashPop();
            }
        }
    }
}

ensureRemote('origin', SERVER_REMOTE_URL);

try {
    const handled = await handleCliArgs();
    if (!handled) {
        while (running) {
            await main();
        }
    }
} catch (e) {
    if (e instanceof ExitPromptError) {
        process.exit(0);
    } else if (e instanceof Error) {
        if (e.message.startsWith('Command failed:')) {
            process.exit(0);
        }

        console.log(e.message);
    }
}
