/** 合成コアの CPU 予算ベンチ: 16 声 × 64 モード（最悪ケース: 低音・持続駆動＋息）を 48kHz で描画 */
import { Synth } from "../src/engine/synth.ts";
import { VOICE_INDEX, VOICE_PARAMS, norm } from "../src/engine/params.ts";

const sr = 48000;
function run(label: string, set: Record<string, number>, voices: number, baseNote: number) {
  const s = new Synth(sr);
  s.polyphony = 16;
  const base = Array.from(s.base);
  for (const [k, v] of Object.entries(set)) base[VOICE_INDEX[k]] = norm(VOICE_PARAMS[VOICE_INDEX[k]], v);
  s.setPatch(base, []);
  for (let i = 0; i < voices; i++) s.noteOn(baseNote + i * 2, 0.8);
  const L = new Float32Array(128), R = new Float32Array(128);
  const blocks = Math.round(sr / 128) * 2; // 2 秒
  // ウォームアップ
  for (let b = 0; b < 50; b++) { L.fill(0); R.fill(0); s.render(L, R, 128); }
  const t0 = performance.now();
  let peak = 0;
  for (let b = 0; b < blocks; b++) {
    L.fill(0); R.fill(0);
    s.render(L, R, 128);
    for (let i = 0; i < 128; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const ms = performance.now() - t0;
  const perBlockUs = (ms * 1000) / blocks;
  const budgetUs = (128 / sr) * 1e6;
  console.log(`${label.padEnd(34)} voices=${s.activeVoiceCount()} ${perBlockUs.toFixed(1)}µs/block = ${(100 * perBlockUs / budgetUs).toFixed(1)}% of realtime  peak=${peak.toFixed(3)}`);
}
run("strike only (piano-like), low", { decay: 8 }, 16, 28);
run("drive+breath sustained, low", { drive: 0.8, breath: 0.3, driveSustain: 1, decay: 3 }, 16, 28);
run("drive+breath+noise, mid", { drive: 0.8, breath: 0.3, noise: 0.3, noiseDecay: 2, driveSustain: 1 }, 16, 48);
run("vibrato+drift sustained, low", { drive: 0.8, breath: 0.2, vibratoDepth: 30, drift: 0.5, driveSustain: 1 }, 16, 28);
