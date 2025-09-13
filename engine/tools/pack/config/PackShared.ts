import fs from 'fs';
import readline from 'readline';

import DbTableType from '#/cache/config/DbTableType.js';
import ParamType from '#/cache/config/ParamType.js';
import Jagfile from '#/io/Jagfile.js';
import Packet from '#/io/Packet.js';
import Environment from '#/util/Environment.js';
import { loadDir } from '#tools/pack/NameMap.js';
import { VarnPack, VarpPack, VarsPack, shouldBuild, CategoryPack, shouldBuildFile } from '#tools/pack/PackFile.js';
import { packDbRowConfigs, parseDbRowConfig } from '#tools/pack/config/DbRowConfig.js';
import { packDbTableConfigs, parseDbTableConfig } from '#tools/pack/config/DbTableConfig.js';
import { packEnumConfigs, parseEnumConfig } from '#tools/pack/config/EnumConfig.js';
import { packFloConfigs, parseFloConfig } from '#tools/pack/config/FloConfig.js';
import { packHuntConfigs, parseHuntConfig } from '#tools/pack/config/HuntConfig.js';
import { packIdkConfigs, parseIdkConfig } from '#tools/pack/config/IdkConfig.js';
import { packInvConfigs, parseInvConfig } from '#tools/pack/config/InvConfig.js';
import { packLocConfigs, parseLocConfig } from '#tools/pack/config/LocConfig.js';
import { packMesAnimConfigs, parseMesAnimConfig } from '#tools/pack/config/MesAnimConfig.js';
import { packNpcConfigs, parseNpcConfig } from '#tools/pack/config/NpcConfig.js';
import { packObjConfigs, parseObjConfig } from '#tools/pack/config/ObjConfig.js';
import { packParamConfigs, parseParamConfig } from '#tools/pack/config/ParamConfig.js';
import { packSeqConfigs, parseSeqConfig } from '#tools/pack/config/SeqConfig.js';
import { packSpotAnimConfigs, parseSpotAnimConfig } from '#tools/pack/config/SpotAnimConfig.js';
import { packStructConfigs, parseStructConfig } from '#tools/pack/config/StructConfig.js';
import { packVarnConfigs, parseVarnConfig } from '#tools/pack/config/VarnConfig.js';
import { packVarpConfigs, parseVarpConfig } from '#tools/pack/config/VarpConfig.js';
import { packVarsConfigs, parseVarsConfig } from '#tools/pack/config/VarsConfig.js';
import FileStream from '#/io/FileStream.js';

export function isConfigBoolean(input: string): boolean {
    return input === 'yes' || input === 'no' || input === 'true' || input === 'false' || input === '1' || input === '0';
}

export function getConfigBoolean(input: string): boolean {
    return input === 'yes' || input === 'true' || input === '1';
}

export class PackedData {
    dat: Packet;
    idx: Packet;
    size: number = 0;
    marker: number;

    constructor(size: number) {
        this.dat = Packet.alloc(5);
        this.idx = Packet.alloc(3);
        this.size = size;

        this.dat.p2(size);
        this.idx.p2(size);
        this.marker = 2;
    }

    next() {
        this.dat.p1(0);
        this.idx.p2(this.dat.pos - this.marker);
        this.marker = this.dat.pos;
    }

    p1(value: number) {
        this.dat.p1(value);
    }

    pbool(value: boolean) {
        this.dat.pbool(value);
    }

    p2(value: number) {
        this.dat.p2(value);
    }

    p3(value: number) {
        this.dat.p3(value);
    }

    p4(value: number) {
        this.dat.p4(value);
    }

    pjstr(value: string) {
        this.dat.pjstr(value);
    }
}

export const CONSTANTS = new Map<string, string>();

export function readDirTree(dirTree: Set<string>, path: string) {
    const entries = fs.readdirSync(path, { withFileTypes: true });

    for (const entry of entries) {
        const target = `${entry.parentPath}/${entry.name}`;

        if (entry.isDirectory()) {
            readDirTree(dirTree, target);
        } else {
            dirTree.add(target);
        }
    }
}

export function findFiles(dirTree: Set<string>, extension: string) {
    const results = new Set<string>();

    for (const entry of dirTree) {
        if (entry.endsWith(extension)) {
            results.add(entry);
        }
    }

    return results;
}

