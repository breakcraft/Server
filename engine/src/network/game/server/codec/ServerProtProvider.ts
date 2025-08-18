import ServerProt244 from '#/network/game/server/codec/rs244/ServerProt244.js';
import ServerProtRepository244 from '#/network/game/server/codec/rs244/ServerProtRepository244.js';
import ServerProtBase from '#/network/game/server/codec/ServerProtBase.js';
import ServerProtRepository from '#/network/game/server/codec/ServerProtRepository.js';

class ServerProtProvider {
    ServerProt: typeof ServerProtBase;
    ServerProtRepository: ServerProtRepository;

    constructor() {
        this.ServerProt = ServerProt244;
        this.ServerProtRepository = new ServerProtRepository244();
    }
}

export default new ServerProtProvider();
