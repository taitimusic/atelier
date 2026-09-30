import { useEffect, useRef, useState } from "react";
import { describe, type Descriptor } from "../engine/descriptors";
import type { Instrument } from "../engine/instrument";

const cache = new WeakMap<Instrument, Descriptor>();

/** 楽器の代表記述子（中音域・ベロシティ 0.8）。楽器オブジェクト単位でキャッシュ。 */
export function descriptorOf(inst: Instrument): Descriptor {
  let d = cache.get(inst);
  if (!d) {
    d = describe(inst, Math.round((inst.play.low + inst.play.high) / 2), 0.8);
    cache.set(inst, d);
  }
  return d;
}

/** requestAnimationFrame ループ */
export function useRaf(cb: (t: number) => void, active = true): void {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    if (!active) return;
    let id = 0;
    const loop = (t: number) => {
      ref.current(t);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [active]);
}

/** 要素のサイズ追従 */
export function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}
