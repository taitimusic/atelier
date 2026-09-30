/**
 * 共鳴体のモード比（固有振動数 / 基音）ファミリ。
 *
 * 表を記憶から書かず、物理式から数値的に求める:
 * - 弦（理想）: k
 * - 自由-自由の棒（木琴・グロッケン）: cos(x)·cosh(x) = 1 の根 x_n、比 (x_n/x_1)²
 * - 円形膜（太鼓）: ベッセル関数 J_m の零点 j_{m,n}、比 j/j_{0,1}
 * - 調律された棒（マリンバ）: 1 : 4 : 10 に削り出した下位3モード＋上位は自由棒の比を接続
 * - 鐘（理想化された調律鐘）: hum/prime/tierce/quint/nominal… の調律比（音楽的に理想化した値）
 *
 * 「構造 structure」(0..1) はこれらを対数周波数上で連続に補間する。
 * どの中間点も物理的にありうる（ありそうな）物体として鳴る＝楽器の領域が途切れない。
 */

import { MODE_TABLE } from "./modeTable";

export const MAX_MODES = 64;

export interface ModeFamily {
  id: string;
  label: string;
  ratios: Float64Array;
}

const LABELS: Record<keyof typeof MODE_TABLE, string> = {
  string: "弦",
  tunedBar: "調律された棒",
  bar: "自由棒",
  bell: "鐘",
  membrane: "膜",
};

export const MODE_FAMILIES: ModeFamily[] = (Object.keys(MODE_TABLE) as (keyof typeof MODE_TABLE)[]).map((id) => ({
  id,
  label: LABELS[id],
  ratios: Float64Array.from(MODE_TABLE[id]),
}));

/** 各ファミリの log 比（補間用に事前計算） */
export const FAMILY_LOG: Float64Array[] = MODE_FAMILIES.map((f) => f.ratios.map((r) => Math.log(r)));

/** structure(0..1) の位置にあるファミリ名（UI 表示用） */
export function structureLabel(s: number): string {
  const x = Math.max(0, Math.min(1, s)) * (MODE_FAMILIES.length - 1);
  const i = Math.round(x);
  const near = Math.abs(x - i) < 0.18;
  if (near) return MODE_FAMILIES[i].label;
  const a = MODE_FAMILIES[Math.floor(x)].label;
  const b = MODE_FAMILIES[Math.ceil(x)].label;
  return `${a}〜${b}`;
}

/**
 * structure / stiffness からモード比を out に書き込む（アロケーションなし）。
 * stiffness は硬い弦の分散 f_k = k f0 √(1+Bk²) を全ファミリに一般化して掛ける。
 */
export function computeRatios(structure: number, stiffness: number, out: Float64Array, count = MAX_MODES): void {
  const nf = FAMILY_LOG.length - 1;
  const x = (structure < 0 ? 0 : structure > 1 ? 1 : structure) * nf;
  let i = Math.floor(x);
  if (i >= nf) i = nf - 1;
  const t = x - i;
  const A = FAMILY_LOG[i];
  const B = FAMILY_LOG[i + 1];
  const Bst = 0.02 * stiffness * stiffness;
  const norm1 = Math.sqrt(1 + Bst);
  for (let k = 0; k < count; k++) {
    const lr = A[k] + (B[k] - A[k]) * t;
    const kk = k + 1;
    out[k] = (Math.exp(lr) * Math.sqrt(1 + Bst * kk * kk)) / norm1;
  }
}
