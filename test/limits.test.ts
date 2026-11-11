import { describe, expect, it } from "vitest";
import { Bucket, Limiter } from "../worker/limits";

describe("Limiter", () => {
  it("allows up to the limit per key, then refuses until the window ends", () => {
    const l = new Limiter(3, 60_000);
    expect([1, 2, 3, 4].map(() => l.hit("a", 0))).toEqual([true, true, true, false]);
    expect(l.over("a", 59_999)).toBe(true);
    expect(l.hit("b", 1000)).toBe(true); // other keys are separate
    expect(l.over("a", 60_000)).toBe(false);
    expect(l.hit("a", 60_000)).toBe(true);
  });
});

describe("Bucket", () => {
  it("allows a burst, then refills at the steady rate", () => {
    const b = new Bucket(3, 2, 0);
    expect([1, 2, 3, 4].map(() => b.take(0))).toEqual([true, true, true, false]);
    expect(b.take(400)).toBe(false); // 0.8 of a token back
    expect(b.take(500)).toBe(true); // a full one after half a second at 2/s
    expect(b.take(500)).toBe(false);
  });
});
