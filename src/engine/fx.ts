/**
 * 楽器バス（胴・EQ・コーラス・ディレイ・リバーブ・ステレオ幅）をネイティブ Web Audio ノードで組む。
 * 胴（固定共鳴）は線形・時不変なので、全ボイスの和に掛けても各ボイスに掛けたのと同じ＝安価。
 * リアルタイムとオフライン（書き出し）で同一のグラフを使い、書き出し音＝演奏音を保証する。
 */

export interface FxOptions {
  /** false でディレイ・リバーブを外す（サンプル書き出し用） */
  spatial?: boolean;
}

export class FxChain {
  readonly input: GainNode;
  readonly output: GainNode;
  private ctx: BaseAudioContext;
  private body: BiquadFilterNode[];
  private bodyComp: GainNode;
  private low: BiquadFilterNode;
  private mid: BiquadFilterNode;
  private high: BiquadFilterNode;
  private chorusWet: GainNode;
  private chorusDepthL: GainNode;
  private chorusDepthR: GainNode;
  private chorusLfo: OscillatorNode;
  private delay: DelayNode;
  private delayFb: GainNode;
  private delayTone: BiquadFilterNode;
  private delaySend: GainNode;
  private preDelay: DelayNode;
  private reverbSend: GainNode;
  private convs: ConvolverNode[];
  private convGains: GainNode[];
  private activeConv = 0;
  private irKey = "";
  private irTimer: ReturnType<typeof setTimeout> | null = null;
  private wA: GainNode[];
  private spatial: boolean;

  constructor(ctx: BaseAudioContext, opts: FxOptions = {}) {
    this.ctx = ctx;
    this.spatial = opts.spatial !== false;
    const g = (v = 1) => {
      const n = ctx.createGain();
      n.gain.value = v;
      return n;
    };
    this.input = g();
    this.output = g();

    // 胴: 3 つのピーキング共鳴
    this.body = [0, 1, 2].map(() => {
      const f = ctx.createBiquadFilter();
      f.type = "peaking";
      return f;
    });
    this.bodyComp = g();
    this.input.connect(this.body[0]);
    this.body[0].connect(this.body[1]);
    this.body[1].connect(this.body[2]);
    this.body[2].connect(this.bodyComp);

    // EQ
    this.low = ctx.createBiquadFilter();
    this.low.type = "lowshelf";
    this.low.frequency.value = 150;
    this.mid = ctx.createBiquadFilter();
    this.mid.type = "peaking";
    this.mid.Q.value = 0.9;
    this.high = ctx.createBiquadFilter();
    this.high.type = "highshelf";
    this.high.frequency.value = 6000;
    this.bodyComp.connect(this.low);
    this.low.connect(this.mid);
    this.mid.connect(this.high);

    // コーラス（左右逆相で揺れる 2 本のディレイ）
    const chorusSum = g();
    this.high.connect(chorusSum);
    this.chorusWet = g(0);
    const split = ctx.createChannelSplitter(2);
    const merge = ctx.createChannelMerger(2);
    const dL = ctx.createDelay(0.1);
    const dR = ctx.createDelay(0.1);
    dL.delayTime.value = 0.014;
    dR.delayTime.value = 0.017;
    this.chorusLfo = ctx.createOscillator();
    this.chorusLfo.frequency.value = 0.6;
    this.chorusDepthL = g(0.002);
    this.chorusDepthR = g(-0.002);
    this.chorusLfo.connect(this.chorusDepthL);
    this.chorusLfo.connect(this.chorusDepthR);
    this.chorusDepthL.connect(dL.delayTime);
    this.chorusDepthR.connect(dR.delayTime);
    this.chorusLfo.start();
    this.high.connect(split);
    split.connect(dL, 0);
    split.connect(dR, 1);
    dL.connect(merge, 0, 0);
    dR.connect(merge, 0, 1);
    merge.connect(this.chorusWet);
    this.chorusWet.connect(chorusSum);

    // ディレイ（送り＋トーン付きフィードバック）
    const delaySum = g();
    chorusSum.connect(delaySum);
    this.delaySend = g(0);
    this.delay = ctx.createDelay(2);
    this.delayFb = g(0.35);
    this.delayTone = ctx.createBiquadFilter();
    this.delayTone.type = "lowpass";
    chorusSum.connect(this.delaySend);
    this.delaySend.connect(this.delay);
    this.delay.connect(this.delayTone);
    this.delayTone.connect(this.delayFb);
    this.delayFb.connect(this.delay);
    this.delayTone.connect(delaySum);

    // リバーブ（生成 IR を 2 本のコンボルバで交互に差し替え＝切替時にクロスフェード）
    const revSum = g();
    delaySum.connect(revSum);
    this.reverbSend = g(0);
    this.preDelay = ctx.createDelay(0.5);
    delaySum.connect(this.reverbSend);
    this.reverbSend.connect(this.preDelay);
    this.convs = [ctx.createConvolver(), ctx.createConvolver()];
    this.convGains = [g(1), g(0)];
    this.convs.forEach((c, i) => {
      c.normalize = false;
      this.preDelay.connect(c);
      c.connect(this.convGains[i]);
      this.convGains[i].connect(revSum);
    });

    // ステレオ幅（L'=L·a+R·b, R'=R·a+L·b）
    const s2 = ctx.createChannelSplitter(2);
    const m2 = ctx.createChannelMerger(2);
    this.wA = [g(1), g(0), g(1), g(0)]; // LL, RL, RR, LR
    revSum.connect(s2);
    s2.connect(this.wA[0], 0);
    s2.connect(this.wA[1], 1);
    s2.connect(this.wA[2], 1);
    s2.connect(this.wA[3], 0);
    this.wA[0].connect(m2, 0, 0);
    this.wA[1].connect(m2, 0, 0);
    this.wA[2].connect(m2, 0, 1);
    this.wA[3].connect(m2, 0, 1);
    m2.connect(this.output);
  }

