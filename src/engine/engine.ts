/**
 * AudioEngine — UI とオーディオの唯一の境界。
 * UI/状態層はこのクラス越しにのみ音を扱う（AudioContext やノードに直接触れない）。
 */

import processorUrl from "./processor.ts?worker&url";
import { FxChain } from "./fx";
import { effectiveGlobals, toVoicePatch, type Instrument } from "./instrument";
import { MOD_SOURCE_INDEX, N_MACROS, SRC } from "./params";
import type { OfflineEvent, SynthMessage } from "./processor";
import { EV_NOTE_OFF, EV_NOTE_ON, EV_SUSTAIN } from "./synth";
import { frequencyTable, type TuningSettings } from "./tuning";

export interface VoiceActivity {
  note: number;
  level: number;
  vel: number;
  ch: number;
}

export interface NoteEvent {
  /** 秒（演奏開始からの相対） */
  time: number;
  type: "on" | "off" | "sustain";
  note: number;
  vel: number;
  ch?: number;
}

export class AudioEngine {
  readonly ctx: AudioContext;
  private node: AudioWorkletNode;
  private fx: FxChain;
  private master: GainNode;
  readonly analyser: AnalyserNode;
  private recorder: AudioWorkletNode;
  private recChunks: { l: Float32Array; r: Float32Array }[] = [];
  private recResolve: ((b: { l: Float32Array; r: Float32Array }) => void) | null = null;
  private inst: Instrument | null = null;
  private modwheel = 0;
  private activityListeners = new Set<(v: VoiceActivity[]) => void>();
  private mpe = false;

  private constructor(ctx: AudioContext, node: AudioWorkletNode, recorder: AudioWorkletNode) {
    this.ctx = ctx;
    this.node = node;
    this.recorder = recorder;
    this.fx = new FxChain(ctx);
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.6;
    // 合成 → 楽器バス FX → マスター音量 → 遅延ゼロのリミッタ（兼 録音タップ）→ 出力
    node.connect(this.fx.input);
    this.fx.output.connect(this.master);
    this.master.connect(this.recorder);
    this.recorder.connect(ctx.destination);
    this.recorder.connect(this.analyser);
    node.port.onmessage = (e) => {
      if (e.data?.t === "activity") for (const l of this.activityListeners) l(e.data.voices);
    };
    recorder.port.onmessage = (e) => {
      if (e.data?.t === "chunk") this.recChunks.push({ l: e.data.l, r: e.data.r });
      else if (e.data?.t === "done" && this.recResolve) {
        const total = this.recChunks.reduce((a, c) => a + c.l.length, 0);
        const l = new Float32Array(total);
        const r = new Float32Array(total);
        let o = 0;
        for (const c of this.recChunks) {
          l.set(c.l, o);
          r.set(c.r, o);
          o += c.l.length;
        }
        this.recChunks = [];
        this.recResolve({ l, r });
        this.recResolve = null;
      }
    };
  }

  static async create(): Promise<AudioEngine> {
    const ctx = new AudioContext({ latencyHint: "interactive" });
    await ctx.audioWorklet.addModule(processorUrl);
    const node = new AudioWorkletNode(ctx, "atelier-synth", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    const rec = new AudioWorkletNode(ctx, "atelier-master", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: "explicit" });
    return new AudioEngine(ctx, node, rec);
  }