export function parseStepError(file: string, lineNumber: number, message: string) {
    return new Error(`\nError during parsing - see ${file}:${lineNumber + 1}\n${message}`);
}

export function packStepError(debugname: string, message: string) {
    return new Error(`\nError during packing - [${debugname}]\n${message}`);
}

export type ParamValue = {
    id: number;
    type: number;
    value: string | number | boolean;
};
export type LocModelShape = { model: number; shape: number };
export type HuntCheckInv = { inv: number; obj: number; condition: string; val: number };
export type HuntCheckInvParam = { inv: number; param: number; condition: string; val: number };
export type HuntCheckVar = { varp: number; condition: string; val: number };
export type ConfigValue = string | number | boolean | number[] | LocModelShape[] | ParamValue | HuntCheckInv | HuntCheckInvParam | HuntCheckVar;
export type ConfigLine = { key: string; value: ConfigValue };

// we're using null for invalid values, undefined for invalid keys
export type ConfigParseCallback = (key: string, value: string) => ConfigValue | null | undefined;
export type ConfigDatIdx = { client: PackedData; server: PackedData };
export type ConfigPackCallback = (configs: Map<string, ConfigLine[]>, modelFlags: number[]) => ConfigDatIdx;
export type ConfigSaveCallback = (dat: Packet, idx: Packet) => void;
export type ConfigValidateCallback = (server: Packet, client: Packet) => boolean;

export async function readConfigs(dirTree: Set<string>, extension: string, requiredProperties: string[], modelFlags: number[], parse: ConfigParseCallback, pack: ConfigPackCallback, saveClient: ConfigSaveCallback, saveServer: ConfigSaveCallback, validate?: ConfigValidateCallback) {
    const files = findFiles(dirTree, extension);

    const configs = new Map<string, ConfigLine[]>();
    for (const file of files) {
        const reader = readline.createInterface({
            input: fs.createReadStream(file)
        });

        let debugname: string | null = null;
        let config: ConfigLine[] = [];

        let lineNumber = 0;
        for await (const line of reader) {
            lineNumber++;

            if (line.length === 0 || line.startsWith('//')) {
                continue;
            }

            if (line.startsWith('[')) {
                if (!line.endsWith(']')) {
                    throw parseStepError(file, lineNumber, `Missing closing bracket: ${line}`);
                }

                if (debugname !== null) {
                    if (requiredProperties.length > 0) {
                        // check config keys against requiredProperties
                        for (let i = 0; i < requiredProperties.length; i++) {
                            if (!config.some(value => value.key === requiredProperties[i])) {
                                throw parseStepError(file, -1, `Missing required property: ${requiredProperties[i]}`);
                            }
                        }
                    }

                    configs.set(debugname, config);
                }

                debugname = line.substring(1, line.length - 1); // TODO: .toLowerCase();
                if (!debugname.length) {
                    throw parseStepError(file, lineNumber, 'No config name');
                }

                if (configs.has(debugname)) {
                    throw parseStepError(file, lineNumber, `Duplicate config found: ${debugname}`);
                }

                config = [];
                continue;
            }

            const separator = line.indexOf('=');
            if (separator === -1) {
                throw parseStepError(file, lineNumber, `Missing property separator: ${line}`);
            }

            const key = line.substring(0, separator);
            let value = line.substring(separator + 1);

            for (let i = 0; i < value.length; i++) {
                // check the value for a constant starting with ^ and ending with a \r, \n, comma, or otherwise end of string
                // then replace just that substring with CONSTANTS.get(value) if CONSTANTS.has(value) returns true

                if (value[i] === '^') {
                    const start = i;
                    let end = i + 1;

                    while (end < value.length) {
                        if (value[end] === '\r' || value[end] === '\n' || value[end] === ',' || value[end] === ' ') {
                            break;
                        }

                        end++;
                    }

                    const constant = value.substring(start + 1, end);
                    if (CONSTANTS.has(constant)) {
                        value = value.substring(0, start) + CONSTANTS.get(constant) + value.substring(end);
                    }

                    i = end;
                }
            }

            const parsed = parse(key, value);
            if (parsed === null) {
                throw parseStepError(file, lineNumber, `Invalid property value: ${line}`);
            } else if (typeof parsed === 'undefined') {
                throw parseStepError(file, lineNumber, `Invalid property key: ${line}`);
            }

            config.push({ key, value: parsed });
        }

        if (debugname !== null) {
            if (requiredProperties.length > 0) {
                // check config keys against requiredProperties
                for (let i = 0; i < requiredProperties.length; i++) {
                    if (!config.some(value => value.key === requiredProperties[i])) {
                        throw parseStepError(file, -1, `Missing required property: ${requiredProperties[i]}`);
                    }
                }
            }

            configs.set(debugname, config);
        }
    }

    const { client, server } = pack(configs, modelFlags);

    if (Environment.BUILD_VERIFY && validate && !validate(client.dat, server.dat)) {
        throw new Error(`${extension} checksum mismatch!\nYou can disable this safety check by setting BUILD_VERIFY=false`);
    }

    saveClient(client.dat, client.idx);
    saveServer(server.dat, server.idx);
}

