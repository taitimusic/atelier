/** 下部: 演奏面（鍵盤／グリッド／弦／パッド）と、演奏補助（アルペジオ・ループ録音・音声録音） */
import { useEffect, useRef, useState } from "react";
import { renderOffline } from "../engine/engine";
import type { Surface } from "../engine/instrument";
import { loopClear, loopCloseAndPlay, loopPhase, loopPlay, loopRecord, loopStop, panic, setSustain, usePerf, type ArpMode } from "../input/perform";
import { safeName } from "../io/multisample";
import { writeMidi } from "../io/midifile";
import { encodeWav } from "../io/wav";
import { getEngine } from "../state/audio";
import { useStore } from "../state/store";
import { useRaf } from "./hooks";
import { Grid } from "./surfaces/Grid";
import { Keyboard } from "./surfaces/Keyboard";
import { Pads } from "./surfaces/Pads";
import { Strum } from "./surfaces/Strum";
import { cx, download } from "./util";

const SURFACES: { id: Surface; label: string }[] = [
  { id: "keys", label: "鍵盤" },
  { id: "grid", label: "グリッド" },
  { id: "strum", label: "弦" },
  { id: "pads", label: "パッド" },
];

export function PlayDock() {
  const loadSeq = useStore((s) => s.loadSeq);
  const [surface, setSurface] = useState<Surface>(() => useStore.getState().inst.play.surface);
  // 楽器を明示的に読み込んだときだけ、その楽器の推奨演奏面へ（ブレンド中は切り替えない）
  useEffect(() => setSurface(useStore.getState().inst.play.surface), [loadSeq]);

  return (
    <section className="dock" aria-label="演奏">
      <div className="dock-bar">
        <div className="seg" role="tablist" aria-label="演奏面">
          {SURFACES.map((s) => (
            <button key={s.id} role="tab" aria-selected={surface === s.id} className={cx(surface === s.id && "on")} onClick={() => setSurface(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
        <Transport />
      </div>
      <div className="dock-main">
        <PerfStrips />
        <div className="surface">
          {surface === "keys" && <Keyboard />}
          {surface === "grid" && <Grid />}
          {surface === "strum" && <Strum />}
          {surface === "pads" && <Pads />}
        </div>
      </div>
    </section>
  );
}

/** ピッチベンド（離すと戻る）とモッドホイール */
function PerfStrips() {
  const mod = useStore((s) => s.modwheel);
  const bendRange = useStore((s) => s.inst.play.bendRange);
  const [bend, setBend] = useState(0);
  const strip = (value: number, bipolar: boolean, onSet: (v: number) => void, onEnd: (() => void) | null, label: string) => (
    <div
      className="strip"
      role="slider"
      aria-label={label}
      aria-valuenow={Math.round(value * 100)}
      tabIndex={0}
      onPointerDown={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.setPointerCapture(e.pointerId);
        const r = el.getBoundingClientRect();
        const f = (y: number) => {
          const v = 1 - (y - r.top) / r.height;
          onSet(bipolar ? Math.max(-1, Math.min(1, v * 2 - 1)) : Math.max(0, Math.min(1, v)));
        };
        f(e.clientY);
        const mv = (ev: PointerEvent) => f(ev.clientY);
        const up = () => {
          el.removeEventListener("pointermove", mv);
          el.removeEventListener("pointerup", up);
          el.removeEventListener("pointercancel", up);
          onEnd?.();
        };
        el.addEventListener("pointermove", mv);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
      }}
    >
      <div className="strip-fill" style={bipolar ? { bottom: `${50 + Math.min(0, value) * 50}%`, height: `${Math.abs(value) * 50}%` } : { bottom: 0, height: `${value * 100}%` }} />
      <span>{label}</span>
    </div>
  );
  return (
    <div className="strips">
      {strip(
        bend,
        true,
        (v) => {
          setBend(v);
          getEngine()?.bend(16, v * bendRange);
        },
        () => {
          setBend(0);
          getEngine()?.bend(16, 0);
        },
        "ベンド",
      )}
      {strip(mod, false, (v) => useStore.getState().setModWheel(v), null, "モッド")}
    </div>
  );
}

function Transport() {
  const octave = usePerf((s) => s.octave);
  const sustain = usePerf((s) => s.sustain);
  const arp = usePerf((s) => s.arp);
  const bpm = usePerf((s) => s.bpm);
  const loop = usePerf((s) => s.loop);
  const audioReady = useStore((s) => s.audioReady);
  const [recAudio, setRecAudio] = useState(false);
  const [busy, setBusy] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const set = usePerf.getState().set;

  useRaf(() => {
    const el = barRef.current;
    if (!el) return;
    const p = loopPhase();
    el.style.width = p < 0 ? "100%" : `${p * 100}%`;
    el.classList.toggle("rec", p < 0);
  });

  const toggleAudioRec = async () => {
    const e = getEngine();
    if (!e) return;
    if (!recAudio) {
      e.startRecording();
      setRecAudio(true);
      return;
    }
    setRecAudio(false);
    const { l, r } = await e.stopRecording();
    const name = safeName(useStore.getState().inst.meta.name);
    download(encodeWav([l, r], e.sampleRate, 24), `${name}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.wav`, "audio/wav");
    useStore.getState().toast(`録音を書き出しました（${(l.length / e.sampleRate).toFixed(1)} 秒・24bit WAV）`, "ok");
  };

  const bounce = async () => {
    const st = useStore.getState();
    if (!loop.events.length) return;
    setBusy(true);
    try {
      const reps = Math.max(1, Math.ceil(8 / loop.length));
      const events = [];
      for (let k = 0; k < reps; k++) for (const ev of loop.events) events.push({ ...ev, time: ev.time + k * loop.length });
      const buf = await renderOffline(st.inst, st.tuning, events, loop.length * reps + 4);
      download(encodeWav([buf.getChannelData(0), buf.getChannelData(1)], buf.sampleRate, 24), `${safeName(st.inst.meta.name)}_loop.wav`, "audio/wav");
      st.toast(`ループを ${reps} 回ぶん WAV に書き出しました`, "ok");
    } catch (err) {
      st.toast(`書き出しに失敗しました: ${(err as Error).message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const loopBtn = () => {
    if (loop.state === "recording") loopCloseAndPlay();
    else loopRecord();
  };

  return (
    <div className="transport">
      <div className="grp" aria-label="オクターブ">
        <button className="icon" onClick={() => set({ octave: Math.max(-4, octave - 1) })} aria-label="オクターブ下げる" title="Z">
          −
        </button>
        <span className="val">Oct {octave >= 0 ? `+${octave}` : octave}</span>
        <button className="icon" onClick={() => set({ octave: Math.min(4, octave + 1) })} aria-label="オクターブ上げる" title="X">
          ＋
        </button>
      </div>
      <button className={cx("tbtn", sustain && "on")} onClick={() => setSustain(!sustain)} title="サステイン（Space）" aria-pressed={sustain}>
        サステイン
      </button>
      <div className="grp">
        <select value={arp.mode} onChange={(e) => set({ arp: { ...arp, mode: e.target.value as ArpMode } })} aria-label="アルペジオ">
          <option value="off">アルペジオ切</option>
          <option value="up">上行</option>
          <option value="down">下行</option>
          <option value="updown">上下</option>
          <option value="order">押した順</option>
          <option value="random">ランダム</option>
        </select>
        {arp.mode !== "off" && (
          <>
            <select value={arp.rate} onChange={(e) => set({ arp: { ...arp, rate: +e.target.value } })} aria-label="アルペジオの細かさ">
              <option value={1}>4分</option>
              <option value={2}>8分</option>
              <option value={3}>3連</option>
              <option value={4}>16分</option>
              <option value={6}>6連</option>
              <option value={8}>32分</option>
            </select>
            <select value={arp.octaves} onChange={(e) => set({ arp: { ...arp, octaves: +e.target.value } })} aria-label="アルペジオの音域">
              <option value={1}>1oct</option>
              <option value={2}>2oct</option>
              <option value={3}>3oct</option>
            </select>
            <button className={cx("tbtn", arp.latch && "on")} onClick={() => set({ arp: { ...arp, latch: !arp.latch } })} aria-pressed={arp.latch} title="離しても鳴り続ける">
              ラッチ
            </button>
          </>
        )}
      </div>
      <label className="grp bpm">
        <span>BPM</span>
        <input type="number" min={30} max={300} value={bpm} onChange={(e) => set({ bpm: Math.max(30, Math.min(300, +e.target.value || 100)) })} />
      </label>
      <div className="grp loop" aria-label="ループ録音">
        <button
          className={cx("tbtn rec", (loop.state === "recording" || loop.state === "overdub") && "on")}
          onClick={loopBtn}
          title={loop.state === "recording" ? "録音を閉じてループ再生" : loop.state === "playing" ? "重ね録り" : "ループ録音を開始（弾き始めて、もう一度押すとループ）"}
        >
          ● {loop.state === "recording" ? "ループにする" : loop.state === "playing" ? "重ねる" : loop.state === "overdub" ? "重ね録り中" : "ループ録音"}
        </button>
        <button className="icon" onClick={() => (loop.state === "playing" || loop.state === "overdub" ? loopStop() : loopPlay())} disabled={!loop.events.length} aria-label="ループの再生／停止">
          {loop.state === "playing" || loop.state === "overdub" ? "■" : "▶"}
        </button>
        <button className="icon" onClick={loopClear} disabled={loop.state === "empty"} aria-label="ループを消去" title="ループを消去">
          ⌫
        </button>
        <div className="loop-bar" aria-hidden="true">
          <div ref={barRef} />
        </div>
        {loop.length > 0 && <span className="val">{loop.length.toFixed(1)}s</span>}
        <button className="tbtn" disabled={!loop.events.length} onClick={() => download(writeMidi(loop.events, bpm, useStore.getState().inst.meta.name), `${safeName(useStore.getState().inst.meta.name)}_loop.mid`, "audio/midi")} title="ループを MIDI ファイルに">
          MIDI
        </button>
        <button className="tbtn" disabled={!loop.events.length || busy} onClick={bounce} title="ループを WAV に書き出し（オフライン描画）">
          {busy ? "描画中…" : "WAV"}
        </button>
      </div>
      <button className={cx("tbtn rec", recAudio && "on")} onClick={toggleAudioRec} title="出力をそのまま録音して WAV に" disabled={!audioReady}>
        {recAudio ? "■ 録音停止" : "● 音声録音"}
      </button>
      <button className="icon" onClick={panic} title="全消音（Esc）" aria-label="全消音">
        ⏻
      </button>
    </div>
  );
}
