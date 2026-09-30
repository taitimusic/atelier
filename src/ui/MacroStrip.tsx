/**
 * マクロ: 1 つのつまみで複数のパラメータを同時に動かす演奏用コントロール（8 本）。
 * 「割当」を押すと他のつまみが割当モードになり、ドラッグした量だけこのマクロに結びつく。
 * MIDI CC を覚えさせることもできる。
 */
import { useState } from "react";
import { N_MACROS, type ModSourceId } from "../engine/params";
import { learnCc, useMidi } from "../input/midi";
import { getEngine } from "../state/audio";
import { useStore } from "../state/store";
import { clamp, cx } from "./util";

export function MacroStrip() {
  return (
    <div className="macros" aria-label="マクロ">
      {Array.from({ length: N_MACROS }, (_, i) => (
        <Macro key={i} index={i} />
      ))}
    </div>
  );
}

function Macro({ index }: { index: number }) {
  const m = useStore((s) => s.inst.macros[index]);
  const routes = useStore((s) => s.inst.mods.filter((r) => r.source === `macro${index + 1}`).length);
  const assign = useStore((s) => s.assign);
  const learning = useMidi((s) => s.learnMacro === index);
  const cc = useMidi((s) => Object.entries(s.ccMap).find(([, v]) => v === index)?.[0]);
  const [editing, setEditing] = useState(false);
  const src = `macro${index + 1}` as ModSourceId;
  const isAssign = assign === src;

  const set = (v: number) => {
    const c = clamp(v);
    useStore.getState().setMacro(index, c);
    getEngine()?.setMacro(index, c);
  };

  const onDown = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    useStore.getState().beginGesture();
    const upd = (x: number) => set((x - r.left) / r.width);
    upd(e.clientX);
    const mv = (ev: PointerEvent) => upd(ev.clientX);
    const up = () => {
      el.removeEventListener("pointermove", mv);
      el.removeEventListener("pointerup", up);
      useStore.getState().endGesture();
    };
    el.addEventListener("pointermove", mv);
    el.addEventListener("pointerup", up);
  };

  return (
    <div className={cx("macro", isAssign && "assigning", routes === 0 && "unused")}>
      <div className="macro-head">
        {editing ? (
          <input
            autoFocus
            defaultValue={m.name}
            maxLength={16}
            onBlur={(e) => {
              useStore.getState().renameMacro(index, e.target.value.trim());
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditing(false);
            }}
            aria-label="マクロ名"
          />
        ) : (
          <button className="macro-name" onDoubleClick={() => setEditing(true)} title="ダブルクリックで名前を変更">
            {m.name}
          </button>
        )}
      </div>
      <div
        className="macro-bar"
        role="slider"
        tabIndex={0}
        aria-label={`マクロ ${index + 1}: ${m.name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(m.value * 100)}
        onPointerDown={onDown}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.02;
          if (e.key === "ArrowRight" || e.key === "ArrowUp") set(m.value + step);
          else if (e.key === "ArrowLeft" || e.key === "ArrowDown") set(m.value - step);
          else return;
          e.preventDefault();
        }}
        onDoubleClick={() => set(0)}
      >
        <div className="macro-fill" style={{ width: `${m.value * 100}%` }} />
        <span className="macro-val">{Math.round(m.value * 100)}</span>
      </div>
      <div className="macro-foot">
        <button
          className={cx("mini", isAssign && "on")}
          onClick={() => useStore.getState().setAssign(isAssign ? null : src)}
          title="割当モード: 他のつまみをドラッグして、このマクロで動かす量を決める"
        >
          {isAssign ? "割当中" : `割当 ${routes || ""}`}
        </button>
        <button
          className={cx("mini", learning && "on")}
          onClick={() => learnCc(learning ? null : index)}
          title="MIDI Learn: 次に動かしたコントローラ（CC）をこのマクロに"
        >
          {learning ? "CC待ち…" : cc ? `CC${cc}` : "Learn"}
        </button>
      </div>
    </div>
  );
}
