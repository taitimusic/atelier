/**
 * 音色記述子（解析的に算出。音を描画せずに即時に求まる）。
 *
 * 合成コアと同じ式（モード比・減衰・打点・傾き・パルス幅）からエネルギー分布を見積もり、
 * 知覚に対応する少数の軸を返す。これで:
 *  - 楽器をマップ上に置ける（明るさ × 持続）
 *  - 「楽器の領域」を描ける: ベロシティ × 音高で辿れる音色の広がり＝楽器とは点ではなく面である
 *  - 楽器ごとのオーブ（視覚的アイデンティティ）を作れる
 * 注: synth.ts のモード表計算と式を揃えること。
 */

import type { Instrument } from "./instrument";
import { toVoicePatch } from "./instrument";
import { MAX_MODES, computeRatios } from "./modes";
import { MOD_SOURCES, N_MOD_SOURCES, SRC, VOICE_INDEX, VOICE_PARAMS, denorm } from "./params";

/** マップ上の縦位置: 短く鋭い(0) … 長く柔らかい(1) */
export function mapY(d: Descriptor): number {
  return 0.6 * d.sustain + 0.4 * (1 - d.attack);
}

export interface Descriptor {
  /** 明るさ 0..1（スペクトル重心の対数） */
  brightness: number;
  /** 持続 0..1（実効的な響きの長さの対数） */
  sustain: number;
  /** ノイズ感 0..1 */
  noisiness: number;
  /** 非調和性 0..1（倍音列からのずれ） */
  inharmonicity: number;
  /** 立ち上がりの鋭さ 0..1 */
  attack: number;
  /** スペクトル重心 Hz */
  centroid: number;
}

const I = VOICE_INDEX;
const ratios = new Float64Array(MAX_MODES);

function resolve(inst: Instrument, note: number, vel: number): Float64Array {
  const { base, routes } = toVoicePatch(inst);
  const src = new Float64Array(N_MOD_SOURCES);
  src[SRC.velocity] = (vel - 0.787) / 0.787;
  src[SRC.key] = (note - 60) / 48;
  inst.macros.forEach((m, i) => {
    src[SRC.macro1 + i] = m.value;
  });
  const n = Float64Array.from(base);
  for (let j = 0; j < routes.length / 3; j++) n[routes[j * 3 + 1]] += routes[j * 3 + 2] * src[routes[j * 3]];
  const pv = new Float64Array(n.length);
  VOICE_PARAMS.forEach((s, i) => {
    pv[i] = denorm(s, n[i]);
  });
  return pv;
}

/** ハン窓パルス（長さ T 秒）の振幅スペクトル（DC で 1） */
function hannPulse(f: number, T: number): number {
  const x = f * T;
  if (x < 1e-6) return 1;
  if (Math.abs(x - 1) < 1e-6) return 0.5;
  const s = Math.sin(Math.PI * x) / (Math.PI * x);
  return Math.abs(s / (1 - x * x));
}

