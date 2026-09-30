/**
 * つまみ。縦ドラッグ（Shift で微調整）・ホイール・矢印キー・ダブルクリックで既定値。
 * 変調の割当モード中は、ドラッグが「その変調源からの量」を編集する（周囲の青緑の弧）。
 * 右クリックでメニュー（既定値／ロック／変調を追加）。
 */
import { memo, useEffect, useRef, useState } from "react";
import { getN, modAmount } from "../engine/instrument";
import { structureLabel } from "../engine/modes";
import { MOD_SOURCES, PARAM_BY_ID, denorm, formatValue, isVoiceParam, norm, type ModSourceId } from "../engine/params";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../state/store";
import { clamp, cx } from "./util";

const A0 = 135;
const SWEEP = 270;

function arcPath(r: number, a0: number, a1: number): string {
  const s = Math.min(a0, a1);
  const e = Math.max(a0, a1);
  if (e - s < 0.5) return "";
  const p = (a: number) => {
    const rad = (a * Math.PI) / 180;
    return `${(Math.cos(rad) * r).toFixed(2)} ${(Math.sin(rad) * r).toFixed(2)}`;
  };
  return `M ${p(s)} A ${r} ${r} 0 ${e - s > 180 ? 1 : 0} 1 ${p(e)}`;
}

interface Props {
  id: string;
  size?: number;
  /** 表示ラベルの上書き */
  label?: string;
}

export const Knob = memo(function Knob({ id, size = 46, label }: Props) {
  const spec = PARAM_BY_ID[id];
  const n = useStore((s) => getN(s.inst, id));
  const mods = useStore(useShallow((s) => s.inst.mods.filter((m) => m.target === id)));
  const assign = useStore((s) => s.assign);
  const locked = useStore((s) => !!s.locks[id]);
  const assignAmt = useStore((s) => (s.assign ? modAmount(s.inst, s.assign, id) : 0));
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; x: number; v: number; moved: boolean } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [active, setActive] = useState(false);

  const assignable = assign && (isVoiceParam(id) || assign === "modwheel" || assign.startsWith("macro"));
  const editingMod = !!assignable;

  const setValue = (v: number) => {
    const st = useStore.getState();
    if (editingMod && st.assign) st.setMod(st.assign, id, clamp(v, -1, 1));
    else st.setParamN(id, clamp(v));
  };
  const current = () => (editingMod ? assignAmt : n);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const st = useStore.getState();
      const cur = st.assign && (isVoiceParam(id) || st.assign === "modwheel" || st.assign.startsWith("macro")) ? modAmount(st.inst, st.assign, id) : getN(st.inst, id);
      const step = (e.shiftKey ? 0.002 : 0.012) * Math.sign(-e.deltaY || e.deltaX);
      st.beginGesture();
      if (st.assign && (isVoiceParam(id) || st.assign === "modwheel" || st.assign.startsWith("macro"))) st.setMod(st.assign, id, clamp(cur + step, -1, 1));
      else st.setParamN(id, clamp(cur + step));
      clearTimeout((el as unknown as { _t?: number })._t);
      (el as unknown as { _t?: number })._t = window.setTimeout(() => useStore.getState().endGesture(), 250);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [id]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, x: e.clientX, v: current(), moved: false };
    setActive(true);
    useStore.getState().beginGesture();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dy = d.y - e.clientY + (e.clientX - d.x) * 0.5;
    if (Math.abs(dy) > 2) d.moved = true;
    const range = e.shiftKey ? 900 : 180;
    setValue(d.v + (dy / range) * (editingMod ? 2 : 1));
  };
  const onPointerUp = () => {
    drag.current = null;
    setActive(false);
    useStore.getState().endGesture();
  };
  const reset = () => {
    const st = useStore.getState();
    if (editingMod && st.assign) st.setMod(st.assign, id, 0);
    else st.setParamN(id, norm(spec, spec.def));
  };
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    let v = current();
    if (e.key === "ArrowUp" || e.key === "ArrowRight") v += step;
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") v -= step;
    else if (e.key === "Home") v = editingMod ? -1 : 0;
    else if (e.key === "End") v = 1;
    else if (e.key === "Delete" || e.key === "Backspace") {
      reset();
      e.preventDefault();
      return;
    } else return;
    e.preventDefault();
    setValue(v);
  };

  const phys = denorm(spec, n);
  const valueText = id === "structure" ? structureLabel(n) : formatValue(spec, phys);
  const r = size / 2 - 4;
  const bipolar = spec.min < 0 && spec.max > 0;
  const zeroA = bipolar ? A0 + SWEEP * norm(spec, 0) : A0;
  const valA = A0 + SWEEP * n;

  return (
    <div
      ref={ref}
      className={cx("knob", active && "active", editingMod && "assigning", locked && "locked")}
      role="slider"
      tabIndex={0}
      aria-label={`${label ?? spec.label}（${spec.en}）`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(n * 100)}
      aria-valuetext={editingMod ? `変調量 ${Math.round(assignAmt * 100)}%` : valueText}
      title={`${spec.label} / ${spec.en}\n${spec.hint}${locked ? "\n🔒 ランダム化から除外" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={reset}
      onKeyDown={onKey}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <svg width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`}>
        <path d={arcPath(r, A0, A0 + SWEEP)} className="k-track" />
        <path d={arcPath(r, zeroA, valA)} className="k-value" />
        {mods.map((m) => {
          const end = clamp(n + m.amount);
          const hl = m.source === assign;
          return <path key={m.source} d={arcPath(r + (hl ? 3.2 : 2.6), valA, A0 + SWEEP * end)} className={cx("k-mod", hl && "hl")} />;
        })}
        {editingMod && Math.abs(assignAmt) < 0.005 && <circle r={r + 3} className="k-assign-ring" />}
        <line
          x1={Math.cos((valA * Math.PI) / 180) * (r * 0.35)}
          y1={Math.sin((valA * Math.PI) / 180) * (r * 0.35)}
          x2={Math.cos((valA * Math.PI) / 180) * (r - 2)}
          y2={Math.sin((valA * Math.PI) / 180) * (r - 2)}
          className="k-pointer"
        />
      </svg>
      <div className="k-label">
        {label ?? spec.label}
        {locked && <span className="k-lock" aria-hidden="true">·</span>}
      </div>
      <div className="k-value-text">{editingMod ? `${assignAmt >= 0 ? "+" : ""}${Math.round(assignAmt * 100)}%` : valueText}</div>
      {menu && <KnobMenu id={id} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </div>
  );
});

