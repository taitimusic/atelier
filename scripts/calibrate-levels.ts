/** 種楽器の音量較正: 中音域・強打の RMS(0.4s) を -15dB に、ただしピークが 0.7 を超えない範囲で。 */
import { Synth } from "../src/engine/synth.ts";
import { SEEDS } from "../src/presets/seeds.ts";
import { toVoicePatch } from "../src/engine/instrument.ts";
const sr = 48000;
const out: Record<string, number> = {};
for (const inst of SEEDS) {
  const s = new Synth(sr);
  const { base, routes } = toVoicePatch(inst);
  s.setPatch(base, routes);
  const n = Math.round((inst.play.low + inst.play.high) / 2);
  s.noteOn(n, 0.85);
  const N = Math.round(0.4 * sr);
  const L = new Float32Array(N), R = new Float32Array(N);
  for (let o = 0; o < N; o += 128) s.render(L, R, Math.min(128, N - o), o);
  let sum = 0, pk = 0;
  for (let i = 0; i < N; i++) { sum += L[i] * L[i] + R[i] * R[i]; pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); }
  const rms = 10 * Math.log10(sum / (2 * N) + 1e-12);
  const off = Math.min(-15 - rms, 20 * Math.log10(0.7 / pk));
  out[inst.id.replace("seed:", "")] = +(inst.params.level + off).toFixed(1);
}
console.log(JSON.stringify(out));
