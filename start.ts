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
        // Ensure remotes exist, then pull each subtree on configured branch
        for (const r of subtreeRemotes) ensureRemote(r.alias, r.url);
        for (const r of subtreeRemotes) subtreePull(r.prefix, r.alias, config.rev);
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
        // Update all subtrees to the selected branch
        for (const r of subtreeRemotes) ensureRemote(r.alias, r.url);
        for (const r of subtreeRemotes) subtreePull(r.prefix, r.alias, config.rev);
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
