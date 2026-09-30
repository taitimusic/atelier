/**
 * Performer — すべての演奏入力（画面の鍵盤・グリッド・弦・PC キーボード・MIDI）が通る一本の経路。
 * ここでアルペジエータとループ録音を扱い、エンジンへ音符を送る。
 */
import { create } from "zustand";
import type { NoteEvent } from "../engine/engine";
import { getEngine } from "../state/audio";

export type ArpMode = "off" | "up" | "down" | "updown" | "random" | "order";
export type LoopState = "empty" | "recording" | "playing" | "overdub" | "stopped";

interface PerfState {
  held: Record<string, number>; // key → note（画面表示用）
  sustain: boolean;
  octave: number;
  fixedVel: number | null;
  bpm: number;
  arp: { mode: ArpMode; rate: number; octaves: number; gate: number; latch: boolean };
  loop: { state: LoopState; length: number; events: NoteEvent[]; startedAt: number; quantize: boolean };
  set: (p: Partial<Omit<PerfState, "set">>) => void;
}

export const usePerf = create<PerfState>((set) => ({
  held: {},
  sustain: false,
  octave: 0,
  fixedVel: null,
  bpm: 100,
  arp: { mode: "off", rate: 4, octaves: 1, gate: 0.6, latch: false },
  loop: { state: "empty", length: 0, events: [], startedAt: 0, quantize: true },
  set: (p) => set(p as Partial<PerfState>),
}));

const now = () => getEngine()?.ctx.currentTime ?? 0;

// ------------------------------------------------------------------
// 直接の発音（アルペジエータの後段）＋ループへの記録
// ------------------------------------------------------------------

function emitOn(note: number, vel: number, ch: number, when?: number): void {
  const e = getEngine();
  if (!e) return;
  e.noteOn(note, vel, ch, when);
  record({ time: when ?? now(), type: "on", note, vel, ch });
}

function emitOff(note: number, ch: number, when?: number): void {
  const e = getEngine();
  if (!e) return;
  e.noteOff(note, ch, when);
  record({ time: when ?? now(), type: "off", note, vel: 0, ch });
}

// ------------------------------------------------------------------
// 公開 API（入力面が呼ぶ）
// ------------------------------------------------------------------

const arpPool: { note: number; vel: number; ch: number }[] = [];
let arpTimer: ReturnType<typeof setInterval> | null = null;
let arpNext = 0;
let arpStep = 0;

export function noteOn(key: string, note: number, vel: number, ch = 0): void {
  if (note < 0 || note > 127) return;
  const st = usePerf.getState();
  const v = st.fixedVel ?? vel;
  usePerf.setState((s) => ({ held: { ...s.held, [key]: note } }));
  if (st.arp.mode !== "off") {
    if (st.arp.latch && Object.keys(usePerf.getState().held).length === 1) arpPool.length = 0;
    if (!arpPool.some((p) => p.note === note)) arpPool.push({ note, vel: v, ch });
    startArp();
    return;
  }
  emitOn(note, v, ch);
}

export function noteOff(key: string, note: number, ch = 0): void {
  const st = usePerf.getState();
  usePerf.setState((s) => {
    const h = { ...s.held };
    delete h[key];
    return { held: h };
  });
  if (st.arp.mode !== "off") {
    if (!st.arp.latch) {
      const i = arpPool.findIndex((p) => p.note === note);
      if (i >= 0) arpPool.splice(i, 1);
      if (!arpPool.length) stopArp();
    }
    return;
  }
  emitOff(note, ch);
}

export function setSustain(on: boolean): void {
  usePerf.setState({ sustain: on });
  getEngine()?.sustain(on);
  record({ time: now(), type: "sustain", note: 0, vel: on ? 1 : 0 });
}

export function panic(): void {
  arpPool.length = 0;
  stopArp();
  usePerf.setState({ held: {} });
  getEngine()?.allOff(true);
}

// ------------------------------------------------------------------
// アルペジエータ（先読みスケジューリングでサンプル精度）
// ------------------------------------------------------------------

function startArp(): void {
  if (arpTimer) return;
  arpNext = now() + 0.02;
  arpStep = 0;
  arpTimer = setInterval(arpTick, 25);
  arpTick();
}

export function stopArp(): void {
  if (arpTimer) clearInterval(arpTimer);
  arpTimer = null;
}

function arpSequence(): { note: number; vel: number; ch: number }[] {
  const { arp } = usePerf.getState();
  const base = arp.mode === "order" ? arpPool.slice() : arpPool.slice().sort((a, b) => a.note - b.note);
  const seq: { note: number; vel: number; ch: number }[] = [];
  for (let o = 0; o < arp.octaves; o++) for (const p of base) seq.push({ ...p, note: p.note + 12 * o });
  return seq;
}

function arpTick(): void {
  const st = usePerf.getState();
  if (!arpPool.length || st.arp.mode === "off") {
    stopArp();
    return;
  }
  const stepDur = 60 / st.bpm / st.arp.rate;
  const horizon = now() + 0.12;
  while (arpNext < horizon) {
    const seq = arpSequence();
    if (!seq.length) break;
    let idx: number;
    if (st.arp.mode === "down") idx = seq.length - 1 - (arpStep % seq.length);
    else if (st.arp.mode === "random") idx = Math.floor(Math.random() * seq.length);
    else if (st.arp.mode === "updown") {
      if (seq.length === 1) idx = 0;
      else {
        const period = 2 * (seq.length - 1);
        const k = arpStep % period;
        idx = k < seq.length ? k : period - k;
      }
    } else idx = arpStep % seq.length;
    const p = seq[idx];
    if (p.note <= 127) {
      emitOn(p.note, p.vel, p.ch, arpNext);
      emitOff(p.note, p.ch, arpNext + stepDur * st.arp.gate);
    }
    arpStep++;
    arpNext += stepDur;
  }
}

