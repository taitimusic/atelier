/** 4×4 パッド。中心を叩くほど強く。打楽器や一発ものに。 */
import { useRef } from "react";
import { noteName } from "../../engine/tuning";
import { noteOff, noteOn, usePerf } from "../../input/perform";
import { useStore } from "../../state/store";
import { useActivity } from "../activity";
import { cx } from "../util";

export function Pads() {
  const low = useStore((s) => s.inst.play.low);
  const octave = usePerf((s) => s.octave);
  const voices = useActivity((s) => s.voices);
  const base = Math.max(0, Math.min(112, low + octave * 12));
  const ptr = useRef(new Map<number, number>());
  const sounding = new Set(voices.map((v) => v.note));
  return (
    <div className="pads" role="group" aria-label="パッド">
      {Array.from({ length: 16 }, (_, i) => {
        const r = 3 - Math.floor(i / 4);
        const c = i % 4;
        const n = base + r * 4 + c;
        return (
          <button
            key={i}
            className={cx("pad-btn", sounding.has(n) && "sounding")}
            onPointerDown={(e) => {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              const rc = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const dx = (e.clientX - rc.left) / rc.width - 0.5;
              const dy = (e.clientY - rc.top) / rc.height - 0.5;
              const vel = Math.max(0.25, 1 - Math.hypot(dx, dy) * 1.3);
              ptr.current.set(e.pointerId, n);
              noteOn(`pad:${e.pointerId}`, n, vel, 0);
            }}
            onPointerUp={(e) => {
              const nn = ptr.current.get(e.pointerId);
              if (nn !== undefined) noteOff(`pad:${e.pointerId}`, nn, 0);
              ptr.current.delete(e.pointerId);
            }}
            onPointerCancel={(e) => {
              const nn = ptr.current.get(e.pointerId);
              if (nn !== undefined) noteOff(`pad:${e.pointerId}`, nn, 0);
              ptr.current.delete(e.pointerId);
            }}
          >
            {noteName(n)}
          </button>
        );
      })}
    </div>
  );
}
