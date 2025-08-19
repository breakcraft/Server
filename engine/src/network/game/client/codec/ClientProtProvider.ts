import ClientProtBase from '#/network/game/client/codec/ClientProtBase.js';
import ClientProtRepository from '#/network/game/client/codec/ClientProtRepository.js';
import ClientProt244 from '#/network/game/client/codec/rs244/ClientProt244.js';
import ClientProtRepository244 from '#/network/game/client/codec/rs244/ClientProtRepository244.js';

class ClientProtProvider {
    ClientProt: typeof ClientProtBase;
    ClientProtRepository: ClientProtRepository;

    constructor() {
        this.ClientProt = ClientProt244;
        this.ClientProtRepository = new ClientProtRepository244();
    }
}

export default new ClientProtProvider();
