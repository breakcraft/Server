import Packet from '#/io/Packet.js';
import ServerProtBase from '#/network/game/server/codec/ServerProtBase.js';
import OutgoingMessage from '#/network/game/server/OutgoingMessage.js';

export default abstract class MessageEncoder<T extends OutgoingMessage> {
    abstract prot: ServerProtBase;
    abstract encode(buf: Packet, message: T): void;
    test(_: T): number {
        return this.prot.length;
    }
}