  /** 出力の遅延（秒）: 処理バッファ＋デバイス出力 */
  get latency(): { base: number; output: number } {
    return { base: this.ctx.baseLatency ?? 0, output: (this.ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0 };
  }

  get sampleRate(): number {
    return this.ctx.sampleRate;
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  private post(m: SynthMessage | SynthMessage[]): void {
    this.node.port.postMessage(m);
  }

  onActivity(cb: (v: VoiceActivity[]) => void): () => void {
    this.activityListeners.add(cb);
    return () => this.activityListeners.delete(cb);
  }

  /** 楽器を丸ごと反映（パッチ・演奏設定・マクロ・全体 FX） */
  setInstrument(inst: Instrument): void {
    this.inst = inst;
    this.post(instrumentMessages(inst, this.mpe));
    this.applyGlobals();
  }

  private applyGlobals(): void {
    if (!this.inst) return;
    const g = effectiveGlobals(this.inst, this.modwheel);
    this.fx.apply(g);
    this.post({ t: "lfo", rate: g.lfoRate, shape: g.lfoShape });
  }

  setMacro(index: number, value: number): void {
    if (this.inst) {
      this.inst = { ...this.inst, macros: this.inst.macros.map((m, i) => (i === index ? { ...m, value } : m)) };
    }
    this.post({ t: "src", index: SRC.macro1 + index, value });
    this.applyGlobals();
  }

  setModWheel(v: number): void {
    this.modwheel = v;
    this.post({ t: "src", index: SRC.modwheel, value: v });
    this.applyGlobals();
  }

  setMpe(on: boolean): void {
    this.mpe = on;
    if (this.inst) this.post(instrumentMessages(this.inst, on));
  }

  setTuning(ts: TuningSettings): void {
    this.post({ t: "tuning", freqs: frequencyTable(ts) });
  }

  noteOn(note: number, vel: number, ch = 0, when?: number): void {
    this.post({ t: "on", note, vel, ch, when });
  }
  noteOff(note: number, ch = 0, when?: number): void {
    this.post({ t: "off", note, ch, when });
  }
  sustain(on: boolean, when?: number): void {
    this.post({ t: "sustain", on, when });
  }
  bend(ch: number, semis: number): void {
    this.post({ t: "bend", ch, semis });
  }
  pressure(ch: number, value: number, note?: number): void {
    this.post({ t: "pressure", ch, value, note });
  }
  timbre(ch: number, value: number): void {
    this.post({ t: "timbre", ch, value });
  }
  allOff(hard = false): void {
    this.post({ t: "allOff", hard });
  }
  clearScheduled(): void {
    this.post({ t: "clearScheduled" });
  }

  setVolume(v: number): void {
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  startRecording(): void {
    this.recChunks = [];
    this.recorder.port.postMessage("start");
  }

  stopRecording(): Promise<{ l: Float32Array; r: Float32Array }> {
    return new Promise((res) => {
      this.recResolve = res;
      this.recorder.port.postMessage("stop");
    });
  }
}

export function instrumentMessages(inst: Instrument, mpe: boolean): SynthMessage[] {
  const { base, routes } = toVoicePatch(inst);
  const msgs: SynthMessage[] = [
    { t: "patch", base, routes },
    { t: "play", polyphony: inst.play.polyphony, mono: inst.play.mono, legato: inst.play.legato, glide: inst.play.glide, mpe },
  ];
  for (let i = 0; i < N_MACROS; i++) msgs.push({ t: "src", index: MOD_SOURCE_INDEX[`macro${i + 1}`], value: inst.macros[i]?.value ?? 0 });
  return msgs;
}

/**
 * オフライン描画（書き出し用）: 実時間と同じワークレット＋同じ FX グラフで描画する。
 * events は秒単位。duration 秒ぶん描画し AudioBuffer を返す。
 */
export async function renderOffline(
  inst: Instrument,
  tuning: TuningSettings,
  events: NoteEvent[],
  duration: number,
  opts: { spatial?: boolean; sampleRate?: number; normalizePeak?: number } = {},
): Promise<AudioBuffer> {
  const sr = opts.sampleRate ?? 48000;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * sr)), sr);
  await ctx.audioWorklet.addModule(processorUrl);
  const g = effectiveGlobals(inst, 0);
  const messages: SynthMessage[] = [...instrumentMessages(inst, false), { t: "tuning", freqs: frequencyTable(tuning) }, { t: "lfo", rate: g.lfoRate, shape: g.lfoShape }];
  const evs: OfflineEvent[] = events.map((e) => ({
    frame: Math.round(e.time * sr),
    type: e.type === "on" ? EV_NOTE_ON : e.type === "off" ? EV_NOTE_OFF : EV_SUSTAIN,
    a: e.type === "sustain" ? (e.vel > 0 ? 1 : 0) : e.note,
    b: e.vel,
    c: e.ch ?? 0,
  }));
  const node = new AudioWorkletNode(ctx, "atelier-synth", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: { messages, events: evs },
  });
  const fx = new FxChain(ctx, { spatial: opts.spatial !== false });
  fx.apply(g, true);
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const lim = new AudioWorkletNode(ctx, "atelier-master", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: "explicit" });
  node.connect(fx.input);
  fx.output.connect(master);
  master.connect(lim);
  lim.connect(ctx.destination);
  const buf = await ctx.startRendering();
  if (opts.normalizePeak) {
    let pk = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
    }
    if (pk > 1e-6) {
      const k = opts.normalizePeak / pk;
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < d.length; i++) d[i] *= k;
      }
    }
  }
  return buf;
}
