/**
 * モード比の数値計算（生成・検証用。実行時は modes.ts の定数表を使う）。
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

const MAX_MODES = 64;
interface ModeFamily {
  id: string;
  label: string;
  ratios: Float64Array;
}

/** 自由-自由の棒: cos(x)cosh(x)=1 の正根（x=0 を除く） */
function freeBarRoots(n: number): number[] {
  const f = (x: number) => Math.cos(x) * Math.cosh(x) - 1;
  const roots: number[] = [];
  for (let i = 1; roots.length < n; i++) {
    // 根は (2i+1)π/2 の近傍。大きい i では解析近似で十分（cosh が巨大）。
    const guess = ((2 * i + 1) * Math.PI) / 2;
    if (i > 12) {
      roots.push(guess);
      continue;
    }
    let lo = guess - 0.5;
    let hi = guess + 0.5;
    let flo = f(lo);
    for (let it = 0; it < 80; it++) {
      const mid = (lo + hi) / 2;
      const fm = f(mid);
      if (Math.sign(fm) === Math.sign(flo)) {
        lo = mid;
        flo = fm;
      } else hi = mid;
    }
    roots.push((lo + hi) / 2);
  }
  return roots;
}

/** 第1種ベッセル関数 J_m(x)（積分表示 + シンプソン則） */
function besselJ(m: number, x: number): number {
  const N = 400;
  const h = Math.PI / N;
  let s = 0;
  for (let i = 0; i <= N; i++) {
    const t = i * h;
    const w = i === 0 || i === N ? 1 : i % 2 ? 4 : 2;
    s += w * Math.cos(m * t - x * Math.sin(t));
  }
  return (s * h) / 3 / Math.PI;
}

/** 円形膜のモード比（j_{m,n} を昇順に n 個） */
function membraneRatios(count: number): number[] {
  const zeros: number[] = [];
  const xmax = 40;
  for (let m = 0; m < 30; m++) {
    let prevX = m === 0 ? 0.5 : m * 0.9 + 0.5;
    let prev = besselJ(m, prevX);
    for (let x = prevX + 0.05; x < xmax; x += 0.05) {
      const v = besselJ(m, x);
      if (Math.sign(v) !== Math.sign(prev) && prev !== 0) {
        let lo = prevX;
        let hi = x;
        let flo = prev;
        for (let it = 0; it < 40; it++) {
          const mid = (lo + hi) / 2;
          const fm = besselJ(m, mid);
          if (Math.sign(fm) === Math.sign(flo)) {
            lo = mid;
            flo = fm;
          } else hi = mid;
        }
        zeros.push((lo + hi) / 2);
      }
      prev = v;
      prevX = x;
    }
  }
  zeros.sort((a, b) => a - b);
  const base = zeros[0];
  return zeros.slice(0, count).map((z) => z / base);
}

function extendGeometric(seed: number[], count: number, growth: number): number[] {
  const out = seed.slice(0, count);
  while (out.length < count) {
    const a = out[out.length - 1];
    const b = out[out.length - 2];
    out.push(a + (a - b) * growth);
  }
  return out;
}

function buildFamilies(): ModeFamily[] {
  const n = MAX_MODES;
  const string = Array.from({ length: n }, (_, k) => k + 1);

  const bar = freeBarRoots(n);
  const barRatios = bar.map((x) => (x / bar[0]) ** 2);

  // マリンバ: 下位3モードを 1:4:10 に調律、以降は自由棒の比を 10/5.404 倍して接続。
  const scale = 10 / barRatios[2];
  const tunedBar = [1, 4, 10, ...barRatios.slice(3).map((r) => r * scale)].slice(0, n);

  // 理想化した調律鐘（prime=1）。hum は 1 オクターブ下。
  const bellSeed = [0.5, 1, 1.2, 1.5, 2, 2.5, 2.667, 3, 4, 5.333, 6.667, 8, 9.5, 11.2, 13, 15];
  const bell = extendGeometric(bellSeed, n, 1.06);

  const membrane = membraneRatios(n);

  return [
    { id: "string", label: "弦", ratios: Float64Array.from(string) },
    { id: "tunedBar", label: "調律された棒", ratios: Float64Array.from(tunedBar) },
    { id: "bar", label: "自由棒", ratios: Float64Array.from(barRatios) },
    { id: "bell", label: "鐘", ratios: Float64Array.from(bell) },
    { id: "membrane", label: "膜", ratios: Float64Array.from(membrane) },
  ];
}

export function computeFamilies(): ModeFamily[] {
  return buildFamilies();
}
