/** 書き出し: .atelier / 共有リンク / マルチサンプル（WAV＋SFZ）/ 試奏フレーズの WAV */
import { useEffect, useRef, useState } from "react";
import { serialize } from "../engine/instrument";
import { renderOffline } from "../engine/engine";
import { is12Tet, noteName } from "../engine/tuning";
import { exportMultisample, LAYER_VELS, safeName, type MultisampleOptions } from "../io/multisample";
import { shareUrl } from "../io/share";
import { encodeWav } from "../io/wav";
import { useStore } from "../state/store";
import { download } from "./util";

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const inst = useStore((s) => s.inst);
  const tuning = useStore((s) => s.tuning);
  const ref = useRef<HTMLDialogElement>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [o, setO] = useState<MultisampleOptions>({ step: 3, layers: 3, holdSec: 2.5, tailSec: 2.5, spatial: false, bits: 24, low: inst.play.low, high: inst.play.high });
  const count = Math.ceil((o.high - o.low) / o.step + 1) * o.layers;
  const name = safeName(inst.meta.name);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const toast = useStore.getState().toast;

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="export-title">
      <div className="dialog-head">
        <h2 id="export-title">書き出し・共有</h2>
        <button className="x" onClick={() => ref.current?.close()} aria-label="閉じる">
          ×
        </button>
      </div>

      <section>
        <h3>楽器ファイル（.atelier）</h3>
        <p className="note">この楽器のすべて（音色・対応づけ・マクロ・演奏設定・系譜）を 1 つの JSON に。Atelier に読み込めば続きから編集できます。</p>
        <button className="btn" onClick={() => download(serialize(inst), `${name}.atelier`, "application/json")}>
          .atelier を保存
        </button>
      </section>

      <section>
        <h3>共有リンク</h3>
        <p className="note">楽器をまるごと URL に埋め込みます（サーバーには何も送りません）。開いた人はそのまま演奏・編集できます。</p>
        <div className="row">
          <button
            className="btn"
            onClick={async () => {
              const u = await shareUrl(inst);
              setLink(u);
              try {
                await navigator.clipboard.writeText(u);
                toast("共有リンクをコピーしました", "ok");
              } catch {
                /* クリップボード不可でも欄に表示 */
              }
            }}
          >
            リンクを作ってコピー
          </button>
          {link && <input className="link" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="共有リンク" />}
        </div>
      </section>

      <section>
        <h3>マルチサンプル（WAV ＋ SFZ）— DAW へ持ち出す</h3>
        <p className="note">
          楽器を音高 × 強弱で録音し、SFZ 定義と一緒に ZIP にします。Logic・Ableton・Bitwig・Reaper などの SFZ 対応サンプラー（sforzando 等）で、この楽器をそのまま使えます。
        </p>
        <div className="form grid2">
          <label>
            音域
            <select value={o.low} onChange={(e) => setO({ ...o, low: +e.target.value })}>
              {Array.from({ length: 128 }, (_, i) => i).map((n) => (
                <option key={n} value={n}>
                  {noteName(n)}
                </option>
              ))}
            </select>
            〜
            <select value={o.high} onChange={(e) => setO({ ...o, high: +e.target.value })}>
              {Array.from({ length: 128 }, (_, i) => i).map((n) => (
                <option key={n} value={n}>
                  {noteName(n)}
                </option>
              ))}
            </select>
          </label>
          <label>
            間隔
            <select value={o.step} onChange={(e) => setO({ ...o, step: +e.target.value })}>
              <option value={1}>1 半音（最高品質）</option>
              <option value={2}>2 半音</option>
              <option value={3}>3 半音（標準）</option>
              <option value={4}>4 半音</option>
              <option value={6}>6 半音（軽量）</option>
            </select>
          </label>
          <label>
            強弱の段
            <select value={o.layers} onChange={(e) => setO({ ...o, layers: +e.target.value as 1 | 2 | 3 | 4 })}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} 段（{LAYER_VELS[n].map((v) => Math.round(v * 127)).join("/")}）
                </option>
              ))}
            </select>
          </label>
          <label>
            押さえる長さ
            <input type="number" min={0.2} max={10} step={0.1} value={o.holdSec} onChange={(e) => setO({ ...o, holdSec: Math.max(0.2, +e.target.value || 2) })} />
            <span className="unit">秒</span>
          </label>
          <label>
            余韻
            <input type="number" min={0.2} max={12} step={0.1} value={o.tailSec} onChange={(e) => setO({ ...o, tailSec: Math.max(0.2, +e.target.value || 2) })} />
            <span className="unit">秒</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={o.spatial} onChange={(e) => setO({ ...o, spatial: e.target.checked })} />
            ディレイ・リバーブも焼き込む
          </label>
          <label>
            ビット深度
            <select value={o.bits} onChange={(e) => setO({ ...o, bits: +e.target.value as 16 | 24 })}>
              <option value={24}>24 bit</option>
              <option value={16}>16 bit</option>
            </select>
          </label>
        </div>
        {!is12Tet(tuning) && <p className="note warn">現在の音律は 12 平均律ではありません。SFZ は鍵ごとの音程を表せないため「間隔 1 半音」を推奨します（各鍵を実際の音律で録音します）。</p>}
        <div className="row">
          <button
            className="btn primary"
            disabled={!!busy || o.high <= o.low}
            onClick={async () => {
              setBusy("ms");
              setProgress(0);
              try {
                const zip = await exportMultisample(inst, tuning, o, (d, t) => setProgress(d / t));
                download(zip, `${name}_multisample.zip`, "application/zip");
                toast(`${count} サンプルを書き出しました`, "ok");
              } catch (e) {
                toast(`書き出しに失敗しました: ${(e as Error).message}`, "error");
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === "ms" ? `描画中… ${Math.round(progress * 100)}%` : `${count} サンプルを書き出す`}
          </button>
          {busy === "ms" && <progress value={progress} max={1} />}
        </div>
      </section>

      <section>
        <h3>試奏フレーズ（WAV）</h3>
        <p className="note">音域の低・中・高で弱く・強く弾いたデモを 1 本の WAV に。楽器の「領域」を耳で確かめる素材に。</p>
        <button
          className="btn"
          disabled={!!busy}
          onClick={async () => {
            setBusy("demo");
            try {
              const lo = inst.play.low;
              const hi = inst.play.high;
              const notes = [lo + Math.round((hi - lo) * 0.2), Math.round((lo + hi) / 2), hi - Math.round((hi - lo) * 0.15)];
              const ev = [];
              let t = 0.05;
              for (const n of notes)
                for (const v of [0.35, 0.95]) {
                  ev.push({ time: t, type: "on" as const, note: n, vel: v }, { time: t + 1.4, type: "off" as const, note: n, vel: 0 });
                  t += 2;
                }
              const buf = await renderOffline(inst, tuning, ev, t + 2.5);
              download(encodeWav([buf.getChannelData(0), buf.getChannelData(1)], buf.sampleRate, 24), `${name}_demo.wav`, "audio/wav");
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy === "demo" ? "描画中…" : "デモ WAV を書き出す"}
        </button>
      </section>
    </dialog>
  );
}
