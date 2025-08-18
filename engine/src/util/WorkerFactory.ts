import { Worker as NodeWorker } from 'worker_threads';

import Environment from '#/util/Environment.js';

export function createWorker(filename: string): Worker | NodeWorker {
    if (Environment.STANDALONE_BUNDLE) {
        return new Worker(filename, { type: 'module' });
    } else {
        return new NodeWorker(filename);
    }
}
