/** 上部バー: 楽器名・保存・履歴・A/B 比較・読み込み・書き出し・MIDI/音声状態 */
import { useState } from "react";
import { CATEGORIES, sanitize } from "../engine/instrument";
import { readMidi } from "../io/midifile";
import { loadLoop } from "../input/perform";
import { useMidi } from "../input/midi";
import { isDirty, useStore } from "../state/store";
import { useActivity } from "./activity";
import { ExportDialog } from "./ExportDialog";
import { cx, pickFile } from "./util";

export async function importFile(f: File): Promise<void> {
  const st = useStore.getState();
  const lower = f.name.toLowerCase();
  try {
    if (lower.endsWith(".mid") || lower.endsWith(".midi")) {
      const { events, duration } = readMidi(new Uint8Array(await f.arrayBuffer()));
      if (!events.length) throw new Error("ノートがありません");
      loadLoop(events, duration + 0.5);
      st.toast(`MIDI「${f.name}」をループに読み込みました（▶ で再生）`, "ok");
      return;
    }
    const inst = sanitize(JSON.parse(await f.text()));
    st.load(inst);
    st.toast(`「${inst.meta.name}」を読み込みました`, "ok");
  } catch (e) {
    st.toast(`読み込めませんでした: ${(e as Error).message}`, "error");
  }
}

export function TopBar({ onToggleBrowser }: { onToggleBrowser: () => void }) {
  const name = useStore((s) => s.inst.meta.name);
  const category = useStore((s) => s.inst.meta.category);
  const lineage = useStore((s) => s.inst.meta.lineage);
  const dirty = useStore(isDirty);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const ab = useStore((s) => s.ab);
  const audio = useStore((s) => s.audioReady);
  const voices = useActivity((s) => s.voices.length);
  const midiOn = useMidi((s) => s.enabled && s.inputs.length > 0);
  const midiAct = useMidi((s) => s.lastActivity);
  const [exp, setExp] = useState(false);
  const st = useStore.getState;
  const cat = CATEGORIES.find((c) => c.id === category)?.label;

  return (
    <header className="topbar">
      <button className="icon only-narrow" onClick={onToggleBrowser} aria-label="楽器ブラウザを開く">
        ☰
      </button>
      <div className="brand" aria-label="Atelier">
        <span className="brand-mark" aria-hidden="true" />
        Atelier
      </div>
      <div className="inst-title">
        <input
          className="name-input"
          value={name}
          maxLength={60}
          aria-label="楽器名"
          onFocus={() => st().beginGesture()}
          onBlur={() => st().endGesture()}
          onChange={(e) => st().setMeta({ name: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <span className="inst-meta">
          {cat}
          {lineage.length > 0 && <> · {lineage.map((l) => `${l.name.replace(/（.*?）|「.*?」/g, "")} ${Math.round(l.weight * 100)}%`).join(" + ")}</>}
          {dirty && <span className="dirty"> · 未保存</span>}
        </span>
      </div>
      <div className="tb-group">
        <button className="icon" onClick={() => st().undo()} disabled={!canUndo} aria-label="元に戻す" title="元に戻す（⌘/Ctrl+Z）">
          ↶
        </button>
        <button className="icon" onClick={() => st().redo()} disabled={!canRedo} aria-label="やり直す" title="やり直す（⌘/Ctrl+Shift+Z）">
          ↷
        </button>
      </div>
      <div className="tb-group ab" role="group" aria-label="A/B 比較">
        <button className={cx("ab-btn", ab.active === "A" && "on")} onClick={() => ab.active !== "A" && st().toggleAB()} aria-pressed={ab.active === "A"} title="A/B 比較: 2 つの状態を行き来して聴き比べる">
          A
        </button>
        <button className={cx("ab-btn", ab.active === "B" && "on")} onClick={() => ab.active !== "B" && st().toggleAB()} aria-pressed={ab.active === "B"}>
          B
        </button>
        <button className="icon small" onClick={() => st().copyToOther()} title={`${ab.active} を ${ab.active === "A" ? "B" : "A"} へコピー`} aria-label="もう一方へコピー">
          ⇄
        </button>
      </div>
      <div className="tb-group">
        <button className="btn" onClick={() => void st().save(false)} title="ライブラリに保存（⌘/Ctrl+S）">
          保存
        </button>
        <button className="btn ghost" onClick={() => void st().save(true)}>
          別名で保存
        </button>
        <button
          className="btn ghost"
          onClick={async () => {
            const f = await pickFile(".atelier,.json,.mid,.midi,application/json");
            if (f) await importFile(f);
          }}
          title=".atelier（楽器）または .mid（演奏）を読み込む"
        >
          読み込み
        </button>
        <button className="btn primary" onClick={() => setExp(true)}>
          書き出し・共有
        </button>
      </div>
      <div className="status" aria-live="polite">
        <span className={cx("dot", audio && "on")} title={audio ? "音声: 有効" : "音声: 停止中"} />
        <span className="voices" title="発音中のボイス数">
          {voices} 声
        </span>
        <span className={cx("dot midi", midiOn && "on", performance.now() - midiAct < 150 && "blink")} title={midiOn ? "MIDI 接続中" : "MIDI なし"} />
      </div>
      {exp && <ExportDialog onClose={() => setExp(false)} />}
    </header>
  );
}
