/**
 * 発見: 今の音の近傍に 8 つの変奏を生成。言葉にできない好みへ、聴き比べで近づく。
 * 演奏の対応づけ（変調）は保ったまま音色だけを揺らすので、どの変奏も「楽器」のまま。
 */
import type { ParamGroup } from "../engine/params";
import { useStore } from "../state/store";
import { audition } from "./audition";
import { descriptorOf } from "./hooks";
import { Orb } from "./Orb";
import { cx } from "./util";

const GROUPS: { id: ParamGroup; label: string }[] = [
  { id: "exciter", label: "打つ・弾く" },
  { id: "drive", label: "擦る・吹く" },
  { id: "resonator", label: "共鳴体" },
  { id: "noise", label: "ノイズ" },
  { id: "pitch", label: "ピッチ" },
  { id: "body", label: "胴" },
  { id: "chorus", label: "コーラス" },
  { id: "reverb", label: "空間" },
];

export function Discover() {
  const d = useStore((s) => s.discover);
  const preview = useStore((s) => s.preview);
  const inst = useStore((s) => s.inst);
  const st = useStore.getState;

  return (
    <div className="discover">
      <div className="stage-hint">
        いまの音の近くに 8 つの変奏。聴いて、気に入ったら採用。採用するとその音を中心に次の世代が生まれます。ロックしたつまみ（右クリック）は変わりません。
      </div>
      <div className="disc-controls">
        <label className="disc-sigma">
          変化の大きさ
          <input
            type="range"
            min={0.02}
            max={0.45}
            step={0.01}
            value={d.sigma}
            onChange={(e) => st().regenerate({ sigma: +e.target.value, newSeed: false })}
          />
          <output>{Math.round(d.sigma * 100)}</output>
        </label>
        <button className="btn" onClick={() => st().regenerate({ sigma: Math.max(0.02, d.sigma * 0.6) })}>
          もっと似た音
        </button>
        <button className="btn" onClick={() => st().regenerate({ sigma: Math.min(0.45, d.sigma * 1.6) })}>
          もっと違う音
        </button>
        <button className="btn primary" onClick={() => st().regenerate()}>
          ↻ 作り直す
        </button>
      </div>
      <div className="chips">
        {GROUPS.map((g) => {
          const on = d.groups.includes(g.id);
          return (
            <button
              key={g.id}
              className={cx("chip", on && "on")}
              aria-pressed={on}
              onClick={() => st().regenerate({ groups: on ? d.groups.filter((x) => x !== g.id) : [...d.groups, g.id], newSeed: false })}
            >
              {g.label}
            </button>
          );
        })}
      </div>
      <div className="disc-grid">
        {d.variants.map((v, i) => (
          <div key={i} className={cx("disc-card", preview === v && "on")}>
            <button
              className="disc-play"
              onClick={() => {
                st().setPreview(v);
                void audition(v);
              }}
              aria-label={`変奏 ${i + 1} を試聴`}
            >
              <Orb d={descriptorOf(v)} size={58} />
              <span>変奏 {i + 1}</span>
            </button>
            <button
              className="btn small"
              onClick={() => {
                st().setPreview(null);
                st().commit({ ...v, id: inst.id, meta: { ...v.meta, name: inst.meta.name } });
                st().regenerate({ newSeed: true });
              }}
            >
              採用
            </button>
          </div>
        ))}
      </div>
      {preview && (
        <div className="disc-preview">
          試聴中: {preview.meta.name}（鍵盤で弾いて確かめられます）
          <button className="btn small" onClick={() => st().setPreview(null)}>
            元の音に戻す
          </button>
        </div>
      )}
    </div>
  );
}
