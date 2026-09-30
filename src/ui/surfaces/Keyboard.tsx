/**
 * 画面の鍵盤。鍵の手前ほど強く（ベロシティ）、押したまま上下で押し込み（アフタータッチ）、
 * 横に滑らせるとグリッサンド。マルチタッチ対応。
 */
import { useMemo, useRef } from "react";
import { noteLabel } from "../../engine/tuning";
import { noteOff, noteOn, usePerf } from "../../input/perform";
import { getEngine } from "../../state/audio";
import { useStore } from "../../state/store";
import { useActivity } from "../activity";
import { useSize } from "../hooks";
import { cx } from "../util";

const BLACK = new Set([1, 3, 6, 8, 10]);
const QWERTY_LABELS = ["A", "W", "S", "E", "D", "F", "T", "G", "Y", "H", "U", "J", "K", "O", "L", "P", ";"];

export function Keyboard() {
  const [ref, size] = useSize<HTMLDivElement>();
  const octave = usePerf((s) => s.octave);
  const held = usePerf((s) => s.held);
  const voices = useActivity((s) => s.voices);
  const play = useStore((s) => s.inst.play);
  const tuning = useStore((s) => s.tuning);
  const pointers = useRef(new Map<number, { note: number; y0: number }>());

  const whiteW = size.w < 520 ? 30 : 34;
  const nWhite = Math.max(7, Math.floor(size.w / whiteW));
  const startNote = useMemo(() => {
    // qwerty の C（60+oct*12）が左から 1/3 付近に来るように
    const center = 60 + octave * 12;
    const whitesBefore = Math.floor(nWhite / 3);
    let n = center;
    let w = 0;
    while (w < whitesBefore && n > 0) {
      n--;
      if (!BLACK.has(n % 12)) w++;
    }
    return n;
  }, [octave, nWhite]);

  const keys = useMemo(() => {
    const out: { note: number; black: boolean; x: number }[] = [];
    let wi = 0;
    for (let n = startNote; wi < nWhite && n < 128; n++) {
      const black = BLACK.has(n % 12);
      if (black) out.push({ note: n, black, x: wi * whiteW - whiteW * 0.3 });
      else {
        out.push({ note: n, black, x: wi * whiteW });
        wi++;
      }
    }
    return out;
  }, [startNote, nWhite, whiteW]);

  const heldSet = new Set(Object.values(held));
  const sounding = new Map<number, number>();
  for (const v of voices) sounding.set(v.note, Math.max(sounding.get(v.note) ?? 0, v.level));

  const noteAt = (x: number, y: number): { note: number; vel: number } | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const k = el?.closest("[data-note]") as HTMLElement | null;
    if (!k) return null;
    const r = k.getBoundingClientRect();
    const depth = Math.max(0, Math.min(1, (y - r.top) / r.height));
    return { note: Number(k.dataset.note), vel: 0.25 + depth * 0.75 };
  };

  const down = (e: React.PointerEvent) => {
    const hit = noteAt(e.clientX, e.clientY);
    if (!hit) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { note: hit.note, y0: e.clientY });
    noteOn(`kb:${e.pointerId}`, hit.note, hit.vel, 0);
  };
  const move = (e: React.PointerEvent) => {
    const p = pointers.current.get(e.pointerId);
    if (!p) return;
    const hit = noteAt(e.clientX, e.clientY);
    if (hit && hit.note !== p.note) {
      noteOff(`kb:${e.pointerId}`, p.note, 0);
      noteOn(`kb:${e.pointerId}`, hit.note, hit.vel, 0);
      pointers.current.set(e.pointerId, { note: hit.note, y0: e.clientY });
    } else {
      const pr = Math.max(0, Math.min(1, (e.clientY - p.y0) / 60));
      getEngine()?.pressure(0, pr, p.note);
    }
  };
  const up = (e: React.PointerEvent) => {
    const p = pointers.current.get(e.pointerId);
    if (!p) return;
    pointers.current.delete(e.pointerId);
    getEngine()?.pressure(0, 0, p.note);
    noteOff(`kb:${e.pointerId}`, p.note, 0);
  };

  const qBase = 60 + octave * 12;
  return (
    <div className="keyboard" ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} role="group" aria-label="鍵盤（PC キーボード A〜K でも演奏可）">
      {keys.map((k) => {
        const lv = sounding.get(k.note);
        const out = k.note < play.low || k.note > play.high;
        const q = k.note - qBase;
        return (
          <div
            key={k.note}
            data-note={k.note}
            className={cx("key", k.black ? "black" : "white", heldSet.has(k.note) && "held", lv !== undefined && "sounding", out && "out")}
            style={{ left: k.x, width: k.black ? whiteW * 0.6 : whiteW, ["--lv" as string]: String(Math.min(1, (lv ?? 0) * 2)) }}
            aria-label={noteLabel(k.note, tuning)}
          >
            {!k.black && k.note % 12 === 0 && <span className="key-label">{noteLabel(k.note, tuning)}</span>}
            {q >= 0 && q < QWERTY_LABELS.length && <span className="key-q">{QWERTY_LABELS[q]}</span>}
          </div>
        );
      })}
    </div>
  );
}
