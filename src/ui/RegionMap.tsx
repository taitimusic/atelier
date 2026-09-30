/**
 * 領域マップ: 楽器は音色空間の「点」ではなく「面」である、を見せる画面。
 * 横＝明るさ、縦＝持続と柔らかさ。現在の楽器が音域×強弱で覆う領域を網目で描き、
 * 弾いている音がその中のどこにいるかを光点で示す。種とマイ楽器は星として並ぶ。
 */
import { useMemo, useRef, useState } from "react";
import { coherence, describe, mapY, region, type Descriptor } from "../engine/descriptors";
import type { Instrument } from "../engine/instrument";
import { noteName } from "../engine/tuning";
import { SEEDS } from "../presets/seeds";
import { useStore } from "../state/store";
import { useActivity } from "./activity";
import { audition } from "./audition";
import { descriptorOf, useRaf, useSize } from "./hooks";
import { orbHue } from "./Orb";

const PAD = 34;

export function RegionMap() {
  const inst = useStore((s) => s.preview ?? s.inst);
  const library = useStore((s) => s.library);
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<Instrument | null>(null);

  const grid = useMemo(() => region(inst), [inst]);
  const coh = useMemo(() => coherence(grid), [grid]);
  const stars = useMemo(() => [...SEEDS, ...library].map((i) => ({ inst: i, d: descriptorOf(i), mine: !i.id.startsWith("seed:") })), [library]);

  const toXY = (d: Descriptor) => {
    const w = size.w - PAD * 2;
    const h = size.h - PAD * 2;
    return [PAD + d.brightness * w, PAD + (1 - mapY(d)) * h] as const;
  };

  useRaf(() => {
    const cv = canvasRef.current;
    if (!cv || size.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(size.w * dpr)) {
      cv.width = Math.round(size.w * dpr);
      cv.height = Math.round(size.h * dpr);
    }
    const g = cv.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.w, size.h);
    const css = getComputedStyle(cv);
    const line = css.getPropertyValue("--line").trim() || "#2a2e34";
    const dim = css.getPropertyValue("--text-faint").trim() || "#6b6862";
    const text = css.getPropertyValue("--text-dim").trim() || "#9a968f";
    const accent = css.getPropertyValue("--accent").trim() || "#e8a857";

    // 目盛り
    g.strokeStyle = line;
    g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const x = PAD + ((size.w - PAD * 2) * i) / 4;
      const y = PAD + ((size.h - PAD * 2) * i) / 4;
      g.beginPath();
      g.moveTo(x, PAD);
      g.lineTo(x, size.h - PAD);
      g.moveTo(PAD, y);
      g.lineTo(size.w - PAD, y);
      g.stroke();
    }
    g.fillStyle = dim;
    g.font = "11px var(--font-ui, system-ui)";
    g.textAlign = "left";
    g.fillText("暗い", PAD, size.h - 12);
    g.textAlign = "right";
    g.fillText("明るい →", size.w - PAD, size.h - 12);
    g.save();
    g.translate(13, size.h / 2);
    g.rotate(-Math.PI / 2);
    g.textAlign = "center";
    g.fillText("短く鋭い ←　→ 長く柔らかい", 0, 0);
    g.restore();

    // 星（種・マイ楽器）。ラベルは重ならないものだけ描く（ホバー中は必ず）
    const placed: [number, number, number, number][] = [];
    const free = (x: number, y: number, w: number, h: number) => placed.every(([a, b, c, d]) => x + w < a || a + c < x || y + h < b || b + d < y);
    for (const s of stars) {
      const [x, y] = toXY(s.d);
      const h = orbHue(s.d);
      g.beginPath();
      g.arc(x, y, s.mine ? 4.5 : 3.5, 0, Math.PI * 2);
      g.fillStyle = `hsl(${h} 60% ${s.mine ? 70 : 58}%)`;
      g.globalAlpha = 0.85;
      g.fill();
      if (s.mine) {
        g.strokeStyle = `hsl(${h} 60% 80%)`;
        g.beginPath();
        g.arc(x, y, 7.5, 0, Math.PI * 2);
        g.stroke();
      }
      g.globalAlpha = 1;
      g.textAlign = "left";
      g.font = "10.5px var(--font-ui, system-ui)";
      const label = s.inst.meta.name;
      const tw = g.measureText(label).width;
      const isHover = hover === s.inst;
      if (isHover || free(x + 6, y - 7, tw + 2, 13)) {
        placed.push([x + 6, y - 7, tw + 2, 13]);
        g.fillStyle = text;
        g.globalAlpha = isHover ? 1 : 0.6;
        g.fillText(label, x + 7, y + 3.5);
        g.globalAlpha = 1;
      }
    }

    // 現在の楽器の領域（網目）
    const pts = grid.points.map((row) => row.map(toXY));
    const hue = orbHue(descriptorOf(inst));
    g.beginPath();
    const rows = pts.length;
    const cols = pts[0].length;
    for (let k = 0; k < cols; k++) (k === 0 ? g.moveTo : g.lineTo).call(g, pts[0][k][0], pts[0][k][1]);
    for (let v = 1; v < rows; v++) g.lineTo(pts[v][cols - 1][0], pts[v][cols - 1][1]);
    for (let k = cols - 2; k >= 0; k--) g.lineTo(pts[rows - 1][k][0], pts[rows - 1][k][1]);
    for (let v = rows - 2; v > 0; v--) g.lineTo(pts[v][0][0], pts[v][0][1]);
    g.closePath();
    g.fillStyle = `hsl(${hue} 60% 55% / 0.14)`;
    g.fill();
    for (let v = 0; v < rows; v++) {
      g.beginPath();
      pts[v].forEach(([x, y], k) => (k === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
      g.strokeStyle = `hsl(${hue} 70% ${55 + v * 8}% / ${0.35 + v * 0.18})`;
      g.lineWidth = 1.2 + v * 0.4;
      g.stroke();
    }
    for (let k = 0; k < cols; k++) {
      g.beginPath();
      for (let v = 0; v < rows; v++) (v === 0 ? g.moveTo : g.lineTo).call(g, pts[v][k][0], pts[v][k][1]);
      g.strokeStyle = `hsl(${hue} 50% 70% / 0.35)`;
      g.lineWidth = 1;
      g.stroke();
    }
    g.fillStyle = text;
    g.font = "10px var(--font-mono, monospace)";
    g.textAlign = "center";
    const top = pts[rows - 1];
    g.fillText(noteName(grid.keys[0]), top[0][0], top[0][1] - 8);
    g.fillText(noteName(grid.keys[cols - 1]), top[cols - 1][0], top[cols - 1][1] - 8);

    // 弾いている音
    const voices = useActivity.getState().voices;
    for (const v of voices) {
      const d = describe(inst, v.note, v.vel);
      const [x, y] = toXY(d);
      const r = 5 + Math.min(1, v.level * 2) * 10;
      const grad = g.createRadialGradient(x, y, 0, x, y, r * 2.2);
      grad.addColorStop(0, "rgba(255,245,225,0.95)");
      grad.addColorStop(0.35, accent);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r * 2.2, 0, Math.PI * 2);
      g.fill();
    }
  });

  const hit = (e: React.PointerEvent): Instrument | null => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    let best: Instrument | null = null;
    let bd = 14;
    for (const s of stars) {
      const [x, y] = toXY(s.d);
      const dd = Math.hypot(px - x, py - y);
      if (dd < bd) {
        bd = dd;
        best = s.inst;
      }
    }
    return best;
  };

  return (
    <div className="region" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", cursor: hover ? "pointer" : "default" }}
        role="img"
        aria-label={`領域マップ。現在の楽器「${inst.meta.name}」が音域と強弱で覆う音色の広がり。同一音源性 ${Math.round(coh * 100)}`}
        onPointerMove={(e) => setHover(hit(e))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          const h = hit(e as unknown as React.PointerEvent);
          if (h) {
            useStore.getState().load(h);
            void audition(h);
          }
        }}
      />
      <div className="region-badge" title="音域・強弱を通して音色がなめらかに繋がっているか（段差があると低い）">
        <span>同一音源性</span>
        <b>{Math.round(coh * 100)}</b>
      </div>
      <div className="region-legend">網目＝この楽器が音域（横の線）と強弱（縦の線）で辿れる音色の領域。光点＝いま鳴っている音。星をクリックで読み込み。</div>
    </div>
  );
}