// ------------------------------------------------------------------
// ループ録音（録って・回しながら音を彫る）
// ------------------------------------------------------------------

let loopTimer: ReturnType<typeof setInterval> | null = null;
let loopScheduledUntil = 0;

function record(ev: NoteEvent): void {
  const { loop } = usePerf.getState();
  if (loop.state === "recording") {
    const t = ev.time - loop.startedAt;
    if (t < 0) return;
    usePerf.setState({ loop: { ...loop, events: [...loop.events, { ...ev, time: t }] } });
  } else if (loop.state === "overdub" && loop.length > 0) {
    // 再生で鳴った音は記録しない（再生イベントは engine を直接叩くので record を通らない）
    let t = (ev.time - loop.startedAt) % loop.length;
    if (t < 0) t += loop.length;
    usePerf.setState({ loop: { ...loop, events: [...loop.events, { ...ev, time: t }] } });
  }
}

export function loopRecord(): void {
  const t = now();
  const { loop } = usePerf.getState();
  if (loop.state === "playing") {
    usePerf.setState({ loop: { ...loop, state: "overdub" } });
    return;
  }
  if (loop.state === "overdub") {
    usePerf.setState({ loop: { ...loop, state: "playing" } });
    return;
  }
  usePerf.setState({ loop: { ...loop, state: "recording", events: [], length: 0, startedAt: t } });
}

/** 録音を閉じて再生へ */
export function loopCloseAndPlay(): void {
  const st = usePerf.getState();
  const { loop } = st;
  if (loop.state !== "recording") return;
  const t = now();
  let length = t - loop.startedAt;
  if (loop.quantize) {
    const beat = 60 / st.bpm;
    const beats = Math.max(1, Math.round(length / beat));
    length = beats * beat;
  }
  if (length < 0.25 || loop.events.length === 0) {
    usePerf.setState({ loop: { ...loop, state: "empty", events: [] } });
    return;
  }
  // 閉じていない音をループ末尾で閉じる
  const events = loop.events.filter((e) => e.time < length);
  const open = new Map<string, NoteEvent>();
  for (const e of events) {
    const k = `${e.note}:${e.ch ?? 0}`;
    if (e.type === "on") open.set(k, e);
    else if (e.type === "off") open.delete(k);
  }
  for (const e of open.values()) events.push({ time: length - 0.005, type: "off", note: e.note, vel: 0, ch: e.ch });
  // 押されたままの鍵は実際にも離す（ループ再生と二重にならないよう）
  const eng = getEngine();
  for (const e of open.values()) eng?.noteOff(e.note, e.ch ?? 0);
  events.sort((a, b) => a.time - b.time);
  usePerf.setState({ loop: { ...loop, state: "playing", events, length, startedAt: loop.startedAt + length } });
  startLoopPlayback();
}

export function loopPlay(): void {
  const { loop } = usePerf.getState();
  if (!loop.events.length || loop.length <= 0) return;
  usePerf.setState({ loop: { ...loop, state: "playing", startedAt: now() + 0.05 } });
  startLoopPlayback();
}

export function loopStop(): void {
  const { loop } = usePerf.getState();
  if (loop.state === "recording") {
    loopCloseAndPlay();
    return;
  }
  if (loopTimer) clearInterval(loopTimer);
  loopTimer = null;
  getEngine()?.clearScheduled();
  getEngine()?.allOff(false);
  usePerf.setState({ loop: { ...loop, state: loop.events.length ? "stopped" : "empty" } });
}

export function loopClear(): void {
  if (loopTimer) clearInterval(loopTimer);
  loopTimer = null;
  getEngine()?.clearScheduled();
  getEngine()?.allOff(false);
  const { loop } = usePerf.getState();
  usePerf.setState({ loop: { ...loop, state: "empty", events: [], length: 0 } });
}

export function loadLoop(events: NoteEvent[], length: number): void {
  loopClear();
  const { loop } = usePerf.getState();
  usePerf.setState({ loop: { ...loop, state: "stopped", events, length } });
}

function startLoopPlayback(): void {
  if (loopTimer) clearInterval(loopTimer);
  loopScheduledUntil = now();
  loopTimer = setInterval(loopTick, 30);
  loopTick();
}

function loopTick(): void {
  const { loop } = usePerf.getState();
  const e = getEngine();
  if (!e || (loop.state !== "playing" && loop.state !== "overdub")) return;
  const horizon = now() + 0.15;
  const from = loopScheduledUntil;
  const L = loop.length;
  const c0 = Math.floor((from - loop.startedAt) / L);
  const c1 = Math.floor((horizon - loop.startedAt) / L);
  for (let c = Math.max(0, c0); c <= c1; c++) {
    const base = loop.startedAt + c * L;
    for (const ev of loop.events) {
      const t = base + ev.time;
      if (t < from || t >= horizon) continue;
      if (ev.type === "on") e.noteOn(ev.note, ev.vel, ev.ch ?? 0, t);
      else if (ev.type === "off") e.noteOff(ev.note, ev.ch ?? 0, t);
      else e.sustain(ev.vel > 0, t);
    }
  }
  loopScheduledUntil = horizon;
}

/** ループ内の現在位置 0..1（表示用） */
export function loopPhase(): number {
  const { loop } = usePerf.getState();
  if ((loop.state !== "playing" && loop.state !== "overdub") || loop.length <= 0) {
    if (loop.state === "recording") return -1;
    return 0;
  }
  const p = (now() - loop.startedAt) / loop.length;
  return p - Math.floor(p);
}