function noOp() {}

export async function packConfigs(cache: FileStream, modelFlags: number[]) {
    CONSTANTS.clear();

    loadDir(`${Environment.BUILD_SRC_DIR}/scripts`, '.constant', src => {
        for (let i = 0; i < src.length; i++) {
            if (!src[i] || src[i].startsWith('//')) {
                continue;
            }

            const parts = src[i].split('=');

            if (parts.length !== 2) {
                throw new Error(`Bad constant declaration on line: ${src[i]}`);
            }

            let name = parts[0].trim();
            const value = parts[1].trim();

            if (name.startsWith('^')) {
                name = name.substring(1);
            }

            if (CONSTANTS.has(name)) {
                throw new Error(`Duplicate constant found: ${name}`);
            }

            CONSTANTS.set(name, value);
        }
    });

    // var domains are global, so we need to check for conflicts
    const names = new Set<string>();
    for (const [name, _id] of VarpPack.names.entries()) {
        if (names.has(name)) {
            throw new Error(`Non-unique var name found: ${name}`);
        }
        names.add(name);
    }
    for (const [name, _id] of VarnPack.names.entries()) {
        if (names.has(name)) {
            throw new Error(`Non-unique var name found: ${name}`);
        }
        names.add(name);
    }
    for (const [name, _id] of VarsPack.names.entries()) {
        if (names.has(name)) {
            throw new Error(`Non-unique var name found: ${name}`);
        }
        names.add(name);
    }

    const dirTree = new Set<string>();
    readDirTree(dirTree, `${Environment.BUILD_SRC_DIR}/scripts`);

    // We have to pack params for other configs to parse correctly
    if (shouldBuild(`${Environment.BUILD_SRC_DIR}/scripts`, '.param', 'data/pack/server/param.dat')) {
        await readConfigs(
            dirTree,
            '.param',
            ['type'],
            modelFlags,
            parseParamConfig,
            packParamConfigs,
            () => {},
            (dat: Packet, idx: Packet) => {
                dat.save('data/pack/server/param.dat');
                idx.save('data/pack/server/param.idx');
                dat.release();
                idx.release();
            }
        );
    }

    // Now that they're up to date, load them for us to use elsewhere during this process
    ParamType.load('data/pack');

    const jag = new Jagfile();

    const rebuildClient = true;
    // shouldBuild(`${Environment.BUILD_SRC_DIR}/scripts`, '.seq', 'data/pack/client/config') ||
    // shouldBuild(`${Environment.BUILD_SRC_DIR}/scripts`, '.loc', 'data/pack/client/config') ||
    // shouldBuild(`${Environment.BUILD_SRC_DIR}/scripts`, '.flo', 'data/pack/client/config') ||
    // shouldBuild(`${Environment.BUILD_SRC_DIR}/scripts`, '.spotanim', 'data/pack/client/config') ||
    // shouldBuild(`${Environment.BUILD_SRC_DIR}/scripts`, '.npc', 'data/pack/client/config') ||
    // shouldBuild(`${Environment.BUILD_SRC_DIR}/scripts`, '.obj', 'data/pack/client/config') ||
    // shouldBuild(`${Environment.BUILD_SRC_DIR}/scripts`, '.idk', 'data/pack/client/config') ||
    // shouldBuild(`${Environment.BUILD_SRC_DIR}/scripts`, '.varp', 'data/pack/client/config') ||
    // shouldBuild('tools/pack/config', '.ts', 'data/pack/client/config');

    // not a config but we want the server to know all the possible categories
    if (shouldBuildFile(`${Environment.BUILD_SRC_DIR}/pack/category.pack`, 'data/pack/server/category.dat') || shouldBuild('tools/pack/config', '.ts', 'data/pack/server/category.dat')) {
        const dat = Packet.alloc(1);
        dat.p2(CategoryPack.size);
        for (let i = 0; i < CategoryPack.size; i++) {
            dat.p1(1);
            dat.pjstr(CategoryPack.getById(i));

            dat.p1(0);
        }
        dat.save('data/pack/server/category.dat');
        dat.release();
    }

    // ----

    // todo: rebuild when any referenceable type changes
    if (
        shouldBuild(`${Environment.BUILD_SRC_DIR}/scripts`, '.dbrow', 'data/pack/server/dbrow.dat') ||
        shouldBuild('tools/pack/config', '.ts', 'data/pack/server/dbrow.dat') ||
        shouldBuild(`${Environment.BUILD_SRC_DIR}/scripts`, '.dbtable', 'data/pack/server/dbtable.dat') ||
        shouldBuild('tools/pack/config', '.ts', 'data/pack/server/dbtable.dat')
    ) {
        await readConfigs(dirTree, '.dbtable', [], modelFlags, parseDbTableConfig, packDbTableConfigs, noOp, (dat: Packet, idx: Packet) => {
            dat.save('data/pack/server/dbtable.dat');
            idx.save('data/pack/server/dbtable.idx');
            dat.release();
            idx.release();
        });

        DbTableType.load('data/pack'); // dbrow needs to access it

        await readConfigs(dirTree, '.dbrow', [], modelFlags, parseDbRowConfig, packDbRowConfigs, noOp, (dat: Packet, idx: Packet) => {
            dat.save('data/pack/server/dbrow.dat');
            idx.save('data/pack/server/dbrow.idx');
            dat.release();
            idx.release();
        });
    }

    if (shouldBuild(`${Environment.BUILD_SRC_DIR}/scripts`, '.enum', 'data/pack/server/enum.dat') || shouldBuild('tools/pack/config', '.ts', 'data/pack/server/enum.dat')) {
        await readConfigs(dirTree, '.enum', [], modelFlags, parseEnumConfig, packEnumConfigs, noOp, (dat: Packet, idx: Packet) => {
            dat.save('data/pack/server/enum.dat');
            idx.save('data/pack/server/enum.idx');
            dat.release();
            idx.release();
        });
    }

    if (shouldBuild(`${Environment.BUILD_SRC_DIR}/scripts`, '.inv', 'data/pack/server/inv.dat') || shouldBuild('tools/pack/config', '.ts', 'data/pack/server/inv.dat')) {
        await readConfigs(dirTree, '.inv', [], modelFlags, parseInvConfig, packInvConfigs, noOp, (dat: Packet, idx: Packet) => {
            dat.save('data/pack/server/inv.dat');
            idx.save('data/pack/server/inv.idx');
            dat.release();
            idx.release();
        });
    }

    if (shouldBuild(`${Environment.BUILD_SRC_DIR}/scripts`, '.mesanim', 'data/pack/server/mesanim.dat') || shouldBuild('tools/pack/config', '.ts', 'data/pack/server/mesanim.dat')) {
        await readConfigs(dirTree, '.mesanim', [], modelFlags, parseMesAnimConfig, packMesAnimConfigs, noOp, (dat: Packet, idx: Packet) => {
            dat.save('data/pack/server/mesanim.dat');
            idx.save('data/pack/server/mesanim.idx');
            dat.release();
            idx.release();
        });
    }

    if (shouldBuild(`${Environment.BUILD_SRC_DIR}/scripts`, '.struct', 'data/pack/server/struct.dat') || shouldBuild('tools/pack/config', '.ts', 'data/pack/server/struct.dat')) {
        await readConfigs(dirTree, '.struct', [], modelFlags, parseStructConfig, packStructConfigs, noOp, (dat: Packet, idx: Packet) => {
            dat.save('data/pack/server/struct.dat');
            idx.save('data/pack/server/struct.idx');
            dat.release();
            idx.release();
        });
    }

    // ----

    if (rebuildClient || shouldBuild(`${Environment.BUILD_SRC_DIR}/scripts`, '.seq', 'data/pack/server/seq.dat') || shouldBuild('tools/pack/config', '.ts', 'data/pack/server/seq.dat')) {
        await readConfigs(
            dirTree,
            '.seq',
            [],
            modelFlags,
            parseSeqConfig,
            packSeqConfigs,
            (dat: Packet, idx: Packet) => {
                jag.write('seq.dat', dat);
                jag.write('seq.idx', idx);
            },
            (dat: Packet, idx: Packet) => {
                dat.save('data/pack/server/seq.dat');
                idx.save('data/pack/server/seq.idx');
                dat.release();
                idx.release();
            },
            (client: Packet, _server: Packet): boolean => {
                return Packet.checkcrc(client.data, 0, client.pos, 1405403166);
            }
        );
    }

    if (rebuildClient || shouldBuild(`${Environment.BUILD_SRC_DIR}/scripts`, '.loc', 'data/pack/server/loc.dat') || shouldBuild('tools/pack/config', '.ts', 'data/pack/server/loc.dat')) {
        await readConfigs(
            dirTree,
            '.loc',
            [],
            modelFlags,
            parseLocConfig,
            packLocConfigs,
            (dat: Packet, idx: Packet) => {
                jag.write('loc.dat', dat);
                jag.write('loc.idx', idx);
            },
            (dat: Packet, idx: Packet) => {
                dat.save('data/pack/server/loc.dat');
                idx.save('data/pack/server/loc.idx');
                dat.release();
                idx.release();
            },
            (client: Packet, _server: Packet): boolean => {
                return Packet.checkcrc(client.data, 0, client.pos, 1195428820);
            }
        );
    }

    if (rebuildClient || shouldBuild(`${Environment.BUILD_SRC_DIR}/scripts`, '.flo', 'data/pack/server/flo.dat') || shouldBuild('tools/pack/config', '.ts', 'data/pack/server/flo.dat')) {
        await readConfigs(
            dirTree,
            '.flo',
            [],
            modelFlags,
            parseFloConfig,
            packFloConfigs,
            (dat: Packet, idx: Packet) => {
                jag.write('flo.dat', dat);
                jag.write('flo.idx', idx);
            },
            (dat: Packet, idx: Packet) => {
                dat.save('data/pack/server/flo.dat');
                idx.save('data/pack/server/flo.idx');
                dat.release();
                idx.release();
            },
            (client: Packet, _server: Packet): boolean => {
                return Packet.checkcrc(client.data, 0, client.pos, 1976597026);
            }
        );
    }

    if (rebuildClient || shouldBuild(`${Environment.BUILD_SRC_DIR}/scripts`, '.spotanim', 'data/pack/server/spotanim.dat') || shouldBuild('tools/pack/config', '.ts', 'data/pack/server/spotanim.dat')) {
        await readConfigs(
            dirTree,
            '.spotanim',
            [],
            modelFlags,
            parseSpotAnimConfig,
            packSpotAnimConfigs,
            (dat: Packet, idx: Packet) => {
                jag.write('spotanim.dat', dat);
                jag.write('spotanim.idx', idx);
            },
            (dat: Packet, idx: Packet) => {
                dat.save('data/pack/server/spotanim.dat');
                idx.save('data/pack/server/spotanim.idx');
                dat.release();
                idx.release();
            },
            (client: Packet, _server: Packet): boolean => {
                return Packet.checkcrc(client.data, 0, client.pos, 117013845);
            }
        );
    }

    if (rebuildClient || shouldBuild(`${Environment.BUILD_SRC_DIR}/scripts`, '.npc', 'data/pack/server/npc.dat') || shouldBuild('tools/pack/config', '.ts', 'data/pack/server/npc.dat')) {
        await readConfigs(
            dirTree,
            '.npc',
            [],
            modelFlags,
            parseNpcConfig,
            packNpcConfigs,
            (dat: Packet, idx: Packet) => {
                jag.write('npc.dat', dat);
                jag.write('npc.idx', idx);
            },
            (dat: Packet, idx: Packet) => {
                dat.save('data/pack/server/npc.dat');
                idx.save('data/pack/server/npc.idx');
                dat.release();
                idx.release();
            },
            (client: Packet, _server: Packet): boolean => {
                return Packet.checkcrc(client.data, 0, client.pos, -997428438);
            }
        );
    }

    if (rebuildClient || shouldBuild(`${Environment.BUILD_SRC_DIR}/scripts`, '.obj', 'data/pack/server/obj.dat') || shouldBuild('tools/pack/config', '.ts', 'data/pack/server/obj.dat')) {
        await readConfigs(
            dirTree,
            '.obj',
            [],
            modelFlags,
            parseObjConfig,
            packObjConfigs,
            (dat: Packet, idx: Packet) => {
                jag.write('obj.dat', dat);
                jag.write('obj.idx', idx);
            },
            (dat: Packet, idx: Packet) => {
                dat.save('data/pack/server/obj.dat');
                idx.save('data/pack/server/obj.idx');
                dat.release();
                idx.release();
            },
            (client: Packet, _server: Packet): boolean => {
                return Packet.checkcrc(client.data, 0, client.pos, 1589810970);
            }
        );
    }

    if (rebuildClient || shouldBuild(`${Environment.BUILD_SRC_DIR}/scripts`, '.idk', 'data/pack/server/idk.dat') || shouldBuild('tools/pack/config', '.ts', 'data/pack/server/idk.dat')) {
        await readConfigs(
            dirTree,
            '.idk',
            [],
            modelFlags,
            parseIdkConfig,
            packIdkConfigs,
            (dat: Packet, idx: Packet) => {
                jag.write('idk.dat', dat);
                jag.write('idk.idx', idx);
            },
            (dat: Packet, idx: Packet) => {
                dat.save('data/pack/server/idk.dat');
                idx.save('data/pack/server/idk.idx');
                dat.release();
                idx.release();
            },
            (client: Packet, _server: Packet): boolean => {
                return Packet.checkcrc(client.data, 0, client.pos, -359342366);
            }
        );
    }

    if (rebuildClient || shouldBuild(`${Environment.BUILD_SRC_DIR}/scripts`, '.varp', 'data/pack/server/varp.dat') || shouldBuild('tools/pack/config', '.ts', 'data/pack/server/varp.dat')) {
        await readConfigs(
            dirTree,
            '.varp',
            [],
            modelFlags,
            parseVarpConfig,
            packVarpConfigs,
            (dat: Packet, idx: Packet) => {
                jag.write('varp.dat', dat);
                jag.write('varp.idx', idx);
            },
            (dat: Packet, idx: Packet) => {
                dat.save('data/pack/server/varp.dat');
                idx.save('data/pack/server/varp.idx');
                dat.release();
                idx.release();
            },
            (client: Packet, _server: Packet): boolean => {
                return Packet.checkcrc(client.data, 0, client.pos, -1961744050);
            }
        );
    }

    if (shouldBuild(`${Environment.BUILD_SRC_DIR}/scripts`, '.hunt', 'data/pack/server/hunt.dat') || shouldBuild('tools/pack/config', '.ts', 'data/pack/server/hunt.dat')) {
        await readConfigs(dirTree, '.hunt', [], modelFlags, parseHuntConfig, packHuntConfigs, noOp, (dat: Packet, idx: Packet) => {
            dat.save('data/pack/server/hunt.dat');
            idx.save('data/pack/server/hunt.idx');
            dat.release();
            idx.release();
        });
    }

    if (shouldBuild(`${Environment.BUILD_SRC_DIR}/scripts`, '.varn', 'data/pack/server/varn.dat') || shouldBuild('tools/pack/config', '.ts', 'data/pack/server/varn.dat')) {
        await readConfigs(dirTree, '.varn', [], modelFlags, parseVarnConfig, packVarnConfigs, noOp, (dat: Packet, idx: Packet) => {
            dat.save('data/pack/server/varn.dat');
            idx.save('data/pack/server/varn.idx');
            dat.release();
            idx.release();
        });
    }

    if (shouldBuild(`${Environment.BUILD_SRC_DIR}/scripts`, '.vars', 'data/pack/server/vars.dat') || shouldBuild('tools/pack/config', '.ts', 'data/pack/server/vars.dat')) {
        await readConfigs(dirTree, '.vars', [], modelFlags, parseVarsConfig, packVarsConfigs, noOp, (dat: Packet, idx: Packet) => {
            dat.save('data/pack/server/vars.dat');
            idx.save('data/pack/server/vars.idx');
            dat.release();
            idx.release();
        });
    }

    if (rebuildClient) {
        // todo: check the CRC of config.jag as well? (as long as bz2 is identical)
        jag.save('data/pack/client/config');
    }

    cache.write(0, 2, fs.readFileSync('data/pack/client/config'));
}
