/**
 * Atelier 合成コア（純粋 TS。AudioWorklet とオフライン描画の両方で使う）。
 *
 * 1 ボイス = 励起（打撃パルス＋持続駆動＋息ノイズ） → モード共鳴体（最大 64 モード）
 *          → 直接ノイズ層 → 飽和 → 定位
 *
 * 持続駆動（弓・息）は「各モードの周波数で自励振動する成分」として実装する。打撃で鳴る共鳴と
 * 同じモード周波数・同じ減衰・同じ打点を共有するので、擦っても打っても「同じ物体」の音になる。
 *
 * リアルタイム規則: process 系メソッドはアロケーションしない（全バッファ事前確保）。
 */

import { MAX_MODES, computeRatios } from "./modes";
import { N_MOD_SOURCES, N_VOICE_PARAMS, VOICE_INDEX, VOICE_PARAMS, SRC } from "./params";

export const MAX_VOICES = 24;
export const MAX_ROUTES = 96;
export const MAX_SEGMENT = 128;
const MAX_EVENTS = 512;

const TWO_PI = Math.PI * 2;
const LN1000 = 6.907755278982137;
const SIN_SIZE = 4096;
const SIN_TABLE = new Float32Array(SIN_SIZE + 1);
for (let i = 0; i <= SIN_SIZE; i++) SIN_TABLE[i] = Math.sin((i / SIN_SIZE) * TWO_PI);

// パラメータ・インデックス
const I = VOICE_INDEX as Record<(typeof VOICE_PARAMS)[number]["id"], number>;
/** モード表の形状に効くパラメータ（変化したときだけ表を作り直す） */
const SHAPE_PARAMS = ["structure", "stiffness", "spread", "position", "brightness", "driveColor", "evenModes", "decay", "damping", "release"].map((id) => VOICE_INDEX[id]);
const SCALE_CODE = new Uint8Array(N_VOICE_PARAMS);
const PMIN = new Float64Array(N_VOICE_PARAMS);
const PMAX = new Float64Array(N_VOICE_PARAMS);
const PLOGR = new Float64Array(N_VOICE_PARAMS);
VOICE_PARAMS.forEach((p, i) => {
  SCALE_CODE[i] = p.scale === "log" ? 1 : p.scale === "sq" ? 2 : 0;
  PMIN[i] = p.min;
  PMAX[i] = p.max;
  PLOGR[i] = p.scale === "log" ? Math.log(p.max / p.min) : 0;
});