  /** 実効値（物理値）を適用。immediate=true は書き出し用（ランプなし） */
  apply(p: Record<string, number>, immediate = false): void {
    const t = this.ctx.currentTime;
    const set = (param: AudioParam, v: number, tc = 0.03) => {
      if (!Number.isFinite(v)) return;
      if (immediate) param.value = v;
      else param.setTargetAtTime(v, t, tc);
    };
    const nyq = this.ctx.sampleRate * 0.45;
    const bm = p.bodyMix;
    const fs = [p.bodyF1, p.bodyF2, p.bodyF3];
    this.body.forEach((f, i) => {
      set(f.frequency, Math.min(nyq, fs[i] * p.bodySize));
      set(f.Q, p.bodyQ);
      set(f.gain, bm * 12 * (i === 2 ? 0.7 : 1));
    });
    set(this.bodyComp.gain, Math.pow(10, (-bm * 5) / 20));
    set(this.low.gain, p.lowShelf);
    set(this.mid.gain, p.midGain);
    set(this.mid.frequency, p.midFreq);
    set(this.high.gain, p.highShelf);
    set(this.chorusWet.gain, p.chorusMix * 0.8);
    set(this.chorusLfo.frequency, p.chorusRate);
    set(this.chorusDepthL.gain, 0.0005 + p.chorusDepth * 0.005);
    set(this.chorusDepthR.gain, -(0.0005 + p.chorusDepth * 0.005));
    set(this.delaySend.gain, this.spatial ? p.delayMix : 0);
    set(this.delay.delayTime, p.delayTime, 0.08);
    set(this.delayFb.gain, p.delayFeedback);
    set(this.delayTone.frequency, Math.min(nyq, p.delayTone));
    set(this.reverbSend.gain, this.spatial ? p.reverbMix * 1.2 : 0);
    set(this.preDelay.delayTime, p.reverbPreDelay);
    const w = this.spatial ? p.width : Math.min(1, p.width);
    const a = (1 + w) / 2;
    const b = (1 - w) / 2;
    set(this.wA[0].gain, a);
    set(this.wA[1].gain, b);
    set(this.wA[2].gain, a);
    set(this.wA[3].gain, b);
    this.updateIR(p.reverbSize, p.reverbTone, immediate);
  }

  private updateIR(size: number, tone: number, immediate: boolean): void {
    const key = `${size.toFixed(2)}|${tone.toFixed(2)}`;
    if (key === this.irKey) return;
    this.irKey = key;
    const run = () => {
      const buf = generateIR(this.ctx, size, tone);
      if (immediate) {
        this.convs[this.activeConv].buffer = buf;
        return;
      }
      const next = 1 - this.activeConv;
      this.convs[next].buffer = buf;
      const t = this.ctx.currentTime;
      this.convGains[next].gain.setTargetAtTime(1, t, 0.05);
      this.convGains[this.activeConv].gain.setTargetAtTime(0, t, 0.05);
      this.activeConv = next;
    };
    if (immediate) run();
    else {
      if (this.irTimer) clearTimeout(this.irTimer);
      this.irTimer = setTimeout(run, 120);
    }
  }
}

/** 残響 IR を生成: 初期反射＋周波数依存で減衰する拡散ノイズ（高域ほど早く消える） */
export function generateIR(ctx: BaseAudioContext, t60: number, tone: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.round(Math.min(10, t60 * 1.15 + 0.05) * sr));
  const buf = ctx.createBuffer(2, len, sr);
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2147483648 - 1;
  };
  const hiStart = 3000 + tone * 15000;
  const hiEnd = 400 + tone * 2500;
  let energy = 0;
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.exp((-6.907755 * t) / t60);
      const fc = hiEnd + (hiStart - hiEnd) * Math.exp((-3 * t) / t60);
      const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      lp += (rnd() - lp) * a;
      // 立ち上がり 8ms のフェードイン（直接音との分離）
      const fade = Math.min(1, t / 0.008);
      d[i] = lp * env * fade;
    }
    // 初期反射
    for (let k = 0; k < 10; k++) {
      const pos = Math.round((0.007 + k * 0.0061 + (c ? 0.0017 : 0) + Math.abs(rnd()) * 0.004) * sr);
      if (pos < len) d[pos] += rnd() * 0.5 * Math.exp(-k * 0.25);
    }
    for (let i = 0; i < len; i++) energy += d[i] * d[i];
  }
  const g = 1 / Math.sqrt(energy / 2 + 1e-9) * 0.9;
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] *= g;
  }
  return buf;
}
