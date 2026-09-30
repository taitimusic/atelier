/**
 * ブレンド・パッド: 4 つの角に楽器を置き、中の点を動かして連続的に混ぜる（ベクトル合成）。
 * 全パラメータを正規化空間で補間するので、どの位置も一つの一貫した楽器として鳴る。
 */
import { useRef, useState } from "react";
import type { Instrument } from "../engine/instrument";
import { SEEDS } from "../presets/seeds";
import { useStore } from "../state/store";
import { DRAG_MIME, findInstrument } from "./Browser";
import { descriptorOf } from "./hooks";
import { Orb, orbHue } from "./Orb";
import { autoplayEnabled, setAutoplay, startAutoplay, stopAutoplay } from "./autoplay";
import { cx } from "./util";
import { useActivityLevel } from "./activity";

const CORNER_POS = ["tl", "tr", "bl", "br"] as const;

export function BlendPad() {
  const blend = useStore((s) => s.blend);
  const inst = useStore((s) => s.inst);
  const padRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [picker, setPicker] = useState<number | null>(null);
  const [auto, setAuto] = useState(autoplayEnabled);
  const level = useActivityLevel();

  const w = [(1 - blend.x) * (1 - blend.y), blend.x * (1 - blend.y), (1 - blend.x) * blend.y, blend.x * blend.y];
  const present = blend.corners.map((c) => !!c);
  const tw = w.reduce((a, x, i) => a + (present[i] ? x : 0), 0) || 1;

  const move = (e: React.PointerEvent) => {
    const r = padRef.current!.getBoundingClientRect();
    useStore.getState().movePuck((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  };

  const hues = blend.corners.map((c) => (c ? orbHue(descriptorOf(c)) : 220));
  const bg = [
    `radial-gradient(circle at 0% 0%, hsl(${hues[0]} 45% 30% / .75), transparent 62%)`,
    `radial-gradient(circle at 100% 0%, hsl(${hues[1]} 45% 30% / .75), transparent 62%)`,
    `radial-gradient(circle at 0% 100%, hsl(${hues[2]} 45% 30% / .75), transparent 62%)`,
    `radial-gradient(circle at 100% 100%, hsl(${hues[3]} 45% 30% / .75), transparent 62%)`,
  ].join(",");

  return (
    <div className="blend">
      <div className="stage-hint">
        角に楽器を置き、点を動かして混ぜる。どの位置も「ひとつの楽器」として全音域で鳴ります。
        <label className="toggle">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => {
              setAuto(e.target.checked);
              setAutoplay(e.target.checked);
            }}
          />
          動かす間は自動で試奏
        </label>
      </div>
      <div
        className="pad"
        ref={padRef}
        style={{ background: bg }}
        tabIndex={0}
        role="slider"
        aria-label="ブレンド位置"
        aria-valuetext={blend.corners.map((c, i) => (c ? `${c.meta.name} ${Math.round((w[i] / tw) * 100)}%` : "")).filter(Boolean).join("、")}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest(".corner")) return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          dragging.current = true;
          useStore.getState().beginGesture();
          startAutoplay();
          move(e);
        }}
        onPointerMove={(e) => dragging.current && move(e)}
        onPointerUp={() => {
          if (!dragging.current) return;
          dragging.current = false;
          useStore.getState().endGesture();
          stopAutoplay();
        }}
        onPointerCancel={() => {
          dragging.current = false;
          useStore.getState().endGesture();
          stopAutoplay();
        }}
        onKeyDown={(e) => {
          const st = useStore.getState();
          const step = e.shiftKey ? 0.1 : 0.02;
          const { x, y } = st.blend;
          if (e.key === "ArrowLeft") st.movePuck(x - step, y);
          else if (e.key === "ArrowRight") st.movePuck(x + step, y);
          else if (e.key === "ArrowUp") st.movePuck(x, y - step);
          else if (e.key === "ArrowDown") st.movePuck(x, y + step);
          else return;
          e.preventDefault();
        }}
      >
        <div className="pad-grid" aria-hidden="true" />
        {blend.corners.map((c, i) => (
          <Corner key={i} index={i} inst={c} weight={present[i] ? w[i] / tw : 0} onPick={() => setPicker(picker === i ? null : i)} />
        ))}
        <div className="puck" style={{ left: `${blend.x * 100}%`, top: `${blend.y * 100}%` }} aria-hidden="true">
          <Orb d={descriptorOf(inst)} size={64} level={level} />
        </div>
        {picker !== null && <CornerPicker index={picker} onClose={() => setPicker(null)} />}
      </div>
    </div>
  );
}

function Corner({ index, inst, weight, onPick }: { index: number; inst: Instrument | null; weight: number; onPick: () => void }) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={cx("corner", CORNER_POS[index], over && "drop", !inst && "empty")}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_MIME)) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData(DRAG_MIME);
        const found = findInstrument(id);
        if (found) useStore.getState().setCorner(index, found);
      }}
    >
      <button className="corner-btn" onClick={onPick} aria-label={`角 ${index + 1}: ${inst?.meta.name ?? "空き"}（変更）`}>
        {inst ? <Orb d={descriptorOf(inst)} size={30} /> : <span className="plus">＋</span>}
        <span className="corner-name">{inst?.meta.name ?? "楽器を置く"}</span>
        {inst && <span className="corner-w">{Math.round(weight * 100)}%</span>}
      </button>
    </div>
  );
}

function CornerPicker({ index, onClose }: { index: number; onClose: () => void }) {
  const library = useStore((s) => s.library);
  const pick = (i: Instrument | null) => {
    useStore.getState().setCorner(index, i);
    onClose();
  };
  return (
    <div className={cx("picker", CORNER_POS[index])} role="dialog" aria-label="角に置く楽器" onPointerDown={(e) => e.stopPropagation()}>
      <div className="picker-head">
        <span>角 {index + 1} に置く</span>
        <button onClick={onClose} aria-label="閉じる">
          ×
        </button>
      </div>
      <button className="picker-cur" onClick={() => pick(structuredClone(useStore.getState().inst))}>
        ◎ いま鳴っている音（編集を活かして混ぜ続ける）
      </button>
      <div className="picker-list">
        {library.length > 0 && <div className="picker-sep">マイ楽器</div>}
        {library.map((l) => (
          <button key={l.id} onClick={() => pick(l)}>
            <Orb d={descriptorOf(l)} size={20} /> {l.meta.name}
          </button>
        ))}
        <div className="picker-sep">種</div>
        {SEEDS.map((l) => (
          <button key={l.id} onClick={() => pick(l)}>
            <Orb d={descriptorOf(l)} size={20} /> {l.meta.name}
          </button>
        ))}
      </div>
      <button className="picker-clear" onClick={() => pick(null)}>
        この角を空にする
      </button>
    </div>
  );
}
