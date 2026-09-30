/**
 * かき鳴らし面: 横に張った弦を指でなぞる。なぞる速さが強さになる。
 * 「和音」モードでは弦が和音の構成音に、「音階」モードではハープや箏のように音階に並ぶ。
 */
import { useEffect, useRef, useState } from "react";
import { noteName } from "../../engine/tuning";
import { noteOff, noteOn, usePerf } from "../../input/perform";
import { useSize } from "../hooks";
import { cx } from "../util";
import { ROOTS, SCALES } from "./scales";

const CHORDS: { name: string; iv: number[] }[] = [
  { name: "", iv: [0, 4, 7] },
  { name: "m", iv: [0, 3, 7] },
  { name: "7", iv: [0, 4, 7, 10] },
  { name: "M7", iv: [0, 4, 7, 11] },
  { name: "m7", iv: [0, 3, 7, 10] },
  { name: "sus4", iv: [0, 5, 7] },
  { name: "add9", iv: [0, 4, 7, 14] },
];
const DIATONIC = [
  { deg: 0, q: 0 },
  { deg: 2, q: 1 },
  { deg: 4, q: 1 },
  { deg: 5, q: 0 },
  { deg: 7, q: 0 },
  { deg: 9, q: 1 },
  { deg: 7, q: 2 },
];

function voicing(root: number, iv: number[], n: number, low: number): number[] {
  // 低い方から和音の構成音を積む（ギター的な広がり）
  const out: number[] = [];
  let base = low + ((((root - low) % 12) + 12) % 12);
  while (out.length < n) {
    for (const i of iv) {
      const x = base + (i % 12) + (i >= 12 ? 12 : 0);
      if (x >= low && !out.includes(x)) out.push(x);
      if (out.length >= n) break;
    }
    base += 12;
  }
  return out.sort((a, b) => a - b).slice(0, n);
}

export function Strum() {
  const [ref, size] = useSize<HTMLDivElement>();
  const octave = usePerf((s) => s.octave);
  const [mode, setMode] = useState<"chord" | "scale">("chord");
  const [key, setKey] = useState(0);
  const [chord, setChord] = useState({ root: 0, q: 0 });
  const [scale, setScale] = useState("hirajoshi");
  const [nStrings, setN] = useState(8);
  const [plucked, setPlucked] = useState<Record<number, number>>({});
  const last = useRef(new Map<number, { y: number; t: number }>());
  const sounding = useRef(new Map<number, number>());
  const low = 48 + octave * 12;

  const notes =
    mode === "chord"
      ? voicing(chord.root, CHORDS[chord.q].iv, nStrings, low - 5)
      : (() => {
          const st = SCALES.find((s) => s.id === scale)!.steps;
          const out: number[] = [];
          for (let o = 0; out.length < nStrings; o++) for (const s of st) if (out.length < nStrings) out.push(low + key + o * 12 + s);
          return out;
        })();

  // 和音が変わったら鳴っている弦を止める（左手のミュート）
  useEffect(() => {
    for (const [i, n] of sounding.current) noteOff(`strum:${i}`, n, 0);
    sounding.current.clear();
  }, [chord, mode, key, scale, octave]);

  const pluck = (i: number, vel: number) => {
    const n = notes[nStrings - 1 - i];
    if (n === undefined) return;
    const prev = sounding.current.get(i);
    if (prev !== undefined) noteOff(`strum:${i}`, prev, 0);
    noteOn(`strum:${i}`, n, vel, 0);
    sounding.current.set(i, n);
    setPlucked((p) => ({ ...p, [i]: (p[i] ?? 0) + 1 }));
    setTimeout(() => {
      if (sounding.current.get(i) === n) {
        noteOff(`strum:${i}`, n, 0);
        sounding.current.delete(i);
      }
    }, 4000);
  };

  const gap = size.h / nStrings;
  const stringAt = (y: number) => Math.floor(y / gap);

  const down = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - r.top;
    last.current.set(e.pointerId, { y, t: performance.now() });
    const i = stringAt(y);
    const center = (i + 0.5) * gap;
    if (Math.abs(y - center) < gap * 0.3) pluck(i, 0.7);
  };
  const move = (e: React.PointerEvent) => {
    const p = last.current.get(e.pointerId);
    if (!p) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - r.top;
    const t = performance.now();
    const speed = Math.abs(y - p.y) / Math.max(1, t - p.t);
    const vel = Math.max(0.2, Math.min(1, 0.25 + speed * 0.35));
    const a = Math.min(p.y, y);
    const b = Math.max(p.y, y);
    const idx: number[] = [];
    for (let i = 0; i < nStrings; i++) {
      const c = (i + 0.5) * gap;
      if (c > a && c <= b) idx.push(i);
    }
    if (y < p.y) idx.reverse();
    for (const i of idx) pluck(i, vel);
    last.current.set(e.pointerId, { y, t });
  };
  const up = (e: React.PointerEvent) => last.current.delete(e.pointerId);

  return (
    <div className="strum-wrap">
      <div className="surface-opts">
        <div className="seg small">
          <button className={cx(mode === "chord" && "on")} onClick={() => setMode("chord")}>
            和音
          </button>
          <button className={cx(mode === "scale" && "on")} onClick={() => setMode("scale")}>
            音階
          </button>
        </div>
        <label>
          調
          <select value={key} onChange={(e) => setKey(+e.target.value)}>
            {ROOTS.map((r, i) => (
              <option key={r} value={i}>
                {r}
              </option>
            ))}
          </select>
        </label>
        {mode === "chord" ? (
          <div className="chord-btns">
            {DIATONIC.map((d, i) => {
              const root = (key + d.deg) % 12;
              const on = chord.root === root && chord.q === d.q;
              return (
                <button key={i} className={cx("chip", on && "on")} onPointerDown={() => setChord({ root, q: d.q })}>
                  {ROOTS[root]}
                  {CHORDS[d.q].name}
                </button>
              );
            })}
            <select value={chord.q} onChange={(e) => setChord({ ...chord, q: +e.target.value })} aria-label="和音の種類">
              {CHORDS.map((c, i) => (
                <option key={i} value={i}>
                  {ROOTS[chord.root]}
                  {c.name || "（長三和音）"}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <label>
            音階
            <select value={scale} onChange={(e) => setScale(e.target.value)}>
              {SCALES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          弦
          <select value={nStrings} onChange={(e) => setN(+e.target.value)}>
            {[6, 8, 10, 13].map((n) => (
              <option key={n} value={n}>
                {n} 本
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="strum" ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} role="group" aria-label="弦をなぞって鳴らす">
        {Array.from({ length: nStrings }, (_, i) => {
          const n = notes[nStrings - 1 - i];
          return (
            <div key={i} className="string" style={{ top: (i + 0.5) * gap }}>
              <div key={plucked[i] ?? 0} className={cx("string-line", !!plucked[i] && "ring")} style={{ height: 1 + (i / nStrings) * 2.2 }} />
              <span className="string-label">{n !== undefined ? noteName(n) : ""}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
