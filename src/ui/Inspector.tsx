/** 右パネル: 音の造形。全パラメータを物理的な意味ごとに並べる（段階的に開示）。 */
import { useMemo } from "react";
import { effectiveGlobals } from "../engine/instrument";
import { modeSpectrum } from "../engine/descriptors";
import { structureLabel } from "../engine/modes";
import { useStore, type PanelTab } from "../state/store";
import { Knob } from "./Knob";
import { ModPanel } from "./ModPanel";
import { PlayPanel } from "./PlayPanel";
import { cx } from "./util";

const TABS: { id: PanelTab; label: string }[] = [
  { id: "exciter", label: "励起" },
  { id: "resonator", label: "共鳴体" },
  { id: "color", label: "ピッチ" },
  { id: "space", label: "胴・空間" },
  { id: "mod", label: "変調" },
  { id: "play", label: "演奏" },
];

function Group({ title, sub, ids, children }: { title: string; sub?: string; ids: string[]; children?: React.ReactNode }) {
  return (
    <section className="group">
      <h3>
        {title}
        {sub && <span>{sub}</span>}
      </h3>
      {children}
      <div className="knobs">
        {ids.map((id) => (
          <Knob key={id} id={id} />
        ))}
      </div>
    </section>
  );
}

export function Inspector() {
  const panel = useStore((s) => s.panel);
  const assign = useStore((s) => s.assign);
  return (
    <aside className="inspector" aria-label="音の造形">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={panel === t.id} className={cx(panel === t.id && "on")} onClick={() => useStore.getState().setPanel(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {assign && <AssignBanner />}
      <div className="panel-body">
        {panel === "exciter" && (
          <>
            <Group title="打つ・弾く" sub="インパルス励起" ids={["strike", "hardness", "strikeNoise", "position"]} />
            <Group title="擦る・吹く" sub="持続駆動（弓・息）" ids={["drive", "driveColor", "breath", "grain"]} />
            <Group title="持続駆動のエンベロープ" sub="ADSR" ids={["driveAttack", "driveDecay", "driveSustain", "driveRelease"]} />
            <Group title="ノイズ層" sub="共鳴体を通らない音（響き線・擦過）" ids={["noise", "noiseDecay", "noiseFreq", "noiseQ"]} />
          </>
        )}
        {panel === "resonator" && (
          <>
            <Group title="共鳴体" sub="モード（固有振動）の構造" ids={["structure", "stiffness", "brightness", "evenModes"]}>
              <ModeView />
            </Group>
            <Group title="響き" sub="減衰" ids={["decay", "damping", "release", "spread"]} />
          </>
        )}
        {panel === "color" && (
          <>
            <Group title="ピッチ" sub="" ids={["pitchEnv", "pitchEnvTime", "fine", "drift"]} />
            <Group title="ビブラート" sub="" ids={["vibratoRate", "vibratoDepth", "vibratoDelay"]} />
            <Group title="出力" sub="ボイス" ids={["saturation", "level", "pan", "keySpread"]} />
          </>
        )}
        {panel === "space" && (
          <>
            <Group title="胴" sub="音高に依らない固定共鳴＝声色の核" ids={["bodyMix", "bodySize", "bodyF1", "bodyF2", "bodyF3", "bodyQ"]}>
              <ResponseView />
            </Group>
            <Group title="EQ" ids={["lowShelf", "midGain", "midFreq", "highShelf"]} />
            <Group title="コーラス" ids={["chorusMix", "chorusRate", "chorusDepth"]} />
            <Group title="ディレイ" ids={["delayMix", "delayTime", "delayFeedback", "delayTone"]} />
            <Group title="リバーブ" ids={["reverbMix", "reverbSize", "reverbTone", "reverbPreDelay", "width"]} />
          </>
        )}
        {panel === "mod" && <ModPanel />}
        {panel === "play" && <PlayPanel />}
      </div>
    </aside>
  );
}

function AssignBanner() {
  const assign = useStore((s) => s.assign)!;
  const name = useStore((s) => (assign.startsWith("macro") ? s.inst.macros[Number(assign.slice(5)) - 1]?.name : null));
  const labels: Record<string, string> = { velocity: "ベロシティ", key: "音高", pressure: "押し込み", timbre: "スライド", modwheel: "モッドホイール", random: "ランダム", modenv: "Mod エンベロープ", lfo: "LFO" };
  return (
    <div className="assign-banner" role="status">
      <span>
        割当モード: <b>{name ?? labels[assign] ?? assign}</b> → つまみをドラッグして変調量を決める（ダブルクリックで解除）
      </span>
      <button className="btn small" onClick={() => useStore.getState().setAssign(null)}>
        完了
      </button>
    </div>
  );
}

/** モード（部分音）の可視化: 横＝周波数比（対数）、縦＝打撃での振幅、色＝持続駆動、線の明るさ＝響きの長さ */
function ModeView() {
  const inst = useStore((s) => s.inst);
  const modes = useMemo(() => modeSpectrum(inst, 60, 0.8), [inst]);
  const W = 320;
  const H = 70;
  const xOf = (r: number) => 6 + (Math.log2(r / 0.5) / Math.log2(64 / 0.5)) * (W - 12);
  return (
    <div className="modeview">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`モード構造: ${structureLabel(inst.params.structure ?? 0)}`}>
        {[1, 2, 4, 8, 16, 32].map((r) => (
          <g key={r}>
            <line x1={xOf(r)} x2={xOf(r)} y1={0} y2={H} className="mv-grid" />
            <text x={xOf(r) + 2} y={H - 3} className="mv-label">
              {r}×
            </text>
          </g>
        ))}
        {modes.map((m, i) => {
          const x = xOf(m.ratio);
          if (x > W) return null;
          const a = Math.max(m.amp, 0.0001);
          const h = Math.max(1.5, (1 + Math.log10(a) / 3) * (H - 14));
          const dh = m.drive > 0.001 ? Math.max(1.5, (1 + Math.log10(m.drive) / 3) * (H - 14)) : 0;
          const life = Math.min(1, Math.log10(1 + m.t60 * 3) / 1.5);
          return (
            <g key={i}>
              {dh > 0 && <line x1={x + 1.2} x2={x + 1.2} y1={H - 12} y2={H - 12 - dh} className="mv-drive" />}
              <line x1={x} x2={x} y1={H - 12} y2={H - 12 - h} className="mv-mode" style={{ opacity: 0.35 + life * 0.65 }} />
            </g>
          );
        })}
      </svg>
      <div className="modeview-cap">
        <span>{structureLabel(inst.params.structure ?? 0)}</span>
        <span className="lg-mode">打撃</span>
        <span className="lg-drive">持続駆動</span>
      </div>
    </div>
  );
}

/** 胴＋EQ の周波数特性（RBJ 双二次の解析解） */
function ResponseView() {
  const inst = useStore((s) => s.inst);
  const modwheel = useStore((s) => s.modwheel);
  const path = useMemo(() => {
    const g = effectiveGlobals(inst, modwheel);
    const sr = 48000;
    const filters = [
      peaking(sr, g.bodyF1 * g.bodySize, g.bodyQ, g.bodyMix * 12),
      peaking(sr, g.bodyF2 * g.bodySize, g.bodyQ, g.bodyMix * 12),
      peaking(sr, g.bodyF3 * g.bodySize, g.bodyQ, g.bodyMix * 12 * 0.7),
      shelf(sr, 150, g.lowShelf, true),
      peaking(sr, g.midFreq, 0.9, g.midGain),
      shelf(sr, 6000, g.highShelf, false),
    ];
    const comp = -g.bodyMix * 5;
    const W = 320;
    const H = 70;
    let d = "";
    for (let x = 0; x <= W; x += 2) {
      const f = 30 * Math.pow(16000 / 30, x / W);
      let db = comp;
      for (const c of filters) db += magDb(c, f, sr);
      const y = H / 2 - (db / 24) * (H / 2);
      d += `${x === 0 ? "M" : "L"}${x} ${Math.max(1, Math.min(H - 1, y)).toFixed(1)} `;
    }
    return d;
  }, [inst, modwheel]);
  return (
    <div className="modeview">
      <svg viewBox="0 0 320 70" preserveAspectRatio="none" role="img" aria-label="胴と EQ の周波数特性">
        <line x1={0} x2={320} y1={35} y2={35} className="mv-grid" />
        {[100, 1000, 10000].map((f) => {
          const x = (Math.log(f / 30) / Math.log(16000 / 30)) * 320;
          return (
            <g key={f}>
              <line x1={x} x2={x} y1={0} y2={70} className="mv-grid" />
              <text x={x + 2} y={67} className="mv-label">
                {f >= 1000 ? `${f / 1000}k` : f}
              </text>
            </g>
          );
        })}
        <path d={path} className="mv-resp" />
      </svg>
    </div>
  );
}

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };
function peaking(sr: number, f: number, q: number, db: number): Biquad {
  const A = Math.pow(10, db / 40);
  const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
  const al = Math.sin(w) / (2 * q);
  const a0 = 1 + al / A;
  return { b0: (1 + al * A) / a0, b1: (-2 * Math.cos(w)) / a0, b2: (1 - al * A) / a0, a1: (-2 * Math.cos(w)) / a0, a2: (1 - al / A) / a0 };
}
function shelf(sr: number, f: number, db: number, low: boolean): Biquad {
  const A = Math.pow(10, db / 40);
  const w = (2 * Math.PI * f) / sr;
  const al = (Math.sin(w) / 2) * Math.SQRT2;
  const c = Math.cos(w);
  const s2 = 2 * Math.sqrt(A) * al;
  if (low) {
    const a0 = A + 1 + (A - 1) * c + s2;
    return { b0: (A * (A + 1 - (A - 1) * c + s2)) / a0, b1: (2 * A * (A - 1 - (A + 1) * c)) / a0, b2: (A * (A + 1 - (A - 1) * c - s2)) / a0, a1: (-2 * (A - 1 + (A + 1) * c)) / a0, a2: (A + 1 + (A - 1) * c - s2) / a0 };
  }
  const a0 = A + 1 - (A - 1) * c + s2;
  return { b0: (A * (A + 1 + (A - 1) * c + s2)) / a0, b1: (-2 * A * (A - 1 + (A + 1) * c)) / a0, b2: (A * (A + 1 + (A - 1) * c - s2)) / a0, a1: (2 * (A - 1 - (A + 1) * c)) / a0, a2: (A + 1 - (A - 1) * c - s2) / a0 };
}
function magDb(c: Biquad, f: number, sr: number): number {
  const w = (2 * Math.PI * f) / sr;
  const cr = Math.cos(w);
  const ci = -Math.sin(w);
  const c2r = Math.cos(2 * w);
  const c2i = -Math.sin(2 * w);
  const nr = c.b0 + c.b1 * cr + c.b2 * c2r;
  const ni = c.b1 * ci + c.b2 * c2i;
  const dr = 1 + c.a1 * cr + c.a2 * c2r;
  const di = c.a1 * ci + c.a2 * c2i;
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}
