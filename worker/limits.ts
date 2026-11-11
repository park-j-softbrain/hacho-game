// In-memory limits for the game server. There is one game object for the whole
// event, so counting here is exact; the counts reset if the object goes idle
// and is evicted, which only happens when nobody is sending anything.

// Counts events per key in fixed windows (one minute by default).
export class Limiter {
  private counts = new Map<string, { start: number; n: number }>();

  constructor(
    private max: number,
    private windowMs = 60_000,
  ) {}

  // Records one event for the key; false once the key is over its limit for this window.
  hit(key: string, now = Date.now()): boolean {
    const c = this.current(key, now);
    c.n++;
    return c.n <= this.max;
  }

  // Whether the key has already used up this window, without recording anything.
  over(key: string, now = Date.now()): boolean {
    return this.current(key, now).n >= this.max;
  }

  private current(key: string, now: number) {
    let c = this.counts.get(key);
    if (!c || now - c.start >= this.windowMs) {
      if (this.counts.size > 5000) this.prune(now);
      c = { start: now, n: 0 };
      this.counts.set(key, c);
    }
    return c;
  }

  private prune(now: number) {
    for (const [key, c] of this.counts) if (now - c.start >= this.windowMs) this.counts.delete(key);
  }
}

// A token bucket for one connection's messages: up to `burst` at once, then
// `perSecond` on average.
export class Bucket {
  private tokens: number;
  private at: number;

  constructor(
    private burst: number,
    private perSecond: number,
    now = Date.now(),
  ) {
    this.tokens = burst;
    this.at = now;
  }

  take(now = Date.now()): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) / 1000) * this.perSecond);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens--;
    return true;
  }
}
