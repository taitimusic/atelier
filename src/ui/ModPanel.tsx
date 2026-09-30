/**
 * 変調（モジュレーション・マトリクス）＝楽器の「対応づけ」。
 * どの演奏ジェスチャ（強さ・音高・押し込み…）が、どの音色パラメータをどれだけ動かすか。
 * これが、同じ楽器を弾いたときに辿る音色の「領域」の形を決める。
 */
import { useState } from "react";
import { MOD_SOURCES, PARAM_BY_ID, ALL_PARAMS, isVoiceParam, type ModSourceId } from "../engine/params";
import { useStore } from "../state/store";
import { Knob } from "./Knob";
import { cx } from "./util";

const BASIC = MOD_SOURCES.filter((s) => !s.id.startsWith("macro"));

export function ModPanel() {
  const inst = useStore((s) => s.inst);
  const assign = useStore((s) => s.assign);
  const st = useStore.getState;
  const [src, setSrc] = useState<ModSourceId>("velocity");
  const [tgt, setTgt] = useState("brightness");
  const srcLabel = (id: string) => (id.startsWith("macro") ? inst.macros[Number(id.slice(5)) - 1]?.name ?? id : MOD_SOURCES.find((s) => s.id === id)?.label ?? id);
  const order = new Map(MOD_SOURCES.map((s, i) => [s.id as string, i]));
  const mods = [...inst.mods].sort((a, b) => (order.get(a.source)! - order.get(b.source)!) || a.target.localeCompare(b.target));

  return (
    <>
      <section className="group">
        <h3>
          対応づけ<span>演奏 → 音色</span>
        </h3>
        <p className="note">
          変調源を選ぶと割当モードになり、つまみをドラッグした量だけ結びつきます。例: ベロシティ→硬さ で「強く弾くほど明るい」、音高→響きの長さ（−）で「高い音ほど短い」。
        </p>
        <div className="src-chips">
          {BASIC.map((s) => {
            const n = inst.mods.filter((m) => m.source === s.id).length;
            return (
              <button key={s.id} className={cx("chip", assign === s.id && "on")} title={s.hint} onClick={() => st().setAssign(assign === s.id ? null : (s.id as ModSourceId))}>
                {s.label}
                {n > 0 && <span className="count">{n}</span>}
              </button>
            );
          })}
        </div>
      </section>
      <section className="group">
        <h3>
          変調の一覧<span>{mods.length} 本</span>
        </h3>
        <div className="mod-list" role="table" aria-label="変調の一覧">
          {mods.map((m) => (
            <div key={m.source + m.target} className="mod-row" role="row">
              <span className="mod-src" role="cell">
                {srcLabel(m.source)}
              </span>
              <span className="mod-arrow" aria-hidden="true">
                →
              </span>
              <span className="mod-tgt" role="cell" title={PARAM_BY_ID[m.target]?.en}>
                {PARAM_BY_ID[m.target]?.label ?? m.target}
              </span>
              <input
                type="range"
                min={-100}
                max={100}
                value={Math.round(m.amount * 100)}
                aria-label={`${srcLabel(m.source)} から ${PARAM_BY_ID[m.target]?.label} への量`}
                onPointerDown={() => st().beginGesture()}
                onPointerUp={() => st().endGesture()}
                onChange={(e) => st().setMod(m.source, m.target, +e.target.value / 100 || 0.0001)}
              />
              <output className={cx("mod-amt", m.amount < 0 && "neg")}>
                {m.amount > 0 ? "+" : ""}
                {Math.round(m.amount * 100)}
              </output>
              <button className="x" aria-label="この変調を削除" onClick={() => st().setMod(m.source, m.target, 0)}>
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="mod-add">
          <select value={src} onChange={(e) => setSrc(e.target.value as ModSourceId)} aria-label="変調源">
            {MOD_SOURCES.map((s) => (
              <option key={s.id} value={s.id}>
                {srcLabel(s.id)}
              </option>
            ))}
          </select>
          <span aria-hidden="true">→</span>
          <select value={tgt} onChange={(e) => setTgt(e.target.value)} aria-label="変調先">
            {ALL_PARAMS.filter((p) => isVoiceParam(p.id) || src === "modwheel" || src.startsWith("macro")).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}（{p.en}）
              </option>
            ))}
          </select>
          <button className="btn small" onClick={() => st().setMod(src, tgt, 0.25)}>
            追加
          </button>
        </div>
      </section>
      <section className="group">
        <h3>
          LFO<span>全音で共有する周期</span>
        </h3>
        <div className="knobs">
          <Knob id="lfoRate" />
          <Knob id="lfoShape" />
        </div>
      </section>
      <section className="group">
        <h3>
          Mod エンベロープ<span>音ごとの時間変化</span>
        </h3>
        <div className="knobs">
          <Knob id="modAttack" />
          <Knob id="modDecay" />
          <Knob id="modSustain" />
          <Knob id="modRelease" />
        </div>
      </section>
    </>
  );
}
