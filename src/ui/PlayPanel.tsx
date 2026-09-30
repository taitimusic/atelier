/** 演奏設定・調律・MIDI・楽器情報 */
import { CATEGORIES } from "../engine/instrument";
import { BUILTIN_TUNINGS, noteName, parseScala, type Tuning } from "../engine/tuning";
import { enableMidi, useMidi } from "../input/midi";
import { useStore } from "../state/store";
import { pickFile } from "./util";
import { useState } from "react";

const NOTES = Array.from({ length: 128 }, (_, i) => i);

export function PlayPanel() {
  const play = useStore((s) => s.inst.play);
  const meta = useStore((s) => s.inst.meta);
  const tuning = useStore((s) => s.tuning);
  const hasTuning = useStore((s) => !!s.inst.tuning);
  const midi = useMidi();
  const st = useStore.getState;
  const [custom, setCustom] = useState<Tuning[]>([]);
  const tunings = [...BUILTIN_TUNINGS, ...custom.filter((c) => !BUILTIN_TUNINGS.some((b) => b.id === c.id))];
  if (!tunings.some((t) => t.id === tuning.tuning.id)) tunings.push(tuning.tuning);

  return (
    <>
      <section className="group">
        <h3>演奏</h3>
        <div className="form">
          <label>
            同時発音数
            <input type="number" min={1} max={16} value={play.polyphony} onChange={(e) => st().setPlay({ polyphony: Math.max(1, Math.min(16, +e.target.value || 1)) })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={play.mono} onChange={(e) => st().setPlay({ mono: e.target.checked })} />
            単音（モノ）
          </label>
          <label className="check">
            <input type="checkbox" checked={play.legato} disabled={!play.mono} onChange={(e) => st().setPlay({ legato: e.target.checked })} />
            レガート（つなぐと打ち直さない）
          </label>
          <label>
            グライド
            <input type="range" min={0} max={1} step={0.01} value={play.glide} onChange={(e) => st().setPlay({ glide: +e.target.value })} />
            <output>{Math.round(play.glide * 1000)}ms</output>
          </label>
          <label>
            ベンド幅
            <input type="number" min={0} max={48} value={play.bendRange} onChange={(e) => st().setPlay({ bendRange: Math.max(0, Math.min(48, +e.target.value || 0)) })} />
            <span className="unit">半音</span>
          </label>
          <label>
            音域
            <select value={play.low} onChange={(e) => st().setPlay({ low: Math.min(+e.target.value, play.high - 1) })} aria-label="最低音">
              {NOTES.map((n) => (
                <option key={n} value={n}>
                  {noteName(n)}
                </option>
              ))}
            </select>
            〜
            <select value={play.high} onChange={(e) => st().setPlay({ high: Math.max(+e.target.value, play.low + 1) })} aria-label="最高音">
              {NOTES.map((n) => (
                <option key={n} value={n}>
                  {noteName(n)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="group">
        <h3>
          調律<span>音律・微分音</span>
        </h3>
        <div className="form">
          <label>
            音律
            <select
              value={tuning.tuning.id}
              onChange={(e) => {
                const t = tunings.find((x) => x.id === e.target.value);
                if (t) st().setTuning({ tuning: t });
              }}
            >
              {tunings.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          {tuning.tuning.description && <p className="note">{tuning.tuning.description}</p>}
          <label>
            主音
            <select value={tuning.rootNote} onChange={(e) => st().setTuning({ rootNote: +e.target.value })}>
              {NOTES.filter((n) => n >= 36 && n <= 84).map((n) => (
                <option key={n} value={n}>
                  {noteName(n)}
                </option>
              ))}
            </select>
          </label>
          <label>
            A4
            <input type="number" min={380} max={500} step={0.1} value={tuning.a4} onChange={(e) => st().setTuning({ a4: Math.max(380, Math.min(500, +e.target.value || 440)) })} />
            <span className="unit">Hz</span>
          </label>
          <button
            className="btn"
            onClick={async () => {
              const f = await pickFile(".scl,text/plain");
              if (!f) return;
              try {
                const t = parseScala(await f.text(), f.name);
                setCustom((c) => [...c, t]);
                st().setTuning({ tuning: t });
                st().toast(`音律「${t.name}」（${t.steps.length} 音）を読み込みました`, "ok");
              } catch (err) {
                st().toast(`Scala ファイルを読めませんでした: ${(err as Error).message}`, "error");
              }
            }}
          >
            Scala (.scl) を読み込む
          </button>
          <label className="check">
            <input type="checkbox" checked={!!hasTuning} onChange={(e) => st().attachTuning(e.target.checked)} />
            この音律を楽器に保存する（読み込むと自動で切り替わる）
          </label>
          <p className="note">12 音以外の音律では、鍵盤 1 つ＝1 ステップ。グリッド演奏面が便利です。</p>
        </div>
      </section>

      <section className="group">
        <h3>
          MIDI<span>MPE 対応</span>
        </h3>
        {!midi.supported ? (
          <p className="note">このブラウザは Web MIDI に対応していません（Chrome / Edge を推奨）。</p>
        ) : !midi.enabled ? (
          <button
            className="btn"
            onClick={() =>
              enableMidi().catch((e) => {
                st().toast(`MIDI を有効にできませんでした: ${(e as Error).message}`, "error");
              })
            }
          >
            MIDI 入力を有効にする
          </button>
        ) : (
          <div className="form">
            <p className="note">{midi.inputs.length ? `接続中: ${midi.inputs.map((i) => i.name).join("、")}` : "MIDI 機器が見つかりません。接続すると自動で認識します。"}</p>
            <p className="note">
              ベロシティ・ピッチベンド・アフタータッチ（チャンネル／ポリ）・CC74・CC1（モッドホイール）・CC64（サステイン）を受けます。MPE 機器はチャンネルごとの表情がそのまま音ごとに届きます。マクロへの CC 割当は各マクロの「Learn」で。
            </p>
          </div>
        )}
      </section>

      <section className="group">
        <h3>楽器の情報</h3>
        <div className="form">
          <label>
            分類
            <select value={meta.category} onChange={(e) => st().setMeta({ category: e.target.value })}>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            作者
            <input type="text" value={meta.author ?? ""} maxLength={60} onFocus={() => st().beginGesture()} onBlur={() => st().endGesture()} onChange={(e) => st().setMeta({ author: e.target.value })} />
          </label>
          <label>
            タグ
            <input
              type="text"
              value={meta.tags.join(", ")}
              onFocus={() => st().beginGesture()}
              onBlur={() => st().endGesture()}
              onChange={(e) =>
                st().setMeta({
                  tags: e.target.value
                    .split(/[,、]/)
                    .map((t) => t.trim())
                    .filter(Boolean)
                    .slice(0, 16),
                })
              }
            />
          </label>
          <label className="block">
            説明
            <textarea rows={3} maxLength={500} value={meta.description ?? ""} onFocus={() => st().beginGesture()} onBlur={() => st().endGesture()} onChange={(e) => st().setMeta({ description: e.target.value })} />
          </label>
          {meta.lineage.length > 0 && (
            <p className="note">
              系譜: {meta.lineage.map((l) => `${l.name} ${Math.round(l.weight * 100)}%`).join(" ＋ ")}
            </p>
          )}
        </div>
      </section>
    </>
  );
}
