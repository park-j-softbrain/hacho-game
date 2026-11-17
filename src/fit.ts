import { useLayoutEffect, useRef } from "preact/hooks";

// Keeps the projector's contents inside their boxes whatever the text: a long
// answer, prompt or team name shrinks instead of pushing the layout apart.
// Both hooks only ever shrink; the stylesheet's size is the largest anything gets.

// Shrinks the element's font until its text fits its own box: its width, or
// with "height" (text that may wrap) its height.
export function useFitText<T extends HTMLElement>(key: unknown, axis: "width" | "height" = "width", min = 0.3) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Heavy display type reaches a few pixels past its line box; text that
    // really doesn't fit is off by at least a whole line.
    const fits = () =>
      axis === "width"
        ? el.scrollWidth <= el.clientWidth + 1
        : el.scrollHeight <= el.clientHeight + parseFloat(getComputedStyle(el).fontSize) / 3;
    return watch(el, () => {
      el.style.fontSize = "";
      if (fits()) return;
      const base = parseFloat(getComputedStyle(el).fontSize);
      let lo = min;
      let hi = 1;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        el.style.fontSize = `${base * mid}px`;
        if (fits()) lo = mid;
        else hi = mid;
      }
      el.style.fontSize = `${base * lo}px`;
    });
  }, [key, axis, min]);
  return ref;
}

// The safety net for a whole column or board: when its children still don't
// fit (many tables, a long comment), zooms them all down together until they do.
export function useFitChildren<T extends HTMLElement>(key: unknown) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    return watch(el, () => {
      const kids = [...el.children] as HTMLElement[];
      for (const k of kids) k.style.zoom = "";
      let zoom = 1;
      for (let i = 0; i < 4; i++) {
        const box = el.getBoundingClientRect();
        const rects = kids.map((k) => k.getBoundingClientRect()).filter((r) => r.height > 0);
        if (!rects.length) return;
        // a child that fills the rest of the column (flex: 1) hides its overflow inside its own box
        const inner = kids.reduce((sum, k) => sum + Math.max(0, k.scrollHeight - k.clientHeight) * zoom, 0);
        const high = Math.max(...rects.map((r) => r.bottom)) - Math.min(...rects.map((r) => r.top)) + inner;
        const wide = Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left));
        const room = Math.min(box.height / high, box.width / wide);
        if (room >= 0.995) return;
        zoom *= room * 0.99;
        for (const k of kids) k.style.zoom = String(zoom);
      }
    });
  }, [key]);
  return ref;
}

// Runs fit now, when the web fonts arrive, and when the box around the element
// changes size (window resized, a neighbour grew).
function watch(el: HTMLElement, fit: () => void): () => void {
  let frame = 0;
  const later = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(fit);
  };
  fit();
  void document.fonts?.ready.then(later);
  const ro = new ResizeObserver(later);
  ro.observe(el.parentElement ?? el);
  window.addEventListener("resize", later);
  return () => {
    cancelAnimationFrame(frame);
    ro.disconnect();
    window.removeEventListener("resize", later);
  };
}
