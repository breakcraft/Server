import Linkable from './Linkable';

export default class LinkList {
    private readonly sentinel: Linkable = new Linkable();
    private cursor: Linkable | null = null;

    constructor() {
        this.sentinel.next = this.sentinel;
        this.sentinel.prev = this.sentinel;
    }

    push(node: Linkable): void {
        if (node.prev) {
            node.unlink();
        }

        node.prev = this.sentinel.prev;
        node.next = this.sentinel;
        if (node.prev) {
            node.prev.next = node;
        }
        node.next.prev = node;
    }

    addHead(node: Linkable): void {
        if (node.prev) {
            node.unlink();
        }

        node.prev = this.sentinel;
        node.next = this.sentinel.next;
        node.prev.next = node;
        if (node.next) {
            node.next.prev = node;
        }
    }

    pop(): Linkable | null {
        const node: Linkable | null = this.sentinel.next;
        if (node === this.sentinel) {
            return null;
        }

        node?.unlink();
        return node;
    }

    head(): Linkable | null {
        const node: Linkable | null = this.sentinel.next;
        if (node === this.sentinel) {
            this.cursor = null;
            return null;
        }

        this.cursor = node?.next || null;
        return node;
    }

    tail(): Linkable | null {
        const node: Linkable | null = this.sentinel.prev;
        if (node === this.sentinel) {
            this.cursor = null;
            return null;
        }

        this.cursor = node?.prev || null;
        return node;
    }

    next(): Linkable | null {
        const node: Linkable | null = this.cursor;
        if (node === this.sentinel) {
            this.cursor = null;
            return null;
        }

        this.cursor = node?.next || null;
        return node;
    }

    prev(): Linkable | null {
        const node: Linkable | null = this.cursor;
        if (node === this.sentinel) {
            this.cursor = null;
            return null;
        }

        this.cursor = node?.prev || null;
        return node;
    }

    clear(): void {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const node: Linkable | null = this.sentinel.next;
            if (node === this.sentinel) {
                return;
            }

            node?.unlink();
        }
    }
}
