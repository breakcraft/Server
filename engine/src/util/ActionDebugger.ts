import Player from '#/engine/entity/Player.js';

// Simple per-player action-debug toggle with no persistence
const enabledPlayers = new WeakSet<Player>();

export default class ActionDebugger {
    static isEnabled(player: Player): boolean {
        return enabledPlayers.has(player);
    }

    static toggle(player: Player): boolean {
        if (enabledPlayers.has(player)) {
            enabledPlayers.delete(player);
            return false;
        }
        enabledPlayers.add(player);
        return true;
    }

    static log(player: Player, message: string): void {
        if (!this.isEnabled(player)) return;
        player.messageGame(`[debug] ${message}`);
    }
}