export function describe(inst: Instrument, note = 60, vel = 0.8, sr = 48000): Descriptor {
  const pv = resolve(inst, note, vel);
  const f0 = 440 * Math.pow(2, (note - 69) / 12);
  computeRatios(pv[I.structure], pv[I.stiffness], ratios);
  const pos = 0.02 + pv[I.position] * 0.48;
  const tiltExp = (1 - pv[I.brightness]) * 2.6;
  const dTiltExp = (1 - pv[I.driveColor]) * 3.2;
  const even = pv[I.evenModes];
  const decay = pv[I.decay];
  const dampExp = pv[I.damping] * 2.2;
  const period = 1 / Math.max(20, f0);
  const pulseT = Math.max(1 / sr, Math.min(period * 0.015 * Math.pow(60, 1 - pv[I.hardness]), 0.015));
  let gSum = 0;
  let dSum = 0;
  const E: number[] = [];
  const F: number[] = [];
  const T: number[] = [];
  const Ed: number[] = [];
  const R: number[] = [];
  for (let k = 0; k < MAX_MODES; k++) {
    const r = ratios[k];
    const f = f0 * r;
    if (f > sr * 0.45 || f < 16) continue;
    const lr = Math.log(r);
    const Tk = Math.min(60, decay * Math.exp(-dampExp * lr));
    const comb = Math.abs(Math.sin(Math.PI * (k + 1) * pos)) * 0.97 + 0.03;
    const ev = (k & 1) === 1 ? even : 1;
    const g = comb * ev * Math.exp(-tiltExp * lr);
    const d = comb * ev * Math.exp(-dTiltExp * lr) * Math.sqrt(Tk / decay);
    gSum += g * g;
    dSum += d * d;
    const h = hannPulse(f, pulseT);
    E.push((g * g * h * h * Math.min(Tk, 4)) / 6.9);
    Ed.push(d * d);
    F.push(f);
    T.push(Tk);
    R.push(r);
  }
  const strike = pv[I.strike];
  const drive = pv[I.drive];
  const sustainLevel = pv[I.driveSustain];
  const holdFactor = sustainLevel + (1 - sustainLevel) * Math.min(1, pv[I.driveDecay]);
  let Etot = 0;
  let Fsum = 0;
  let Tsum = 0;
  let inh = 0;
  const r0 = R.length ? Math.min(...R) : 1;
  const impScale = gSum > 0 ? (strike * strike) / gSum : 0;
  const drvScale = dSum > 0 ? (drive * drive * holdFactor * 2) / dSum : 0;
  for (let i = 0; i < E.length; i++) {
    const e = E[i] * impScale + Ed[i] * drvScale;
    Etot += e;
    Fsum += F[i] * e;
    Tsum += (E[i] * impScale * T[i] + Ed[i] * drvScale * (sustainLevel > 0.05 ? 10 : pv[I.driveDecay])) || 0;
    const rel = R[i] / r0;
    inh += e * Math.min(0.5, Math.abs(rel - Math.round(rel)));
  }
  const breath = pv[I.breath];
  const noise = pv[I.noise];
  const eBreath = breath * breath * 0.6 * Math.max(0.2, holdFactor);
  const eNoise = noise * noise * Math.min(1, pv[I.noiseDecay] * 3) * 0.8;
  const eStrikeNoise = strike * strike * pv[I.strikeNoise] * 0.02;
  const Eall = Etot + eBreath + eNoise + eStrikeNoise + 1e-12;
  const centroid = (Fsum + eNoise * pv[I.noiseFreq] + eBreath * (Etot > 0 ? Fsum / Etot : 2000) * 1.3 + eStrikeNoise * 5000) / Eall;
  const Teff = Etot > 0 ? Tsum / Etot : pv[I.noiseDecay];
  const brightness = clamp01((Math.log2(Math.max(40, centroid)) - Math.log2(90)) / (Math.log2(7000) - Math.log2(90)));
  const sustain = clamp01(Math.log(Math.max(0.03, Teff) / 0.05) / Math.log(12 / 0.05));
  const noisiness = clamp01((eBreath + eNoise + eStrikeNoise) / Eall);
  const inharmonicity = clamp01((inh / (Etot + 1e-12)) * 2.5);
  const strikeShare = Etot > 0 ? (Etot - E.reduce((a, _, i) => a + Ed[i] * drvScale, 0)) / Etot : 1;
  const dAtk = clamp01(1 - Math.log(pv[I.driveAttack] / 0.003) / Math.log(2 / 0.003));
  const attack = clamp01(strikeShare * (0.35 + 0.65 * pv[I.hardness]) + (1 - strikeShare) * dAtk);
  return { brightness, sustain, noisiness, inharmonicity, attack, centroid };
}

function clamp01(x: number): number {
  return !Number.isFinite(x) ? 0 : x < 0 ? 0 : x > 1 ? 1 : x;
}

export interface RegionGrid {
  keys: number[];
  vels: number[];
  /** points[vi][ki] */
  points: Descriptor[][];
}

