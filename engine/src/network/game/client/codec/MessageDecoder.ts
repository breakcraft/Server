import Packet from '#/io/Packet.js';
import ClientProtBase from '#/network/game/client/codec/ClientProtBase.js';
import IncomingMessage from '#/network/game/client/IncomingMessage.js';

export default abstract class MessageDecoder<T extends IncomingMessage> {
    abstract prot: ClientProtBase;
    abstract decode(buf: Packet, len: number): T;
}
