import fs from 'fs';

import FileStream from '#/io/FileStream.js';

export function packClientWordenc(cache: FileStream) {
    cache.write(0, 7, fs.readFileSync('data/raw/wordenc'));
}