/** 楽器の領域: 音域 × ベロシティで辿れる音色の広がり */
export function region(inst: Instrument, nKeys = 7, vels = [0.2, 0.45, 0.7, 1.0]): RegionGrid {
  const lo = inst.play.low;
  const hi = inst.play.high;
  const keys = Array.from({ length: nKeys }, (_, i) => Math.round(lo + ((hi - lo) * i) / (nKeys - 1)));
  const points = vels.map((v) => keys.map((k) => describe(inst, k, v)));
  return { keys, vels, points };
}

/**
 * 同一音源性の目安（0..1）: 領域の隣接点どうしの跳びが小さく、なめらかに繋がっているほど高い。
 * 大きな段差（ある音域だけ別の楽器に聞こえる）を検出する。
 */
export function coherence(g: RegionGrid): number {
  let worst = 0;
  let sum = 0;
  let n = 0;
  const d = (a: Descriptor, b: Descriptor) =>
    Math.hypot(a.brightness - b.brightness, a.sustain - b.sustain, (a.noisiness - b.noisiness) * 0.7, (a.inharmonicity - b.inharmonicity) * 0.7);
  for (let v = 0; v < g.points.length; v++) {
    const row = g.points[v];
    for (let k = 1; k < row.length - 1; k++) {
      // 二階差分＝曲がり（単調な変化は許し、急な折れを罰する）
      const a = row[k - 1];
      const b = row[k];
      const c = row[k + 1];
      const bend = d(b, { ...a, brightness: (a.brightness + c.brightness) / 2, sustain: (a.sustain + c.sustain) / 2, noisiness: (a.noisiness + c.noisiness) / 2, inharmonicity: (a.inharmonicity + c.inharmonicity) / 2 });
      worst = Math.max(worst, bend);
      sum += bend;
      n++;
    }
  }
  const mean = n ? sum / n : 0;
  return clamp01(1 - (mean * 3 + worst * 1.5));
}

export const SOURCE_LABEL = Object.fromEntries(MOD_SOURCES.map((s) => [s.id, s.label]));

/** 共鳴体のモード一覧（表示用）: 比・相対振幅・減衰時間 */
export function modeSpectrum(inst: Instrument, note = 60, vel = 0.8): { ratio: number; amp: number; drive: number; t60: number }[] {
  const pv = resolve(inst, note, vel);
  const f0 = 440 * Math.pow(2, (note - 69) / 12);
  computeRatios(pv[I.structure], pv[I.stiffness], ratios);
  const pos = 0.02 + pv[I.position] * 0.48;
  const tiltExp = (1 - pv[I.brightness]) * 2.6;
  const dTiltExp = (1 - pv[I.driveColor]) * 3.2;
  const even = pv[I.evenModes];
  const decay = pv[I.decay];
  const dampExp = pv[I.damping] * 2.2;
  const pulseT = Math.max(1 / 48000, Math.min((1 / Math.max(20, f0)) * 0.015 * Math.pow(60, 1 - pv[I.hardness]), 0.015));
  const out: { ratio: number; amp: number; drive: number; t60: number }[] = [];
  let gmax = 1e-9;
  let dmax = 1e-9;
  for (let k = 0; k < MAX_MODES; k++) {
    const r = ratios[k];
    if (f0 * r > 21000) continue;
    const lr = Math.log(r);
    const Tk = Math.min(60, decay * Math.exp(-dampExp * lr));
    const comb = Math.abs(Math.sin(Math.PI * (k + 1) * pos)) * 0.97 + 0.03;
    const ev = (k & 1) === 1 ? even : 1;
    const g = comb * ev * Math.exp(-tiltExp * lr) * hannPulse(f0 * r, pulseT) * pv[I.strike];
    const d = comb * ev * Math.exp(-dTiltExp * lr) * Math.sqrt(Tk / decay) * pv[I.drive];
    gmax = Math.max(gmax, g);
    dmax = Math.max(dmax, d);
    out.push({ ratio: r, amp: g, drive: d, t60: Tk });
  }
  const m = Math.max(gmax, dmax);
  return out.map((o) => ({ ...o, amp: o.amp / m, drive: o.drive / m }));
}
