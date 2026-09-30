import { useEffect, useState } from "react";
import { installQwerty } from "../input/qwerty";
import { decodeInstrument, readShareHash } from "../io/share";
import { ensureAudio, getEngine } from "../state/audio";
import { useStore, type StageTab } from "../state/store";
import { setActivity } from "./activity";
import { BlendPad } from "./BlendPad";
import { Browser } from "./Browser";
import { Discover } from "./Discover";
import { Inspector } from "./Inspector";
import { MacroStrip } from "./MacroStrip";
import { PlayDock } from "./PlayDock";
import { RegionMap } from "./RegionMap";
import { Scope } from "./Scope";
import { importFile, TopBar } from "./TopBar";
import { cx } from "./util";

let activityWired = false;

const STAGES: { id: StageTab; label: string; hint: string }[] = [
  { id: "blend", label: "ブレンド", hint: "楽器を混ぜる" },
  { id: "map", label: "領域マップ", hint: "楽器の広がりを見る" },
  { id: "discover", label: "発見", hint: "近くの変奏を聴き比べる" },
];

export function App() {
  const stage = useStore((s) => s.stage);
  const audioReady = useStore((s) => s.audioReady);
  const toasts = useStore((s) => s.toasts);
  const [drawer, setDrawer] = useState(false);
  const [dropping, setDropping] = useState(false);

  useEffect(() => {
    const st = useStore.getState();
    void st.refreshLibrary();
    const code = readShareHash();
    if (code) {
      decodeInstrument(code)
        .then((inst) => {
          st.load(inst, { keepHistory: false });
          st.toast(`共有された楽器「${inst.meta.name}」を開きました`, "ok");
          history.replaceState(null, "", location.pathname + location.search);
        })
        .catch(() => st.toast("共有リンクの楽器を読めませんでした", "error"));
    }
    const first = () => {
      void startAudio();
    };
    const off = installQwerty(first);
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const s = useStore.getState();
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
      if (mod && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && e.key.toLowerCase() === "y" && !typing) {
        e.preventDefault();
        s.redo();
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void s.save(e.shiftKey);
      } else if (e.key === "Escape" && s.assign) s.setAssign(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      off();
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const startAudio = async () => {
    try {
      const e = await ensureAudio();
      if (!activityWired) {
        activityWired = true;
        e.onActivity(setActivity);
      }
    } catch (err) {
      useStore.getState().toast(`音声を開始できませんでした: ${(err as Error).message}`, "error");
    }
  };

  return (
    <div
      className="app"
      onPointerDownCapture={() => {
        if (!getEngine()) void startAudio();
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropping(false);
      }}
      onDrop={(e) => {
        const f = e.dataTransfer.files?.[0];
        setDropping(false);
        if (f) {
          e.preventDefault();
          void importFile(f);
        }
      }}
    >
      <TopBar onToggleBrowser={() => setDrawer((d) => !d)} />
      <main className="main">
        <div className={cx("browser-col", drawer && "open")} onClick={(e) => (e.target as HTMLElement).closest(".inst-row") && setDrawer(false)}>
          <Browser />
        </div>
        <section className="center" aria-label="作業台">
          <div className="stage-bar">
            <div className="seg" role="tablist" aria-label="作業の方法">
              {STAGES.map((s) => (
                <button key={s.id} role="tab" aria-selected={stage === s.id} className={cx(stage === s.id && "on")} onClick={() => useStore.getState().setStage(s.id)} title={s.hint}>
                  {s.label}
                </button>
              ))}
            </div>
            <Scope height={34} />
          </div>
          <div className="stage">
            {stage === "blend" && <BlendPad />}
            {stage === "map" && <RegionMap />}
            {stage === "discover" && <Discover />}
          </div>
          <MacroStrip />
        </section>
        <Inspector />
      </main>
      <PlayDock />
      {!audioReady && (
        <div className="gate" role="dialog" aria-modal="true" aria-labelledby="gate-title">
          <div className="gate-card">
            <div className="gate-orb" aria-hidden="true" />
            <h1 id="gate-title">Atelier</h1>
            <p className="gate-lead">楽器を、創る。</p>
            <ol className="gate-steps">
              <li>
                <b>選ぶ</b> 29 の種楽器から出発点を
              </li>
              <li>
                <b>混ぜる・彫る</b> 物理モデルの音色空間を動かす
              </li>
              <li>
                <b>弾く・持ち出す</b> 鍵盤・弦・MIDI/MPE で演奏し、SFZ で DAW へ
              </li>
            </ol>
            <button className="btn primary big" onClick={() => void startAudio()} autoFocus>
              音を出してはじめる
            </button>
            <p className="gate-note">PC キーボード（A〜K）や MIDI 機器でもすぐ演奏できます。データはこの端末の中だけに保存されます。</p>
          </div>
        </div>
      )}
      {dropping && <div className="dropzone">.atelier（楽器）や .mid（演奏）をここへドロップ</div>}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cx("toast", t.kind)} onClick={() => useStore.getState().dismissToast(t.id)}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
