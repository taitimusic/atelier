/**
 * マルチサンプル書き出し: 楽器を音高×強弱で描画し、WAV 群＋ SFZ ＋元の .atelier を ZIP にまとめる。
 * SFZ は多くの DAW／サンプラー（Sitala, sforzando, Decent Sampler 変換, Logic/Bitwig/Renoise 等）で読める。
 */
import { renderOffline } from "../engine/engine";
import { serialize, type Instrument } from "../engine/instrument";
import { noteName, type TuningSettings } from "../engine/tuning";
import { encodeWav } from "./wav";
import { makeZip, type ZipEntry } from "./zip";

export interface MultisampleOptions {
  step: number;
  layers: 1 | 2 | 3 | 4;
  holdSec: number;
  tailSec: number;
  spatial: boolean;
  bits: 16 | 24;
  low: number;
  high: number;
}

export const LAYER_VELS: Record<number, number[]> = {
  1: [0.8],
  2: [0.45, 0.92],
  3: [0.3, 0.62, 0.95],
  4: [0.25, 0.5, 0.75, 1.0],
};

/** サンプラー互換のため、ZIP 内のファイル名は ASCII に限る */
export function asciiName(s: string, fallback: string): string {
  const a = s.normalize("NFKD").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32);
  return a.length >= 2 ? a : fallback;
}

export function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "instrument";
}

export async function exportMultisample(
  inst: Instrument,
  tuning: TuningSettings,
  o: MultisampleOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const base = asciiName(inst.meta.name, `atelier_${inst.id.replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "inst"}`);
  const notes: number[] = [];
  for (let n = o.low; n <= o.high; n += o.step) notes.push(n);
  if (notes[notes.length - 1] !== o.high && o.step > 1) notes.push(o.high);
  const vels = LAYER_VELS[o.layers];
  const total = notes.length * vels.length;
  const entries: ZipEntry[] = [];
  const regions: string[] = [];
  let done = 0;
  for (let vi = 0; vi < vels.length; vi++) {
    const lovel = vi === 0 ? 1 : Math.round(((vels[vi - 1] + vels[vi]) / 2) * 127) + 1;
    const hivel = vi === vels.length - 1 ? 127 : Math.round(((vels[vi] + vels[vi + 1]) / 2) * 127);
    regions.push(`<group> lovel=${lovel} hivel=${hivel}`);
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      const dur = o.holdSec + o.tailSec;
      const buf = await renderOffline(
        inst,
        tuning,
        [
          { time: 0.005, type: "on", note: n, vel: vels[vi] },
          { time: 0.005 + o.holdSec, type: "off", note: n, vel: 0 },
        ],
        dur,
        { spatial: o.spatial },
      );
      const l = buf.getChannelData(0);
      const r = buf.getChannelData(1);
      const end = trimEnd(l, r, buf.sampleRate);
      const L = l.slice(0, end);
      const R = r.slice(0, end);
      fadeOut(L, R, Math.round(buf.sampleRate * 0.01));
      const file = `${base}_${String(n).padStart(3, "0")}_${noteName(n).replace("♯", "s")}_v${vi + 1}.wav`;
      entries.push({ name: `samples/${file}`, data: encodeWav([L, R], buf.sampleRate, o.bits) });
      const lokey = i === 0 ? Math.max(0, n - o.step + 1) : Math.floor((notes[i - 1] + n) / 2) + 1;
      const hikey = i === notes.length - 1 ? Math.min(127, n + o.step - 1) : Math.floor((n + notes[i + 1]) / 2);
      regions.push(`<region> sample=${file} lokey=${lokey} hikey=${hikey} pitch_keycenter=${n}`);
      onProgress?.(++done, total);
    }
  }
  const release = Math.min(8, Math.max(0.05, inst.params.release ?? 0.3, inst.params.driveRelease ?? 0.1));
  const sfz = [
    `// ${inst.meta.name} — Atelier で創った楽器のマルチサンプル`,
    `// ${notes.length} 音 × ${vels.length} 強弱 / ${o.spatial ? "空間系エフェクト込み" : "ドライ（空間系なし）"}`,
    "<control>",
    "default_path=samples/",
    "<global>",
    `ampeg_release=${release.toFixed(3)}`,
    `amp_veltrack=${vels.length > 1 ? 30 : 100}`,
    "",
    ...regions,
    "",
  ].join("\n");
  entries.push({ name: `${base}.sfz`, data: new TextEncoder().encode(sfz) });
  entries.push({ name: `${base}.atelier`, data: new TextEncoder().encode(serialize(inst)) });
  entries.push({
    name: "README.txt",
    data: new TextEncoder().encode(
      `${inst.meta.name}\n\nAtelier で創った楽器を、音高 ${noteName(o.low)}〜${noteName(o.high)}（${o.step} 半音おき）× ${vels.length} 段の強弱で録音したものです。\n` +
        `${base}.sfz を SFZ 対応サンプラー（sforzando など）で開いてください。\n${base}.atelier は Atelier に読み込めば元の楽器として編集を続けられます。\n`,
    ),
  });
  return makeZip(entries);
}

function trimEnd(l: Float32Array, r: Float32Array, sr: number): number {
  const th = Math.pow(10, -72 / 20);
  let end = l.length;
  while (end > sr * 0.05 && Math.abs(l[end - 1]) < th && Math.abs(r[end - 1]) < th) end--;
  return Math.min(l.length, end + Math.round(sr * 0.02));
}

function fadeOut(l: Float32Array, r: Float32Array, n: number): void {
  const len = l.length;
  for (let i = 0; i < n && i < len; i++) {
    const g = i / n;
    l[len - 1 - i] *= g;
    r[len - 1 - i] *= g;
  }
}
