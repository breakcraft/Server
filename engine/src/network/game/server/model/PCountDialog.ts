import { ServerGameProtPriority } from '#/network/game/server/ServerGameProtPriority.js';
import ServerGameMessage from '#/network/game/server/ServerGameMessage.js';

export default class PCountDialog extends ServerGameMessage {
    priority = ServerGameProtPriority.BUFFERED;
}
