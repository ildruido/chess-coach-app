/** Fixed-window failure counter. In memory: the server runs as one instance (see README). */
export class FailureLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** True while `key` has used up its failures for the current window. */
  blocked(key: string): boolean {
    const h = this.hits.get(key);
    if (!h) return false;
    if (h.resetAt <= this.now()) {
      this.hits.delete(key);
      return false;
    }
    return h.count >= this.max;
  }

  /** Counts an attempt up front (so parallel requests can't slip past); false when already blocked. */
  reserve(key: string): boolean {
    if (this.blocked(key)) return false;
    this.fail(key);
    return true;
  }

  /** Gives one counted attempt back, after a success. */
  refund(key: string): void {
    const h = this.hits.get(key);
    if (!h) return;
    h.count -= 1;
    if (h.count <= 0) this.hits.delete(key);
  }

  fail(key: string): void {
    const now = this.now();
    const h = this.hits.get(key);
    if (!h || h.resetAt <= now) {
      if (this.hits.size > 10_000) this.sweep(now);
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
    } else {
      h.count += 1;
    }
  }

  clear(key: string): void {
    this.hits.delete(key);
  }

  private sweep(now: number): void {
    for (const [k, h] of this.hits) if (h.resetAt <= now) this.hits.delete(k);
  }
}
