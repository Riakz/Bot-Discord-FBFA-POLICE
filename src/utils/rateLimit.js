export class RateLimiter {
    constructor() {
        this.limits = new Map();
        this.blocks = new Map();

        this.windowMs = 10 * 1000;
        this.maxRequests = 5;
        this.blockDurationMs = 2 * 60 * 1000;
        this.historySize = 10;
    }

    check(userId, type, detail) {
        const now = Date.now();
        let justBlocked = false;

        if (this.blocks.has(userId)) {
            const expiresAt = this.blocks.get(userId);
            if (now < expiresAt) {
                return { blocked: true, remainingMs: expiresAt - now, justBlocked: false, history: [] };
            }
            this.blocks.delete(userId);
            this.limits.delete(userId);
        }

        let data = this.limits.get(userId);
        if (!data) {
            data = { count: 0, windowStart: now, history: [] };
            this.limits.set(userId, data);
        }

        data.history.push({ type, detail, timestamp: now });
        if (data.history.length > this.historySize) {
            data.history.shift();
        }

        if (now - data.windowStart > this.windowMs) {
            data.count = 1;
            data.windowStart = now;
        } else {
            data.count++;
        }

        if (data.count > this.maxRequests) {
            const blockExpiresAt = now + this.blockDurationMs;
            this.blocks.set(userId, blockExpiresAt);
            justBlocked = true;
            return { blocked: true, remainingMs: this.blockDurationMs, justBlocked, history: [...data.history] };
        }

        return { blocked: false, remainingMs: 0, justBlocked: false, history: [] };
    }
}

export const rateLimiter = new RateLimiter();