function KnobMenu({ id, x, y, onClose }: { id: string; x: number; y: number; onClose: () => void }) {
  const st = useStore.getState();
  const spec = PARAM_BY_ID[id];
  const voice = isVoiceParam(id);
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [onClose]);
  const item = (label: string, fn: () => void, disabled = false) => (
    <button
      role="menuitem"
      disabled={disabled}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        fn();
        onClose();
      }}
    >
      {label}
    </button>
  );
  const sources = MOD_SOURCES.filter((s) => voice || s.id === "modwheel" || s.id.startsWith("macro"));
  return (
    <div className="menu" role="menu" style={{ left: Math.min(x, window.innerWidth - 230), top: Math.min(y, window.innerHeight - 360) }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="menu-title">
        {spec.label} <span>{spec.en}</span>
      </div>
      {item("値を入力…", () => {
        const cur = denorm(spec, getN(st.inst, id));
        const unit = spec.unit === "%" ? "%（0〜100）" : spec.unit ? spec.unit : "";
        const shown = spec.unit === "%" ? Math.round(getN(st.inst, id) * 100) : +cur.toPrecision(5);
        const raw = prompt(`${spec.label}（${spec.en}）\n範囲 ${spec.unit === "%" ? "0〜100" : `${spec.min}〜${spec.max}`} ${unit}`, String(shown));
        if (raw === null) return;
        const v = parseFloat(raw.replace(/[^0-9.eE+-]/g, ""));
        if (!Number.isFinite(v)) return;
        st.setParamN(id, spec.unit === "%" ? Math.max(0, Math.min(1, v / 100)) : norm(spec, v));
      })}
      {item("既定値に戻す", () => st.setParamN(id, norm(spec, spec.def)))}
      {item(st.locks[id] ? "ロックを外す" : "ロック（発見のランダム化から除外）", () => st.toggleLock(id))}
      <div className="menu-sep">変調を追加（量 +25%）</div>
      <div className="menu-grid">
        {sources.map((s) => (
          <button
            key={s.id}
            role="menuitem"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              const cur = modAmount(st.inst, s.id, id);
              st.setMod(s.id as ModSourceId, id, cur === 0 ? 0.25 : cur);
              st.setAssign(s.id as ModSourceId);
              onClose();
            }}
          >
            {s.id.startsWith("macro") ? st.inst.macros[Number(s.id.slice(5)) - 1]?.name ?? s.label : s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
