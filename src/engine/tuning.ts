/**
 * 調律（チューニング）。どの鍵盤・MIDI ノートがどの周波数で鳴るかを決める。
 * - 12 平均律（A4 基準可変）
 * - n 平均律（EDO: 5/7/19/22/24/31/53 …）: 1 鍵 = 1 ステップ
 * - 純正律・ピタゴラス・ミーントーンは比や五度の大きさから計算で生成
 * - Scala (.scl) 読み込み: 任意の音律を取り込める
 */

export interface Tuning {
  id: string;
  name: string;
  /** 1 周期内のステップ（セント。先頭 0 は含めず、末尾が周期） */
  steps: number[];
  /** 周期内の鍵盤ラベル（任意） */
  description?: string;
}

export interface TuningSettings {
  tuning: Tuning;
  /** 音階の 0 度に当たる MIDI ノート */
  rootNote: number;
  /** A4 の周波数（rootNote の周波数は 12 平均律で A4 から決める） */
  a4: number;
}

const cents = (ratio: number) => 1200 * Math.log2(ratio);

export function edo(n: number, periodCents = 1200): Tuning {
  const steps = Array.from({ length: n }, (_, i) => ((i + 1) * periodCents) / n);
  const period = periodCents === 1200 ? "" : ` (周期 ${periodCents.toFixed(1)}¢)`;
  return { id: `edo-${n}-${periodCents}`, name: n === 12 && periodCents === 1200 ? "12 平均律" : `${n} 平均律${period}`, steps };
}

function fromRatios(id: string, name: string, ratios: number[], description?: string): Tuning {
  return { id, name, steps: ratios.map(cents), description };
}

/** 五度の大きさ（セント）から 12 音の鍵盤音律を作る（E♭〜G♯ の並び） */
function fromFifth(id: string, name: string, fifth: number, description: string): Tuning {
  const pcs = new Array(12).fill(0);
  // C から上へ 8 回（G D A E B F♯ C♯ G♯）、下へ 3 回（F B♭ E♭）
  for (let k = -3; k <= 8; k++) {
    const c = (((k * fifth) % 1200) + 1200) % 1200;
    const pc = (((k * 7) % 12) + 12) % 12;
    pcs[pc] = c;
  }
  const steps = pcs.slice(1).concat([1200]);
  return { id, name, steps, description };
}

export const BUILTIN_TUNINGS: Tuning[] = [
  edo(12),
  fromRatios("ji5", "純正律（5 リミット）", [16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8, 2], "主和音が唸らない。移調すると濁る。"),
  fromFifth("pyth", "ピタゴラス音律", cents(3 / 2), "純正な五度を積み重ねる。"),
  fromFifth("meantone", "1/4 コンマ・ミーントーン", cents(3 / 2) - cents(81 / 80) / 4, "長三度が純正。ルネサンス〜バロック。"),
  fromRatios("harmonic", "倍音列（8〜16 倍音）", [9 / 8, 10 / 8, 11 / 8, 12 / 8, 13 / 8, 14 / 8, 15 / 8, 2], "自然倍音そのもの。7・11・13 倍音の独特な響き。"),
  edo(24),
  edo(19),
  edo(22),
  edo(31),
  edo(53),
  { ...edo(5), name: "5 平均律（スレンドロ近似）" },
  { ...edo(7), name: "7 平均律（タイ古典近似）" },
  { ...edo(13, cents(3)), id: "bp", name: "ボーレン＝ピアース（3 の 13 等分）", description: "オクターブではなく 3 倍（トリターヴ）で循環。" },
];

export function defaultTuning(): TuningSettings {
  return { tuning: BUILTIN_TUNINGS[0], rootNote: 60, a4: 440 };
}

export function is12Tet(t: TuningSettings): boolean {
  return t.tuning.id === BUILTIN_TUNINGS[0].id && t.rootNote % 12 === 0;
}

/** 128 ノートの周波数表 */
export function frequencyTable(ts: TuningSettings): Float64Array {
  const out = new Float64Array(128);
  const { steps } = ts.tuning;
  const n = steps.length;
  const period = steps[n - 1];
  const rootHz = ts.a4 * Math.pow(2, (ts.rootNote - 69) / 12);
  for (let note = 0; note < 128; note++) {
    const d = note - ts.rootNote;
    const oct = Math.floor(d / n);
    const deg = d - oct * n;
    const c = oct * period + (deg === 0 ? 0 : steps[deg - 1]);
    out[note] = rootHz * Math.pow(2, c / 1200);
  }
  return out;
}

/** 鍵盤ラベル（12 平均律系は音名、その他は度数） */
const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export function noteName(note: number): string {
  return `${NAMES[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`;
}
export function noteLabel(note: number, ts: TuningSettings): string {
  if (ts.tuning.steps.length === 12) return noteName(note);
  const n = ts.tuning.steps.length;
  const d = note - ts.rootNote;
  const oct = Math.floor(d / n);
  return `${d - oct * n}${oct >= 0 ? "" : ""}`;
}

/**
 * Scala (.scl) 形式を読む。
 * 行: `!` はコメント。最初の非コメント行が説明、次が音数、以降が各音（`.` を含めばセント、`a/b` か整数は比）。
 */
export function parseScala(text: string, fileName = "scala"): Tuning {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => !l.startsWith("!"));
  if (lines.length < 2) throw new Error("Scala ファイルが短すぎます");
  const description = lines[0];
  const count = parseInt(lines[1], 10);
  if (!Number.isFinite(count) || count < 1 || count > 256) throw new Error("音数が不正です");
  const steps: number[] = [];
  for (let i = 2; i < lines.length && steps.length < count; i++) {
    const tok = lines[i].split(/\s+/)[0];
    if (!tok) continue;
    let c: number;
    if (tok.includes(".")) c = parseFloat(tok);
    else if (tok.includes("/")) {
      const [a, b] = tok.split("/").map(Number);
      if (!(a > 0 && b > 0)) throw new Error(`比が不正です: ${tok}`);
      c = cents(a / b);
    } else {
      const a = Number(tok);
      if (!(a > 0)) throw new Error(`値が不正です: ${tok}`);
      c = cents(a);
    }
    if (!Number.isFinite(c)) throw new Error(`値が不正です: ${tok}`);
    steps.push(c);
  }
  if (steps.length !== count) throw new Error(`音数 ${count} に対して ${steps.length} 音しかありません`);
  if (steps[steps.length - 1] <= 0) throw new Error("周期が不正です");
  const name = description || fileName.replace(/\.scl$/i, "");
  return { id: `scl-${name}-${count}`, name: name.slice(0, 48), steps, description: `Scala: ${fileName}` };
}
