/**
 * 等間隔グリッド（アイソモーフィック）。どの調でも同じ指の形。微分音律でも破綻しない。
 * 押したまま横へ＝その音だけのピッチベンド、縦へ＝スライド（音色）。音ごとに別チャンネル（MPE 的）。
 */
import { useRef, useState } from "react";
import { noteLabel } from "../../engine/tuning";
import { noteOff, noteOn, usePerf } from "../../input/perform";
import { getEngine } from "../../state/audio";
import { useStore } from "../../state/store";
import { useActivity } from "../activity";
import { useSize } from "../hooks";
import { cx } from "../util";
import { ROOTS, SCALES, inScale } from "./scales";

let chSeq = 0;

export function Grid() {
  const [ref, size] = useSize<HTMLDivElement>();
  const octave = usePerf((s) => s.octave);
  const held = usePerf((s) => s.held);
  const voices = useActivity((s) => s.voices);
  const tuning = useStore((s) => s.tuning);
  const [rowStep, setRowStep] = useState(5);
  const [root, setRoot] = useState(0);
  const [scale, setScale] = useState("major");
  const pointers = useRef(new Map<number, { note: number; ch: number; x0: number; y0: number }>());
  const steps = SCALES.find((s) => s.id === scale)!.steps;
  const twelve = tuning.tuning.steps.length === 12;

  const cell = size.w < 520 ? 40 : 48;
  const cols = Math.max(6, Math.floor((size.w - 8) / cell));
  const rows = Math.max(3, Math.floor((size.h - 4) / cell));
  const base = 48 + octave * 12;
  const noteOf = (r: number, c: number) => base + c + (rows - 1 - r) * rowStep;

  const heldSet = new Set(Object.values(held));
  const sounding = new Set(voices.map((v) => v.note));

  const down = (e: React.PointerEvent) => {
    const t = (e.target as HTMLElement).closest("[data-note]") as HTMLElement | null;
    if (!t) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const note = Number(t.dataset.note);
    const ch = (chSeq++ % 15) + 1;
    const r = t.getBoundingClientRect();
    const vel = 0.35 + 0.65 * Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    pointers.current.set(e.pointerId, { note, ch, x0: e.clientX, y0: e.clientY });
    getEngine()?.bend(ch, 0);
    getEngine()?.timbre(ch, 0);
    noteOn(`grid:${e.pointerId}`, note, vel, ch);
  };
  const move = (e: React.PointerEvent) => {
    const p = pointers.current.get(e.pointerId);
    if (!p) return;
    const dx = (e.clientX - p.x0) / cell;
    const dy = (p.y0 - e.clientY) / (cell * 1.5);
    const semis = Math.abs(dx) < 0.15 ? 0 : dx - Math.sign(dx) * 0.15;
    getEngine()?.bend(p.ch, semis);
    getEngine()?.timbre(p.ch, Math.max(-1, Math.min(1, dy)));
  };
  const up = (e: React.PointerEvent) => {
    const p = pointers.current.get(e.pointerId);
    if (!p) return;
    pointers.current.delete(e.pointerId);
    noteOff(`grid:${e.pointerId}`, p.note, p.ch);
  };

  return (
    <div className="grid-wrap">
      <div className="surface-opts">
        <label>
          行の間隔
          <select value={rowStep} onChange={(e) => setRowStep(+e.target.value)}>
            <option value={3}>短三度（3）</option>
            <option value={4}>長三度（4）</option>
            <option value={5}>完全四度（5）</option>
            <option value={7}>完全五度（7）</option>
            <option value={12}>オクターブ</option>
          </select>
        </label>
        {twelve && (
          <>
            <label>
              主音
              <select value={root} onChange={(e) => setRoot(+e.target.value)}>
                {ROOTS.map((r, i) => (
                  <option key={r} value={i}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
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
          </>
        )}
        <span className="hint">押したまま横＝ベンド／縦＝スライド</span>
      </div>
      <div className="grid" ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {Array.from({ length: rows }, (_, r) =>
          Array.from({ length: cols }, (_, c) => {
            const n = noteOf(r, c);
            if (n > 127 || n < 0) return <div key={`${r}-${c}`} className="cell off" />;
            const isRoot = twelve ? (((n - root) % 12) + 12) % 12 === 0 : (n - tuning.rootNote) % tuning.tuning.steps.length === 0;
            const inS = !twelve || inScale(n, root, steps);
            return (
              <div key={`${r}-${c}`} data-note={n} className={cx("cell", isRoot && "root", !inS && "outscale", heldSet.has(n) && "held", sounding.has(n) && "sounding")} style={{ height: cell - 4 }}>
                <span>{noteLabel(n, tuning)}</span>
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}
