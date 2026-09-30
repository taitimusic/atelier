/**
 * 種楽器のオフライン試聴レンダ（Node・合成コアのみ＋胴の簡易 EQ。空間系 FX は含まない）。
 * 出力: $ATELIER_OUT/renders/node/<seed>.wav（既定 out/）と数値レポート。
 *   各種ごとに [低・中・高音域] × [弱・強] を順に鳴らす。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { Synth } from "../src/engine/synth.ts";
import { SEEDS } from "../src/presets/seeds.ts";
import { toVoicePatch, effectiveGlobals } from "../src/engine/instrument.ts";
import { encodeWav } from "../src/io/wav.ts";

const OUT = `${process.env.ATELIER_OUT ?? "out"}/renders/node`;
mkdirSync(OUT, { recursive: true });
const sr = 48000;
const only = process.argv[2];

function peaking(f: number, q: number, db: number) {
  const A = Math.pow(10, db / 40), w = (2 * Math.PI * f) / sr, al = Math.sin(w) / (2 * q);
  const a0 = 1 + al / A;
  return { b0: (1 + al * A) / a0, b1: (-2 * Math.cos(w)) / a0, b2: (1 - al * A) / a0, a1: (-2 * Math.cos(w)) / a0, a2: (1 - al / A) / a0 };
}

const rows: string[] = [];
for (const inst of SEEDS) {
  if (only && !inst.id.includes(only)) continue;
  const s = new Synth(sr);
  const { base, routes } = toVoicePatch(inst);
  s.setPatch(base, routes);
  s.polyphony = inst.play.polyphony; s.mono = inst.play.mono; s.legato = inst.play.legato; s.glide = inst.play.glide;
  const g = effectiveGlobals(inst, 0);
  s.lfoRate = g.lfoRate; s.lfoShape = g.lfoShape;
  const lo = inst.play.low, hi = inst.play.high;
  const notes = [lo + Math.round((hi - lo) * 0.15), Math.round((lo + hi) / 2), hi - Math.round((hi - lo) * 0.12)];
  const vels = [0.35, 0.9];
  const noteDur = 1.6, slot = 2.2;
  const total = Math.ceil(notes.length * vels.length * slot * sr);
  const L = new Float32Array(total), R = new Float32Array(total);
  let ev = 0;
  for (const n of notes) for (const v of vels) {
    const t0 = ev * slot;
    s.schedule(Math.round(t0 * sr), 1, n, v, 0);
    s.schedule(Math.round((t0 + noteDur) * sr), 2, n, 0, 0);
    ev++;
  }
  for (let o = 0; o < total; o += 128) s.render(L, R, Math.min(128, total - o), o);
  // 胴（3 つのピーキング EQ）
  const bm = g.bodyMix;
  for (const [f, i] of [[g.bodyF1, 0], [g.bodyF2, 1], [g.bodyF3, 2]] as const) {
    const c = peaking(Math.min(f * g.bodySize, sr * 0.45), g.bodyQ, bm * 12 * (i === 2 ? 0.7 : 1));
    for (const ch of [L, R]) {
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let k = 0; k < ch.length; k++) {
        const x = ch[k];
        const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y; ch[k] = y;
      }
    }
  }
  // 数値: 各発音の RMS（最初 0.5s）・ピーク・-40dB 到達時間
  const stats: string[] = [];
  let peakAll = 0, nan = 0;
  for (let k = 0; k < total; k++) { const a = Math.abs(L[k]); if (!Number.isFinite(L[k])) nan++; else if (a > peakAll) peakAll = a; }
  for (let e = 0; e < ev; e++) {
    const a = Math.round(e * slot * sr);
    let sum = 0, pk = 0;
    const n5 = Math.round(0.5 * sr);
    for (let k = a; k < a + n5; k++) { sum += L[k] * L[k]; pk = Math.max(pk, Math.abs(L[k])); }
    const rms = Math.sqrt(sum / n5);
    // 減衰: 20ms 窓のピークが最大の -40dB を下回る時刻
    let t40 = slot;
    for (let k = a; k < a + slot * sr - 960; k += 960) {
      let wp = 0; for (let j = k; j < k + 960; j++) wp = Math.max(wp, Math.abs(L[j]));
      if (k > a + 0.05 * sr && wp < pk * 0.01) { t40 = (k - a) / sr; break; }
    }
    stats.push(`${(20 * Math.log10(rms + 1e-9)).toFixed(0)}dB/${t40.toFixed(1)}s`);
  }
  // 安全網（簡易リミッタ）
  for (const ch of [L, R]) for (let k = 0; k < ch.length; k++) ch[k] = Math.tanh(ch[k]);
  writeFileSync(`${OUT}/${inst.id.replace("seed:", "")}.wav`, encodeWav([L, R], sr, 16));
  rows.push(`${inst.meta.name.padEnd(14, "　")} peak=${peakAll.toFixed(2)} nan=${nan}  ${notes.join("/")}  ${stats.join(" ")}`);
}
console.log("rms(0.5s)/t-40dB per [low p, low f, mid p, mid f, high p, high f]");
console.log(rows.join("\n"));
