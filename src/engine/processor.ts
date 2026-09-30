/**
 * AudioWorklet プロセッサ（オーディオスレッド）。
 * - "atelier-synth": 合成コア Synth を包む。メッセージでパッチ・音符・変調源を受ける。
 * - "atelier-master": 遅延ゼロのピーク・リミッタ（兼 WAV 録音タップ）。
 * このファイルは Vite で単独バンドルされる（DOM 依存を持たない）。
 */

import { EV_ALL_OFF, EV_NOTE_OFF, EV_NOTE_ON, EV_SUSTAIN, Synth } from "./synth";

declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}
declare function registerProcessor(name: string, ctor: unknown): void;

export type SynthMessage =
  | { t: "patch"; base: Float64Array; routes: Float32Array }
  | { t: "play"; polyphony: number; mono: boolean; legato: boolean; glide: number; mpe: boolean }
  | { t: "lfo"; rate: number; shape: number }
  | { t: "tuning"; freqs: Float64Array }
  | { t: "src"; index: number; value: number }
  | { t: "on"; note: number; vel: number; ch: number; when?: number }
  | { t: "off"; note: number; ch: number; when?: number }
  | { t: "bend"; ch: number; semis: number }
  | { t: "pressure"; ch: number; value: number; note?: number }
  | { t: "timbre"; ch: number; value: number }
  | { t: "sustain"; on: boolean; when?: number }
  | { t: "allOff"; hard?: boolean }
  | { t: "clearScheduled" };

export interface OfflineEvent {
  frame: number;
  type: number;
  a: number;
  b: number;
  c: number;
}

class AtelierSynthProcessor extends AudioWorkletProcessor {
  private synth: Synth;
  private blocks = 0;

  constructor(options: { processorOptions?: { messages?: SynthMessage[]; events?: OfflineEvent[] } }) {
    super();
    this.synth = new Synth(sampleRate);
    const po = options?.processorOptions;
    for (const m of po?.messages ?? []) this.handle(m);
    for (const e of po?.events ?? []) this.synth.schedule(e.frame, e.type, e.a, e.b, e.c);
    this.port.onmessage = (e: MessageEvent) => {
      const d = e.data;
      if (Array.isArray(d)) for (const m of d) this.handle(m as SynthMessage);
      else this.handle(d as SynthMessage);
    };
  }

  private at(when: number | undefined): number {
    return when === undefined ? -1 : Math.round(when * sampleRate);
  }

  private handle(m: SynthMessage): void {
    const s = this.synth;
    switch (m.t) {
      case "patch":
        s.setPatch(m.base, m.routes);
        break;
      case "play":
        s.polyphony = m.polyphony;
        s.mono = m.mono;
        s.legato = m.legato;
        s.glide = m.glide;
        s.mpe = m.mpe;
        break;
      case "lfo":
        s.lfoRate = m.rate;
        s.lfoShape = m.shape;
        break;
      case "tuning":
        s.setTuning(m.freqs);
        break;
      case "src":
        s.setGlobalSource(m.index, m.value);
        break;
      case "on": {
        const f = this.at(m.when);
        if (f < 0) s.noteOn(m.note, m.vel, m.ch);
        else s.schedule(f, EV_NOTE_ON, m.note, m.vel, m.ch);
        break;
      }
      case "off": {
        const f = this.at(m.when);
        if (f < 0) s.noteOff(m.note, m.ch);
        else s.schedule(f, EV_NOTE_OFF, m.note, 0, m.ch);
        break;
      }
      case "bend":
        s.setBend(m.ch, m.semis);
        break;
      case "pressure":
        s.setPressure(m.ch, m.value, m.note ?? -1);
        break;
      case "timbre":
        s.setTimbre(m.ch, m.value);
        break;
      case "sustain": {
        const f = this.at(m.when);
        if (f < 0) s.setSustain(m.on);
        else s.schedule(f, EV_SUSTAIN, m.on ? 1 : 0);
        break;
      }
      case "allOff":
        s.clearScheduled();
        s.allNotesOff(!!m.hard);
        break;
      case "clearScheduled":
        s.clearScheduled();
        break;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] ?? out[0];
    L.fill(0);
    if (R !== L) R.fill(0);
    this.synth.frame = currentFrame;
    this.synth.render(L, R, L.length);
    // 安全網: NaN/Inf を 0 に（通常は不発）
    for (let i = 0; i < L.length; i++) {
      if (!(L[i] === L[i]) || L[i] > 8 || L[i] < -8) L[i] = 0;
      if (!(R[i] === R[i]) || R[i] > 8 || R[i] < -8) R[i] = 0;
    }
    if (++this.blocks % 12 === 0) {
      this.port.postMessage({ t: "activity", voices: this.synth.activity() });
    }
    return true;
  }
}

/**
 * マスター段: 先読みなし（遅延ゼロ）のピーク・リミッタ＋録音タップ。
 * 天井を超えるサンプルが来た瞬間に利得を下げ（ステレオ連動）、120ms で戻す。出力は天井を超えない。
 */
class MasterProcessor extends AudioWorkletProcessor {
  private recording = false;
  private chunkL = new Float32Array(4096);
  private chunkR = new Float32Array(4096);
  private pos = 0;
  private gain = 1;
  private readonly ceil = 0.95;
  private readonly rel = Math.exp(-1 / (0.12 * sampleRate));

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => {
      if (e.data === "start") {
        this.recording = true;
        this.pos = 0;
      } else if (e.data === "stop") {
        this.flush();
        this.recording = false;
        this.port.postMessage({ t: "done" });
      }
    };
  }

  private flush(): void {
    if (this.pos === 0) return;
    this.port.postMessage({ t: "chunk", l: this.chunkL.slice(0, this.pos), r: this.chunkR.slice(0, this.pos) });
    this.pos = 0;
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const inp = inputs[0];
    const out = outputs[0];
    const oL = out[0];
    const oR = out[1] ?? out[0];
    if (!inp || !inp.length) {
      oL.fill(0);
      if (oR !== oL) oR.fill(0);
      return true;
    }
    const L = inp[0];
    const R = inp[1] ?? inp[0];
    let g = this.gain;
    const ceil = this.ceil;
    const rel = this.rel;
    for (let i = 0; i < L.length; i++) {
      let l = L[i];
      let r = R[i];
      if (!(l === l)) l = 0;
      if (!(r === r)) r = 0;
      const pk = Math.max(Math.abs(l), Math.abs(r));
      const target = pk > ceil ? ceil / pk : 1;
      g = target < g ? target : target - (target - g) * rel;
      l *= g;
      r *= g;
      oL[i] = l;
      oR[i] = r;
      if (this.recording) {
        this.chunkL[this.pos] = l;
        this.chunkR[this.pos] = r;
        if (++this.pos === this.chunkL.length) this.flush();
      }
    }
    this.gain = g;
    return true;
  }
}

registerProcessor("atelier-synth", AtelierSynthProcessor);
registerProcessor("atelier-master", MasterProcessor);

export { EV_ALL_OFF };