/** 高速 tanh（有理近似、|x|>3 で ±1） */
function tanhApprox(x: number): number {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

// イベント種別
export const EV_NOTE_ON = 1;
export const EV_NOTE_OFF = 2;
export const EV_ALL_OFF = 3;
export const EV_SUSTAIN = 4;

const enum Stage {
  Idle = 0,
  Attack = 1,
  Decay = 2,
  Sustain = 3,
  Release = 4,
}

class Env {
  level = 0;
  stage: Stage = Stage.Idle;
  attackInc = 0;
  decayCoef = 0;
  sustain = 0;
  releaseCoef = 0;

  set(sr: number, a: number, d: number, s: number, r: number): void {
    this.attackInc = 1 / Math.max(1, a * sr);
    this.decayCoef = Math.exp(-LN1000 / Math.max(1, d * sr));
    this.sustain = s;
    this.releaseCoef = Math.exp(-LN1000 / Math.max(1, r * sr));
  }
  trigger(): void {
    this.stage = Stage.Attack;
  }
  release(): void {
    if (this.stage !== Stage.Idle) this.stage = Stage.Release;
  }
  /** 1 サンプル進める */
  next(): number {
    switch (this.stage) {
      case Stage.Attack:
        this.level += this.attackInc;
        if (this.level >= 1) {
          this.level = 1;
          this.stage = Stage.Decay;
        }
        break;
      case Stage.Decay:
        this.level = this.sustain + (this.level - this.sustain) * this.decayCoef;
        if (this.level - this.sustain < 1e-4) this.stage = Stage.Sustain;
        break;
      case Stage.Sustain:
        this.level = this.sustain;
        break;
      case Stage.Release:
        this.level *= this.releaseCoef;
        if (this.level < 1e-5) {
          this.level = 0;
          this.stage = Stage.Idle;
        }
        break;
    }
    return this.level;
  }
  /** n サンプルぶん進める（変調用。ブロック粒度） */
  advance(n: number): number {
    // 近似: 1 サンプル処理を n 回ではなく、段ごとに閉形式で進める
    let rem = n;
    while (rem > 0) {
      switch (this.stage) {
        case Stage.Attack: {
          const need = Math.ceil((1 - this.level) / this.attackInc);
          const step = Math.min(need, rem);
          this.level = Math.min(1, this.level + this.attackInc * step);
          rem -= step;
          if (this.level >= 1) this.stage = Stage.Decay;
          break;
        }
        case Stage.Decay:
          this.level = this.sustain + (this.level - this.sustain) * Math.pow(this.decayCoef, rem);
          rem = 0;
          break;
        case Stage.Release:
          this.level *= Math.pow(this.releaseCoef, rem);
          if (this.level < 1e-5) {
            this.level = 0;
            this.stage = Stage.Idle;
          }
          rem = 0;
          break;
        case Stage.Sustain:
          this.level = this.sustain;
          rem = 0;
          break;
        default:
          rem = 0;
      }
    }
    return this.level;
  }
}

class Voice {
  active = false;
  fading = false;
  fadeGain = 1;
  note = 60;
  ch = 0;
  vel = 0.8;
  released = false;
  held = false; // サステインペダルで保持中
  serial = 0;
  age = 0; // サンプル
  seed = 1;
  // ピッチ
  curFreq = 440;
  targetFreq = 440;
  vibPhase = 0;
  drift = 0;
  driftTarget = 0;
  // パラメータ
  readonly pn = new Float64Array(N_VOICE_PARAMS);
  readonly pv = new Float64Array(N_VOICE_PARAMS);
  readonly src = new Float64Array(N_MOD_SOURCES);
  // モード
  readonly ratio = new Float64Array(MAX_MODES);
  readonly detune = new Float64Array(MAX_MODES);
  readonly y1 = new Float64Array(MAX_MODES);
  readonly y2 = new Float64Array(MAX_MODES);
  readonly a1 = new Float64Array(MAX_MODES);
  readonly a2 = new Float64Array(MAX_MODES);
  readonly bImp = new Float64Array(MAX_MODES);
  readonly bNoise = new Float64Array(MAX_MODES);
  readonly dAmp = new Float64Array(MAX_MODES);
  readonly dAmpPrev = new Float64Array(MAX_MODES);
  readonly phase = new Float64Array(MAX_MODES);
  readonly live = new Uint8Array(MAX_MODES);
  readonly rEff = new Float64Array(MAX_MODES);
  readonly rr = new Float64Array(MAX_MODES);
  readonly nFac = new Float64Array(MAX_MODES);
  readonly gShape = new Float64Array(MAX_MODES);
  readonly dShape = new Float64Array(MAX_MODES);
  readonly cosW = new Float64Array(MAX_MODES);
  readonly sinW = new Float64Array(MAX_MODES);
  readonly s1 = new Float64Array(MAX_MODES);
  readonly s2 = new Float64Array(MAX_MODES);
  readonly shapeKey = new Float64Array(16);
  shapeValid = false;
  oscReady = false;
  lastF0 = 0;
  gNorm = 0;
  dNorm = 0;
  // 励起
  pulseLen = 1;
  pulsePos = 1e9;
  pulseAmp = 0;
  pulseNoise = 0;
  readonly dEnv = new Env();
  readonly mEnv = new Env();
  noiseEnv = 0;
  noiseCoef = 0;
  // ノイズ層フィルタ（TPT SVF）
  ic1 = 0;
  ic2 = 0;
  grainState = 0;
  // 出力
  gainPrev = 0;
  panLPrev = 0.707;
  panRPrev = 0.707;
  peak = 0;
  quietBlocks = 0;
  rng = 1;

  rand(): number {
    // xorshift32 → [-1,1)
    let x = this.rng | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rng = x;
    return (x >>> 0) / 2147483648 - 1;
  }
}

export interface ActivityInfo {
  note: number;
  level: number;
  vel: number;
  ch: number;
}

/**
 * 合成エンジン本体。
 * - setPatch(base, routes): base = 正規化ボイスパラメータ、routes = [src, target, amount]×n
 * - noteOn/noteOff は即時。schedule() はサンプル精度の予約。
 */
export class Synth {
  readonly sr: number;
  readonly voices: Voice[] = [];
  readonly base = new Float64Array(N_VOICE_PARAMS);
  readonly routes = new Float32Array(MAX_ROUTES * 3);
  nRoutes = 0;
  readonly gsrc = new Float64Array(N_MOD_SOURCES); // 全体で共有する変調源（modwheel/lfo/macro）
  readonly freqTable = new Float64Array(128);
  readonly bend = new Float64Array(17); // ch 0..15, 16 = 全体
  readonly chPressure = new Float64Array(17);
  readonly chTimbre = new Float64Array(17);
  readonly notePressure = new Float64Array(128);
  polyphony = 12;
  mono = false;
  legato = true;
  glide = 0;
  mpe = false;
  lfoRate = 1.5;
  lfoShape = 0;
  private lfoPhase = 0;
  private lfoSH = 0;
  private sustainPedal = false;
  private serial = 0;
  private lastFreq = 0;
  private monoStack: number[] = [];
  // 予約イベント（リングではなく小さな配列＋件数）
  private evTime = new Float64Array(MAX_EVENTS);
  private evType = new Uint8Array(MAX_EVENTS);
  private evA = new Float64Array(MAX_EVENTS);
  private evB = new Float64Array(MAX_EVENTS);
  private evC = new Float64Array(MAX_EVENTS);
  private nEv = 0;
  /** 経過サンプル（スケジュールの基準） */
  frame = 0;
  // 作業バッファ
  private readonly xImp = new Float64Array(MAX_SEGMENT);
  private readonly xNoise = new Float64Array(MAX_SEGMENT);
  private readonly dEnvBuf = new Float64Array(MAX_SEGMENT);
  private readonly driveBuf = new Float64Array(MAX_SEGMENT);
  private readonly vbuf = new Float64Array(MAX_SEGMENT);
  private readonly modeIdx = new Int32Array(MAX_MODES);
  private readonly coefBuf = new Float64Array(MAX_MODES * 6);
  private readonly oscBuf = new Float64Array(MAX_MODES * 5);
  private readonly oscIdx = new Int32Array(MAX_MODES);

  constructor(sampleRate: number) {
    this.sr = sampleRate;
    for (let i = 0; i < MAX_VOICES; i++) {
      const v = new Voice();
      v.rng = 0x9e3779b9 ^ ((i + 1) * 2654435761);
      this.voices.push(v);
    }
    for (let n = 0; n < 128; n++) this.freqTable[n] = 440 * Math.pow(2, (n - 69) / 12);
    VOICE_PARAMS.forEach((p, i) => {
      this.base[i] = normDefault(p);
    });
  }

  setPatch(base: ArrayLike<number>, routes: ArrayLike<number>): void {
    for (let i = 0; i < N_VOICE_PARAMS; i++) this.base[i] = base[i] ?? this.base[i];
    const n = Math.min(MAX_ROUTES, Math.floor(routes.length / 3));
    for (let i = 0; i < n * 3; i++) this.routes[i] = routes[i];
    this.nRoutes = n;
  }

  setTuning(freqs: ArrayLike<number>): void {
    for (let i = 0; i < 128; i++) {
      const f = freqs[i];
      if (Number.isFinite(f) && f > 0) this.freqTable[i] = f;
    }
  }

  setGlobalSource(index: number, value: number): void {
    this.gsrc[index] = value;
  }

  setBend(ch: number, semis: number): void {
    this.bend[ch < 0 || ch > 15 ? 16 : ch] = semis;
  }
  setPressure(ch: number, v: number, note = -1): void {
    if (note >= 0) this.notePressure[note & 127] = v;
    else this.chPressure[ch < 0 || ch > 15 ? 16 : ch] = v;
  }
  setTimbre(ch: number, v: number): void {
    this.chTimbre[ch < 0 || ch > 15 ? 16 : ch] = v;
  }

  // ---------------------------------------------------------------
  // イベント
  // ---------------------------------------------------------------

  /** frame（サンプル絶対時刻）に予約。過去なら次の描画頭で処理。 */
  schedule(frame: number, type: number, a = 0, b = 0, c = 0): void {
    if (this.nEv >= MAX_EVENTS) return;
    // 挿入ソート（時刻昇順）
    let i = this.nEv++;
    while (i > 0 && this.evTime[i - 1] > frame) {
      this.evTime[i] = this.evTime[i - 1];
      this.evType[i] = this.evType[i - 1];
      this.evA[i] = this.evA[i - 1];
      this.evB[i] = this.evB[i - 1];
      this.evC[i] = this.evC[i - 1];
      i--;
    }
    this.evTime[i] = frame;
    this.evType[i] = type;
    this.evA[i] = a;
    this.evB[i] = b;
    this.evC[i] = c;
  }

  clearScheduled(): void {
    this.nEv = 0;
  }

  private runEvent(i: number): void {
    const t = this.evType[i];
    if (t === EV_NOTE_ON) this.noteOn(this.evA[i], this.evB[i], this.evC[i]);
    else if (t === EV_NOTE_OFF) this.noteOff(this.evA[i], this.evC[i]);
    else if (t === EV_ALL_OFF) this.allNotesOff(this.evA[i] > 0);
    else if (t === EV_SUSTAIN) this.setSustain(this.evA[i] > 0);
  }

  setSustain(on: boolean): void {
    this.sustainPedal = on;
    if (!on) {
      for (const v of this.voices) {
        if (v.active && v.held) {
          v.held = false;
          this.releaseVoice(v);
        }
      }
    }
  }

  allNotesOff(hard = false): void {
    this.monoStack.length = 0;
    for (const v of this.voices) {
      if (!v.active) continue;
      if (hard) {
        v.fading = true;
      } else {
        v.held = false;
        this.releaseVoice(v);
      }
    }
  }

  noteOn(note: number, vel: number, ch = 0): void {
    note = Math.max(0, Math.min(127, Math.round(note)));
    if (vel <= 0) {
      this.noteOff(note, ch);
      return;
    }
    vel = Math.min(1, vel);

    if (this.mono) {
      const idx = this.monoStack.indexOf(note);
      if (idx >= 0) this.monoStack.splice(idx, 1);
      this.monoStack.push(note);
      const cur = this.voices.find((v) => v.active && !v.fading);
      if (cur && !cur.released && this.legato) {
        this.retune(cur, note, ch);
        return;
      }
    }

    // 同じ音が鳴っていれば、その共鳴を保ったまま打ち直す（物理的な再打鍵）
    let v = this.voices.find((x) => x.active && !x.fading && x.note === note && (!this.mpe || x.ch === ch));
    if (!v) v = this.allocate();
    this.startVoice(v, note, vel, ch, v.active);
  }

  noteOff(note: number, ch = 0): void {
    note = Math.max(0, Math.min(127, Math.round(note)));
    if (this.mono) {
      const idx = this.monoStack.indexOf(note);
      if (idx >= 0) this.monoStack.splice(idx, 1);
      const cur = this.voices.find((v) => v.active && !v.fading && !v.released);
      if (cur && cur.note === note && this.monoStack.length > 0) {
        this.retune(cur, this.monoStack[this.monoStack.length - 1], cur.ch);
        return;
      }
    }
    for (const v of this.voices) {
      if (v.active && !v.fading && !v.released && v.note === note && (!this.mpe || v.ch === ch)) {
        if (this.sustainPedal) v.held = true;
        else this.releaseVoice(v);
      }
    }
  }

  private retune(v: Voice, note: number, ch: number): void {
    v.note = note;
    v.ch = ch;
    v.targetFreq = this.freqTable[note];
    v.src[SRC.key] = (note - 60) / 48;
    if (this.glide <= 0) v.curFreq = v.targetFreq;
  }

  private releaseVoice(v: Voice): void {
    if (v.released) return;
    v.released = true;
    v.dEnv.release();
    v.mEnv.release();
  }

  private allocate(): Voice {
    let activeCount = 0;
    for (const v of this.voices) if (v.active && !v.fading) activeCount++;
    const limit = this.mono ? 1 : Math.max(1, Math.min(MAX_VOICES - 4, this.polyphony));
    if (activeCount >= limit) {
      // 盗む: 離鍵済みで最も静かな声 → なければ最古
      let victim: Voice | null = null;
      for (const v of this.voices) {
        if (!v.active || v.fading || !v.released) continue;
        if (!victim || v.peak < victim.peak) victim = v;
      }
      if (!victim) {
        for (const v of this.voices) {
          if (!v.active || v.fading) continue;
          if (!victim || v.serial < victim.serial) victim = v;
        }
      }
      if (victim) {
        victim.fading = true;
        victim.fadeGain = 1;
      }
    }
    for (const v of this.voices) if (!v.active) return v;
    // 物理スロットも満杯: 最も古いフェード中の声を即時再利用
    let oldest = this.voices[0];
    for (const v of this.voices) if (v.serial < oldest.serial) oldest = v;
    oldest.active = false;
    return oldest;
  }

  private startVoice(v: Voice, note: number, vel: number, ch: number, retrigger: boolean): void {
    const wasActive = v.active && retrigger;
    v.active = true;
    v.fading = false;
    v.fadeGain = 1;
    v.note = note;
    v.ch = ch;
    v.vel = vel;
    v.released = false;
    v.held = false;
    v.serial = ++this.serial;
    v.age = 0;
    v.quietBlocks = 0;
    v.targetFreq = this.freqTable[note];
    v.curFreq = this.glide > 0 && this.lastFreq > 0 ? this.lastFreq : v.targetFreq;
    this.lastFreq = v.targetFreq;
    // 音ごとの変調源
    v.src[SRC.velocity] = (vel - 0.787) / 0.787;
    v.src[SRC.key] = (note - 60) / 48;
    v.src[SRC.random] = v.rand();
    v.src[SRC.pressure] = 0;
    // モードの個体差（音高ごとに決定論的＝同じ鍵は同じ個体）
    let s = (note + 1) * 7919;
    for (let k = 0; k < MAX_MODES; k++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      v.detune[k] = (s / 0x7fffffff) * 2 - 1;
    }
    v.shapeValid = false;
    if (!wasActive) {
      v.live.fill(0);
      v.oscReady = false;
      v.y1.fill(0);
      v.y2.fill(0);
      v.dAmpPrev.fill(0);
      v.ic1 = v.ic2 = 0;
      v.gainPrev = 0;
      v.vibPhase = 0;
      v.drift = 0;
      for (let k = 0; k < MAX_MODES; k++) v.phase[k] = (v.rand() + 1) * Math.PI;
    }
    this.resolve(v);
    const pv = v.pv;
    // 打撃パルス: 硬さ → 接触時間。基音周期に対する割合で決める（0.9 周期 … 0.015 周期）。
    // 同じ硬さなら全音域で同じ倍音の広がりになる＝同一音源性。絶対時間は 15ms で頭打ち。
    const h = pv[I.hardness];
    const period = sr0(this.sr) / Math.max(20, v.targetFreq);
    const frac = 0.015 * Math.pow(60, 1 - h);
    v.pulseLen = Math.max(1, Math.round(Math.min(period * frac, this.sr * 0.015)));
    v.pulsePos = 0;
    v.pulseAmp = pv[I.strike];
    v.pulseNoise = pv[I.strikeNoise];
    v.dEnv.set(this.sr, pv[I.driveAttack], pv[I.driveDecay], pv[I.driveSustain], pv[I.driveRelease]);
    v.mEnv.set(this.sr, pv[I.modAttack], pv[I.modDecay], pv[I.modSustain], pv[I.modRelease]);
    if (!wasActive) {
      v.dEnv.level = 0;
      v.mEnv.level = 0;
    }
    v.dEnv.trigger();
    v.mEnv.trigger();
    v.noiseEnv = 1;
  }

  /** 変調マトリクスを評価して pn/pv を更新 */
  private resolve(v: Voice): void {
    const pn = v.pn;
    const src = v.src;
    const g = this.gsrc;
    // 全体の変調源をボイスへ写す
    for (let i: number = SRC.modwheel; i < N_MOD_SOURCES; i++) {
      if (i === SRC.random || i === SRC.modenv) continue;
      src[i] = g[i];
    }
    const chIdx = this.mpe ? v.ch : 16;
    src[SRC.pressure] = Math.max(this.chPressure[chIdx], this.chPressure[16], this.notePressure[v.note]);
    src[SRC.timbre] = this.mpe ? this.chTimbre[v.ch] : this.chTimbre[16];
    src[SRC.modenv] = v.mEnv.level;
    for (let i = 0; i < N_VOICE_PARAMS; i++) pn[i] = this.base[i];
    const r = this.routes;
    for (let j = 0; j < this.nRoutes; j++) {
      const o = j * 3;
      pn[r[o + 1]] += r[o + 2] * src[r[o]];
    }
    const pv = v.pv;
    for (let i = 0; i < N_VOICE_PARAMS; i++) {
      let x = pn[i];
      x = x < 0 ? 0 : x > 1 ? 1 : x;
      const c = SCALE_CODE[i];
      pv[i] = c === 1 ? PMIN[i] * Math.exp(PLOGR[i] * x) : c === 2 ? PMIN[i] + (PMAX[i] - PMIN[i]) * x * x : PMIN[i] + (PMAX[i] - PMIN[i]) * x;
    }
  }

  // ---------------------------------------------------------------
  // 描画
  // ---------------------------------------------------------------

  /** outL/outR に frames サンプル加算描画（配列は事前にゼロ化しておくこと） */
  render(outL: Float32Array, outR: Float32Array, frames: number, offset = 0): void {
    let pos = 0;
    while (pos < frames) {
      // 期限の来たイベントを処理
      while (this.nEv > 0 && this.evTime[0] <= this.frame + pos) {
        this.runEvent(0);
        this.shiftEvents();
      }
      let seg = Math.min(MAX_SEGMENT, frames - pos);
      if (this.nEv > 0) {
        const until = Math.floor(this.evTime[0] - (this.frame + pos));
        if (until > 0 && until < seg) seg = until;
      }
      this.renderSegment(outL, outR, offset + pos, seg);
      pos += seg;
    }
    this.frame += frames;
  }

  private shiftEvents(): void {
    for (let i = 1; i < this.nEv; i++) {
      this.evTime[i - 1] = this.evTime[i];
      this.evType[i - 1] = this.evType[i];
      this.evA[i - 1] = this.evA[i];
      this.evB[i - 1] = this.evB[i];
      this.evC[i - 1] = this.evC[i];
    }
    this.nEv--;
  }

  private renderSegment(outL: Float32Array, outR: Float32Array, off: number, n: number): void {
    const dt = n / this.sr;
    // LFO（全体で共有）
    this.lfoPhase += this.lfoRate * dt;
    if (this.lfoPhase >= 1) {
      this.lfoPhase -= Math.floor(this.lfoPhase);
      this.lfoSH = Math.random() * 2 - 1;
    }
    this.gsrc[SRC.lfo] = lfoValue(this.lfoPhase, this.lfoShape, this.lfoSH);

    for (const v of this.voices) {
      if (!v.active) continue;
      this.renderVoice(v, outL, outR, off, n);
    }
  }

  private renderVoice(v: Voice, outL: Float32Array, outR: Float32Array, off: number, n: number): void {
    const sr = this.sr;
    const nyq = sr * 0.45;
    v.mEnv.advance(n);
    this.resolve(v);
    const pv = v.pv;
    const t = v.age / sr;

    // --- ピッチ ---
    if (this.glide > 0 && v.curFreq !== v.targetFreq) {
      const c = Math.exp(-(n / sr) / Math.max(0.001, this.glide * 0.35));
      v.curFreq = v.targetFreq * Math.pow(v.curFreq / v.targetFreq, c);
      if (Math.abs(v.curFreq / v.targetFreq - 1) < 1e-4) v.curFreq = v.targetFreq;
    } else v.curFreq = v.targetFreq;
    let semis = this.bend[16] + (this.mpe ? this.bend[v.ch] : 0) + pv[I.fine] / 100;
    const pe = pv[I.pitchEnv];
    if (pe !== 0) semis += pe * Math.exp((-t * 4.6) / pv[I.pitchEnvTime]);
    const vd = pv[I.vibratoDepth];
    if (vd > 0) {
      v.vibPhase += pv[I.vibratoRate] * (n / sr);
      v.vibPhase -= Math.floor(v.vibPhase);
      const delay = pv[I.vibratoDelay];
      const ramp = t < delay ? 0 : Math.min(1, (t - delay) / 0.4);
      semis += (vd / 100) * ramp * SIN_TABLE[(v.vibPhase * SIN_SIZE) | 0];
    }
    const dr = pv[I.drift];
    if (dr > 0) {
      if (v.rand() > 0.97) v.driftTarget = v.rand();
      v.drift += (v.driftTarget - v.drift) * 0.02;
      semis += dr * 0.25 * v.drift;
    }
    const f0 = v.curFreq * Math.pow(2, semis / 12);

    // --- モード表（形状が変わった時だけ再計算。音高だけの変化は cos/sin のみ更新） ---
    const sk = v.shapeKey;
    const damped = v.released && !v.held ? 1 : 0;
    let shapeChanged = !v.shapeValid;
    for (let q = 0; q < SHAPE_PARAMS.length; q++) {
      const x = pv[SHAPE_PARAMS[q]];
      if (sk[q] !== x) {
        sk[q] = x;
        shapeChanged = true;
      }
    }
    if (sk[SHAPE_PARAMS.length] !== damped) {
      sk[SHAPE_PARAMS.length] = damped;
      shapeChanged = true;
    }
    if (shapeChanged) {
      v.shapeValid = true;
      computeRatios(pv[I.structure], pv[I.stiffness], v.ratio);
      const spread = pv[I.spread] * 0.035;
      const pos = 0.02 + pv[I.position] * 0.48;
      const tiltExp = (1 - pv[I.brightness]) * 2.6;
      const dTiltExp = (1 - pv[I.driveColor]) * 3.2;
      const even = pv[I.evenModes];
      const decay = pv[I.decay];
      const dampExp = pv[I.damping] * 2.2;
      const relT = pv[I.release];
      for (let k = 0; k < MAX_MODES; k++) {
        const r = v.ratio[k] * (1 + spread * v.detune[k]);
        v.rEff[k] = r;
        const lr = Math.log(r);
        let T = decay * Math.exp(-dampExp * lr);
        if (T > 60) T = 60;
        if (damped && T > relT) T = relT;
        const rr = Math.exp(-LN1000 / (T * sr));
        v.rr[k] = rr;
        v.nFac[k] = Math.sqrt(2 * (1 - rr * rr));
        const comb = Math.abs(Math.sin(Math.PI * (k + 1) * pos)) * 0.97 + 0.03;
        const ev = (k & 1) === 1 ? even : 1;
        v.gShape[k] = comb * ev * Math.exp(-tiltExp * lr);
        v.dShape[k] = comb * ev * Math.exp(-dTiltExp * lr) * Math.sqrt(T / decay);
      }
    }
    if (shapeChanged || f0 !== v.lastF0) {
      let gSum = 0;
      let dSum = 0;
      for (let k = 0; k < MAX_MODES; k++) {
        const f = f0 * v.rEff[k];
        if (f > nyq || f < 16) {
          if (v.live[k]) {
            v.live[k] = 0;
            v.y1[k] = v.y2[k] = 0;
            v.dAmpPrev[k] = 0;
          }
          v.bImp[k] = v.bNoise[k] = v.dAmp[k] = 0;
          continue;
        }
        const w = (TWO_PI * f) / sr;
        const c = Math.cos(w);
        const sn = Math.sin(w);
        if (!v.live[k] || !v.oscReady) {
          // 発振器を初期位相から開始
          const ph = v.phase[k];
          v.s1[k] = Math.sin(ph);
          v.s2[k] = Math.sin(ph - w);
          v.live[k] = 1;
        } else if (c !== v.cosW[k]) {
          // 周波数変化: 現在の位相を保ったまま状態を変換（振幅も正規化）
          const s1 = v.s1[k];
          const cosPh = (s1 * v.cosW[k] - v.s2[k]) / v.sinW[k];
          const A = Math.sqrt(s1 * s1 + cosPh * cosPh) || 1;
          v.s1[k] = s1 / A;
          v.s2[k] = (s1 * c - cosPh * sn) / A;
        }
        v.cosW[k] = c;
        v.sinW[k] = sn;
        const rr = v.rr[k];
        v.a1[k] = 2 * rr * c;
        v.a2[k] = rr * rr;
        const g = v.gShape[k];
        v.bImp[k] = g * sn;
        v.bNoise[k] = g * sn * v.nFac[k];
        const d = v.dShape[k];
        v.dAmp[k] = d;
        gSum += g * g;
        dSum += d * d;
      }
      v.oscReady = true;
      v.lastF0 = f0;
      v.gNorm = gSum > 0 ? 1 / Math.sqrt(gSum) : 0;
      v.dNorm = dSum > 0 ? 1 / Math.sqrt(dSum) : 0;
    }
    const gNorm = v.gNorm;
    const dNorm = v.dNorm * pv[I.drive];

    // --- 励起バッファ ---
    const xImp = this.xImp;
    const xNoise = this.xNoise;
    const dEnvBuf = this.dEnvBuf;
    const breath = pv[I.breath];
    const grain = pv[I.grain] * 16;
    const gc = 1 - Math.exp((-TWO_PI * 30) / sr);
    let pulseActive = v.pulsePos < v.pulseLen;
    let anyNoise = breath > 0;
    for (let i = 0; i < n; i++) {
      let x = 0;
      if (v.pulsePos < v.pulseLen) {
        const L = v.pulseLen;
        const p = L <= 1 ? 1 : (1 - Math.cos((TWO_PI * (v.pulsePos + 0.5)) / L)) / L;
        const sn = v.pulseNoise;
        x = v.pulseAmp * p * (1 - sn + sn * v.rand() * 3);
        v.pulsePos++;
      }
      xImp[i] = x;
      const e = v.dEnv.next();
      v.grainState += (v.rand() - v.grainState) * gc;
      const eg = e * (1 + grain * v.grainState);
      dEnvBuf[i] = eg < 0 ? 0 : eg;
      xNoise[i] = anyNoise ? breath * e * v.rand() * 1.7 : 0;
    }

    // --- モード共鳴体 ---
    const buf = this.vbuf;
    buf.fill(0, 0, n);
    const drv = this.driveBuf;
    const hasDrive = dNorm > 0 || v.dEnv.level > 0;
    if (hasDrive) drv.fill(0, 0, n);
    const invN = 1 / n;
    const driven = pulseActive || anyNoise;
    // 共鳴: 生きているモードを集め、4 本ずつ並列に処理（再帰の依存チェーンを隠す）
    const idx = this.modeIdx;
    let m = 0;
    for (let k = 0; k < MAX_MODES; k++) {
      if (!v.live[k]) continue;
      if (!driven && Math.abs(v.y1[k]) + Math.abs(v.y2[k]) < 1e-9) {
        v.y1[k] = v.y2[k] = 0;
        continue;
      }
      idx[m++] = k;
    }
    const cb = this.coefBuf;
    for (let j = 0; j < m; j++) {
      const k = idx[j];
      const o = j * 6;
      cb[o] = v.a1[k];
      cb[o + 1] = v.a2[k];
      cb[o + 2] = v.bImp[k] * gNorm;
      cb[o + 3] = v.bNoise[k] * gNorm;
      cb[o + 4] = v.y1[k];
      cb[o + 5] = v.y2[k];
    }
    let j = 0;
    for (; j + 4 <= m; j += 4) {
      if (driven) res4(cb, j * 6, buf, xImp, xNoise, n);
      else free4(cb, j * 6, buf, n);
    }
    for (; j < m; j++) res1(cb, j * 6, buf, xImp, xNoise, n, driven);
    for (let q = 0; q < m; q++) {
      const k = idx[q];
      v.y1[k] = cb[q * 6 + 4];
      v.y2[k] = cb[q * 6 + 5];
    }
    if (hasDrive) {
      // 持続駆動: 再帰正弦発振器（状態をブロック間で持ち越す）
      const ob = this.oscBuf;
      const oi = this.oscIdx;
      let q = 0;
      for (let k = 0; k < MAX_MODES; k++) {
        if (!v.live[k]) continue;
        const target = v.dAmp[k] * dNorm;
        const prev = v.dAmpPrev[k];
        if (target > 1e-4 || prev > 1e-4) {
          const o = q * 5;
          ob[o] = 2 * v.cosW[k];
          ob[o + 1] = v.s1[k];
          ob[o + 2] = v.s2[k];
          ob[o + 3] = prev;
          ob[o + 4] = (target - prev) * invN;
          oi[q++] = k;
        }
        v.dAmpPrev[k] = target;
      }
      let r = 0;
      for (; r + 4 <= q; r += 4) osc4(ob, r * 5, drv, n);
      for (; r < q; r++) osc1(ob, r * 5, drv, n);
      for (let z = 0; z < q; z++) {
        const k = oi[z];
        v.s1[k] = ob[z * 5 + 1];
        v.s2[k] = ob[z * 5 + 2];
      }
    }
    if (hasDrive) for (let i = 0; i < n; i++) buf[i] += drv[i] * dEnvBuf[i];

    // --- 直接ノイズ層（TPT SVF バンドパス） ---
    const nl = pv[I.noise];
    if (nl > 0 && v.noiseEnv > 1e-5) {
      const fc = Math.min(pv[I.noiseFreq], sr * 0.45);
      const gq = Math.tan((Math.PI * fc) / sr);
      const kq = 1 / pv[I.noiseQ];
      const h1 = 1 / (1 + gq * (gq + kq));
      const h2 = gq * h1;
      const h3 = gq * h2;
      const coef = Math.exp(-LN1000 / (pv[I.noiseDecay] * sr));
      let env = v.noiseEnv;
      let ic1 = v.ic1;
      let ic2 = v.ic2;
      const amp = nl * 1.2;
      for (let i = 0; i < n; i++) {
        const x = v.rand() * env;
        env *= coef;
        const v3 = x - ic2;
        const v1 = h1 * ic1 + h2 * v3;
        const v2 = ic2 + h2 * ic1 + h3 * v3;
        ic1 = 2 * v1 - ic1;
        ic2 = 2 * v2 - ic2;
        buf[i] += amp * kq * v1 * 2;
      }
      v.noiseEnv = env;
      v.ic1 = ic1;
      v.ic2 = ic2;
    }

    // --- 飽和・音量・定位 ---
    const sat = pv[I.saturation];
    const gain = Math.pow(10, pv[I.level] / 20);
    let pan = pv[I.pan] + pv[I.keySpread] * 0.7 * Math.max(-1, Math.min(1, v.src[SRC.key]));
    pan = pan < -1 ? -1 : pan > 1 ? 1 : pan;
    const ang = (pan + 1) * 0.25 * Math.PI;
    const pl = Math.cos(ang);
    const pr = Math.sin(ang);
    const g0 = v.gainPrev;
    const dg = (gain - g0) * invN;
    const dpl = (pl - v.panLPrev) * invN;
    const dpr = (pr - v.panRPrev) * invN;
    let gcur = g0;
    let lcur = v.panLPrev;
    let rcur = v.panRPrev;
    const pre = 1 + sat * 14;
    const post = 1 / Math.pow(pre, 0.7);
    let peak = 0;
    let fadeGain = v.fadeGain;
    const fadeStep = v.fading ? 1 / (0.006 * sr) : 0;
    for (let i = 0; i < n; i++) {
      let y = buf[i];
      if (sat > 0) y = tanhApprox(y * pre) * post;
      y *= gcur;
      if (v.fading) {
        fadeGain -= fadeStep;
        if (fadeGain < 0) fadeGain = 0;
        y *= fadeGain;
      }
      const ay = y < 0 ? -y : y;
      if (ay > peak) peak = ay;
      outL[off + i] += y * lcur;
      outR[off + i] += y * rcur;
      gcur += dg;
      lcur += dpl;
      rcur += dpr;
    }
    v.gainPrev = gain;
    v.panLPrev = pl;
    v.panRPrev = pr;
    v.fadeGain = fadeGain;
    v.peak = peak;
    v.age += n;

    // --- 終了判定・安全網 ---
    if (!Number.isFinite(peak) || peak > 1e4) {
      // 数値破綻: このボイスを捨てる（出力側でもクランプされる）
      v.active = false;
      v.y1.fill(0);
      v.y2.fill(0);
      return;
    }
    if (v.fading && fadeGain <= 0) {
      v.active = false;
      return;
    }
    const envDone = v.dEnv.level < 1e-4 && v.dEnv.stage !== Stage.Attack;
    if (peak < 2e-5 && envDone && v.pulsePos >= v.pulseLen && v.age > sr * 0.05) {
      if (++v.quietBlocks > 8) v.active = false;
    } else v.quietBlocks = 0;
  }

  /** UI 用: 鳴っているボイスの一覧（アロケーションあり。ワークレットでは低頻度で呼ぶ） */
  activity(): ActivityInfo[] {
    const out: ActivityInfo[] = [];
    for (const v of this.voices) if (v.active && !v.fading) out.push({ note: v.note, level: v.peak, vel: v.vel, ch: v.ch });
    return out;
  }

  activeVoiceCount(): number {
    let c = 0;
    for (const v of this.voices) if (v.active) c++;
    return c;
  }
}


// ------------------------------------------------------------------
// DSP カーネル（小さく単相に保ち、JIT に最適化させる）
// cb: [a1, a2, bImp, bNoise, y1, y2] × モード
// ------------------------------------------------------------------

function res4(cb: Float64Array, o: number, buf: Float64Array, xi: Float64Array, xn: Float64Array, n: number): void {
  const a1a = cb[o], a2a = cb[o + 1], bia = cb[o + 2], bna = cb[o + 3];
  const a1b = cb[o + 6], a2b = cb[o + 7], bib = cb[o + 8], bnb = cb[o + 9];
  const a1c = cb[o + 12], a2c = cb[o + 13], bic = cb[o + 14], bnc = cb[o + 15];
  const a1d = cb[o + 18], a2d = cb[o + 19], bid = cb[o + 20], bnd = cb[o + 21];
  let ya1 = cb[o + 4], ya2 = cb[o + 5];
  let yb1 = cb[o + 10], yb2 = cb[o + 11];
  let yc1 = cb[o + 16], yc2 = cb[o + 17];
  let yd1 = cb[o + 22], yd2 = cb[o + 23];
  for (let i = 0; i < n; i++) {
    const x = xi[i];
    const z = xn[i];
    const ya = bia * x + bna * z + a1a * ya1 - a2a * ya2;
    const yb = bib * x + bnb * z + a1b * yb1 - a2b * yb2;
    const yc = bic * x + bnc * z + a1c * yc1 - a2c * yc2;
    const yd = bid * x + bnd * z + a1d * yd1 - a2d * yd2;
    ya2 = ya1; ya1 = ya;
    yb2 = yb1; yb1 = yb;
    yc2 = yc1; yc1 = yc;
    yd2 = yd1; yd1 = yd;
    buf[i] += ya + yb + yc + yd;
  }
  cb[o + 4] = ya1; cb[o + 5] = ya2;
  cb[o + 10] = yb1; cb[o + 11] = yb2;
  cb[o + 16] = yc1; cb[o + 17] = yc2;
  cb[o + 22] = yd1; cb[o + 23] = yd2;
}

function free4(cb: Float64Array, o: number, buf: Float64Array, n: number): void {
  const a1a = cb[o], a2a = cb[o + 1];
  const a1b = cb[o + 6], a2b = cb[o + 7];
  const a1c = cb[o + 12], a2c = cb[o + 13];
  const a1d = cb[o + 18], a2d = cb[o + 19];
  let ya1 = cb[o + 4], ya2 = cb[o + 5];
  let yb1 = cb[o + 10], yb2 = cb[o + 11];
  let yc1 = cb[o + 16], yc2 = cb[o + 17];
  let yd1 = cb[o + 22], yd2 = cb[o + 23];
  for (let i = 0; i < n; i++) {
    const ya = a1a * ya1 - a2a * ya2;
    const yb = a1b * yb1 - a2b * yb2;
    const yc = a1c * yc1 - a2c * yc2;
    const yd = a1d * yd1 - a2d * yd2;
    ya2 = ya1; ya1 = ya;
    yb2 = yb1; yb1 = yb;
    yc2 = yc1; yc1 = yc;
    yd2 = yd1; yd1 = yd;
    buf[i] += ya + yb + yc + yd;
  }
  cb[o + 4] = ya1; cb[o + 5] = ya2;
  cb[o + 10] = yb1; cb[o + 11] = yb2;
  cb[o + 16] = yc1; cb[o + 17] = yc2;
  cb[o + 22] = yd1; cb[o + 23] = yd2;
}

function res1(cb: Float64Array, o: number, buf: Float64Array, xi: Float64Array, xn: Float64Array, n: number, driven: boolean): void {
  const a1 = cb[o], a2 = cb[o + 1], bi = driven ? cb[o + 2] : 0, bn = driven ? cb[o + 3] : 0;
  let y1 = cb[o + 4], y2 = cb[o + 5];
  for (let i = 0; i < n; i++) {
    const y = bi * xi[i] + bn * xn[i] + a1 * y1 - a2 * y2;
    y2 = y1;
    y1 = y;
    buf[i] += y;
  }
  cb[o + 4] = y1;
  cb[o + 5] = y2;
}

// ob: [2cos(w), s1, s2, amp, dAmp] × モード
function osc4(ob: Float64Array, o: number, out: Float64Array, n: number): void {
  const ca = ob[o], cbb = ob[o + 5], cc = ob[o + 10], cd = ob[o + 15];
  let a1 = ob[o + 1], a2 = ob[o + 2], aa = ob[o + 3];
  const da = ob[o + 4];
  let b1 = ob[o + 6], b2 = ob[o + 7], ab = ob[o + 8];
  const db = ob[o + 9];
  let c1 = ob[o + 11], c2 = ob[o + 12], ac = ob[o + 13];
  const dc = ob[o + 14];
  let d1 = ob[o + 16], d2 = ob[o + 17], ad = ob[o + 18];
  const dd = ob[o + 19];
  for (let i = 0; i < n; i++) {
    const a0 = ca * a1 - a2;
    const b0 = cbb * b1 - b2;
    const c0 = cc * c1 - c2;
    const d0 = cd * d1 - d2;
    a2 = a1; a1 = a0;
    b2 = b1; b1 = b0;
    c2 = c1; c1 = c0;
    d2 = d1; d1 = d0;
    out[i] += aa * a0 + ab * b0 + ac * c0 + ad * d0;
    aa += da; ab += db; ac += dc; ad += dd;
  }
  ob[o + 1] = a1; ob[o + 2] = a2;
  ob[o + 6] = b1; ob[o + 7] = b2;
  ob[o + 11] = c1; ob[o + 12] = c2;
  ob[o + 16] = d1; ob[o + 17] = d2;
}

function osc1(ob: Float64Array, o: number, out: Float64Array, n: number): void {
  const c = ob[o];
  let s1 = ob[o + 1], s2 = ob[o + 2], a = ob[o + 3];
  const da = ob[o + 4];
  for (let i = 0; i < n; i++) {
    const s0 = c * s1 - s2;
    s2 = s1;
    s1 = s0;
    out[i] += a * s0;
    a += da;
  }
  ob[o + 1] = s1;
  ob[o + 2] = s2;
}

function sr0(sr: number): number {
  return sr;
}

function normDefault(p: (typeof VOICE_PARAMS)[number]): number {
  const v = p.def;
  if (p.scale === "log") return Math.log(v / p.min) / Math.log(p.max / p.min);
  if (p.scale === "sq") return Math.sqrt((v - p.min) / (p.max - p.min));
  return (v - p.min) / (p.max - p.min);
}

/** LFO: 正弦(0)→三角(1/3)→矩形(2/3)→S&H(1) を連続に */
export function lfoValue(phase: number, shape: number, sh: number): number {
  const sine = Math.sin(phase * TWO_PI);
  const tri = 1 - 4 * Math.abs(phase - 0.5);
  const sq = phase < 0.5 ? 1 : -1;
  const x = Math.max(0, Math.min(1, shape)) * 3;
  if (x < 1) return sine + (tri - sine) * x;
  if (x < 2) return tri + (sq - tri) * (x - 1);
  return sq + (sh - sq) * (x - 2);
}
