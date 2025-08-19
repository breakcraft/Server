/**
 * Simple per-player action-debug toggle with no persistence.
 * Using JS to match NodeNext .js import style.
 */

/** @typedef {import('#/engine/entity/Player.js').default} Player */

/** @type {WeakSet<Player>} */
const enabledPlayers = new WeakSet();

export default class ActionDebugger {
    /**
     * @param {Player} player
     * @returns {boolean}
     */
    static isEnabled(player) {
        return enabledPlayers.has(player);
    }

    /**
     * @param {Player} player
     * @returns {boolean} true if enabled after toggle
     */
    static toggle(player) {
        if (enabledPlayers.has(player)) {
            enabledPlayers.delete(player);
            return false;
        }
        enabledPlayers.add(player);
        return true;
    }

    /**
     * @param {Player} player
     * @param {string} message
     */
    static log(player, message) {
        if (!this.isEnabled(player)) return;
        player.messageGame(`[debug] ${message}`);
    }
}
