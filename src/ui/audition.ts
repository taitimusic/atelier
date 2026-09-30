/** 試聴フレーズ: 持続する楽器は和音、減衰する楽器は分散和音を鳴らす（音域の中央へ移調） */
import type { Instrument } from "../engine/instrument";
import { ensureAudio } from "../state/audio";
import { descriptorOf } from "./hooks";

let lastAudition = 0;

export async function audition(inst: Instrument): Promise<void> {
  const e = await ensureAudio();
  const nowMs = performance.now();
  if (nowMs - lastAudition < 120) return;
  lastAudition = nowMs;
  const d = descriptorOf(inst);
  const center = Math.round((inst.play.low + inst.play.high) / 2);
  const root = Math.max(inst.play.low, Math.min(inst.play.high - 12, center - 5 - (((center - 5) % 12) + 12) % 12 + 0));
  const t = e.ctx.currentTime + 0.03;
  const drum = inst.meta.category === "drum";
  if (drum) {
    const seq = [0, 0, 7, 0];
    seq.forEach((iv, i) => {
      e.noteOn(root + iv, i === 0 ? 0.95 : 0.6, 15, t + i * 0.16);
      e.noteOff(root + iv, 15, t + i * 0.16 + 0.12);
    });
    return;
  }
  if (d.sustain > 0.8 && d.attack < 0.7) {
    const chord = inst.play.mono ? [0] : [0, 4, 7];
    chord.forEach((iv) => {
      e.noteOn(root + iv, 0.7, 15, t);
      e.noteOff(root + iv, 15, t + 1.1);
    });
    return;
  }
  const seq = inst.play.mono ? [0, 7, 12] : [0, 4, 7, 12];
  seq.forEach((iv, i) => {
    e.noteOn(root + iv, 0.75, 15, t + i * 0.13);
    e.noteOff(root + iv, 15, t + i * 0.13 + 0.5);
  });
}
