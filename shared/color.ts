// Colour questions: when both end labels hold a colour code, the dial is a band
// of colour instead of numbers. The band runs 左 → 正解 → 右, with the answer's
// colour placed by how bright it is between the two ends, so the answer is
// always exactly on the band.

import { halfWidth } from "./game";

// "#BC002D", "#B02" or "rgb(188, 0, 45)" anywhere in the text. The rest of the
// text (明るい赤) is the label shown under that end of the dial.
export function parseColor(text: string): { hex: string; label: string } | null {
  const t = halfWidth(text ?? "").replace(/＃/g, "#");
  const h = /#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-z])/i.exec(t);
  if (h) {
    const d = h[1].length === 3 ? [...h[1]].map((c) => c + c).join("") : h[1];
    return { hex: `#${d.toUpperCase()}`, label: t.replace(h[0], "").trim() };
  }
  const r = /rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/i.exec(t);
  if (r) {
    const c = [r[1], r[2], r[3]].map(Number);
    if (c.every((x) => x <= 255)) return { hex: toHex(c), label: t.replace(r[0], "").trim() };
  }
  return null;
}

// Both ends' colours, or null for a numeric question.
export function colorEnds(left: string, right: string): { left: string; right: string } | null {
  const a = parseColor(left);
  const b = parseColor(right);
  return a && b ? { left: a.hex, right: b.hex } : null;
}

// What to print under an end of the dial: its words, or the code when there are none.
export function endLabel(label: string): string {
  const c = parseColor(label);
  return c ? c.label || c.hex : label;
}

function rgb(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function toHex(c: number[]): string {
  return `#${c.map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

// Perceived brightness, 0 (black) to 1 (white): OKLab's L.
export function lightness(hex: string): number {
  const [r, g, b] = rgb(hex).map((x) => {
    const v = x / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

// Where the answer's colour sits on a 0–100 band, or null when it is not
// strictly between the two ends in brightness.
export function colorPosition(left: string, right: string, answer: string): number | null {
  const a = lightness(left);
  const b = lightness(right);
  const t = lightness(answer);
  if ((t - a) * (t - b) >= 0) return null;
  return ((t - a) / (b - a)) * 100;
}

function mix(a: string, b: string, f: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * f));
}

export const BAND_STEPS = 100;

// The band as 101 colours, one per whole position 0–100. The pages draw and
// read colours from this list, so the answer's position never goes to them.
export function makeBand(left: string, right: string, answer?: { hex: string; at: number }): string[] {
  const stops = answer ? [{ p: 0, c: left }, { p: answer.at, c: answer.hex }, { p: 100, c: right }] : [{ p: 0, c: left }, { p: 100, c: right }];
  return Array.from({ length: BAND_STEPS + 1 }, (_, v) => {
    let i = 0;
    while (i < stops.length - 2 && v > stops[i + 1].p) i++;
    const a = stops[i];
    const b = stops[i + 1];
    return mix(a.c, b.c, b.p === a.p ? 0 : (v - a.p) / (b.p - a.p));
  });
}

// The colour at any position along a band (between list entries, a blend).
export function bandColor(band: string[], v: number): string {
  const x = Math.min(BAND_STEPS, Math.max(0, v));
  const i = Math.min(BAND_STEPS - 1, Math.floor(x));
  return mix(band[i], band[i + 1], x - i);
}
