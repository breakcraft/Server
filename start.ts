import child_process from 'child_process';
import fs from 'fs';

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

function subtreePull(prefix: string, alias: string, branch: string) {
    // Fetch + subtree pull keeps subtrees up to date
    child_process.execSync(`git fetch ${alias} ${branch} --depth=1`, { stdio: 'inherit' });
    child_process.execSync(`git subtree pull --prefix=${prefix} ${alias} ${branch} --squash`, { stdio: 'inherit' });
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

let running = true;
const POLL_INTERVAL_MS = 1500;
const DEBOUNCE_MS = 1500;
const PULL_INTERVAL_MS = 60000; // periodically sync from upstream

type Subtree = { prefix: string; alias: string; url: string };

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

async function startAutoUpdateWatchers(remotes: Subtree[], branch: string) {
    console.log('Auto-update watchers enabled. Press Ctrl+C to stop.');
    // Ensure remotes exist
    for (const r of remotes) ensureRemote(r.alias, r.url);

    const lastStatus = new Map<string, string>();
    const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const pulling = new Set<string>();

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
                    child_process.execSync(`git subtree push --prefix=${prefix} ${alias} ${branch}`, { stdio: 'inherit' });
                } catch {
                    try {
                        const tempName = `subtree/${prefix}/${branch}/${Date.now()}`;
                        child_process.execSync(`git subtree split --prefix=${prefix} -b ${tempName}`, { stdio: 'inherit' });
                        child_process.execSync(`git push ${alias} ${tempName}:${branch}`, { stdio: 'inherit' });
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
                    subtreePull(r.prefix, r.alias, branch);
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
            const action = await select({
                message: 'Uncommitted changes detected. How should we proceed?',
                choices: [
                    { name: 'Commit & Push subtree changes, then update', value: 'commit-push' },
                    { name: 'Temporarily Stash changes, update, then reapply', value: 'stash' },
                    { name: 'Cancel', value: 'cancel' }
                ]
            }, { clearPromptOnDone: true });

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
            const action = await select({
                message: 'Uncommitted changes detected. How should we proceed?',
                choices: [
                    { name: 'Commit & Push subtree changes, then update', value: 'commit-push' },
                    { name: 'Temporarily Stash changes, update, then reapply', value: 'stash' },
                    { name: 'Cancel', value: 'cancel' }
                ]
            }, { clearPromptOnDone: true });

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

try {
    while (running) {
        await main();
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
