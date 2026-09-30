/**
 * パラメータ・レジストリ（全パラメータの単一正本）。
 *
 * - すべての音色パラメータは「正規化値 n ∈ [0,1]」で保存・補間・変調され、
 *   発音直前に物理値へ写像される。だからモーフ・ランダム化・MIDI learn・変調が
 *   どのパラメータにも同じ規則で効く。
 * - `voice` パラメータは発音ごと（ボイス単位）に変調マトリクスで評価される。
 *   `global` パラメータは楽器全体（ボディ・FX など）で、マクロ／モッドホイールのみ受ける。
 * - このファイルは AudioWorklet にも取り込まれるため、DOM 依存を持たない。
 */

export type Scale = "lin" | "log" | "sq";
export type ParamGroup =
  | "exciter"
  | "drive"
  | "resonator"
  | "noise"
  | "pitch"
  | "output"
  | "modenv"
  | "lfo"
  | "body"
  | "eq"
  | "chorus"
  | "delay"
  | "reverb";

export interface ParamSpec {
  id: string;
  group: ParamGroup;
  /** 日本語ラベル（主表示） */
  label: string;
  /** 英語の専門用語（副表示。アーティストが慣れた語） */
  en: string;
  min: number;
  max: number;
  scale: Scale;
  /** 物理値での既定 */
  def: number;
  unit?: "s" | "Hz" | "dB" | "st" | "ct" | "%" | "";
  /** 表示の小数桁 */
  digits?: number;
  /** 説明（ツールチップ） */
  hint: string;
}

const P = (s: ParamSpec) => s;

/** ボイス（発音単位）パラメータ。配列順＝ワークレットでのインデックス。 */
export const VOICE_PARAMS = [
  // --- 励起（打つ・弾く） ---
  P({ id: "strike", group: "exciter", label: "打撃", en: "Strike", min: 0, max: 1, scale: "lin", def: 1, unit: "%", hint: "打つ・弾く瞬間の衝撃で共鳴体を鳴らす量" }),
  P({ id: "hardness", group: "exciter", label: "硬さ", en: "Hardness", min: 0, max: 1, scale: "lin", def: 0.5, unit: "%", hint: "マレット／ピック／ハンマーの硬さ。硬いほど高次の倍音まで励起する" }),
  P({ id: "strikeNoise", group: "exciter", label: "打撃の粒", en: "Impact Noise", min: 0, max: 1, scale: "lin", def: 0.1, unit: "%", hint: "衝撃にノイズを混ぜる（ブラシ・爪・擦過）" }),
  P({ id: "position", group: "exciter", label: "打点", en: "Position", min: 0, max: 1, scale: "lin", def: 0.23, unit: "%", hint: "弦・板のどこを打つか。中央ほど偶数モードが消え、端ほど鋭い" }),
  // --- 持続駆動（擦る・吹く） ---
  P({ id: "drive", group: "drive", label: "持続駆動", en: "Bow/Blow", min: 0, max: 1, scale: "sq", def: 0, unit: "%", hint: "弓で擦る／息を吹き込むように、共鳴を鳴らし続ける量" }),
  P({ id: "driveColor", group: "drive", label: "駆動の色", en: "Drive Color", min: 0, max: 1, scale: "lin", def: 0.5, unit: "%", hint: "持続音の倍音の傾き。高いほど鋸歯状（弓）、低いほど正弦的（笛）" }),
  P({ id: "breath", group: "drive", label: "息・擦過音", en: "Breath", min: 0, max: 1, scale: "sq", def: 0, unit: "%", hint: "共鳴体に吹き込むノイズ。フルートの息、弓の擦れ" }),
  P({ id: "grain", group: "drive", label: "ざらつき", en: "Grain", min: 0, max: 1, scale: "lin", def: 0.15, unit: "%", hint: "持続音の微細な揺らぎ。生の弓・息らしさ" }),
  P({ id: "driveAttack", group: "drive", label: "立ち上がり", en: "Attack", min: 0.001, max: 4, scale: "log", def: 0.08, unit: "s", digits: 3, hint: "持続駆動のアタック時間" }),
  P({ id: "driveDecay", group: "drive", label: "減衰", en: "Decay", min: 0.01, max: 8, scale: "log", def: 0.4, unit: "s", digits: 2, hint: "持続駆動のディケイ時間" }),
  P({ id: "driveSustain", group: "drive", label: "持続レベル", en: "Sustain", min: 0, max: 1, scale: "lin", def: 0.8, unit: "%", hint: "持続駆動のサステイン" }),
  P({ id: "driveRelease", group: "drive", label: "余韻", en: "Release", min: 0.005, max: 8, scale: "log", def: 0.3, unit: "s", digits: 2, hint: "持続駆動のリリース" }),
  // --- 共鳴体 ---
  P({ id: "structure", group: "resonator", label: "構造", en: "Structure", min: 0, max: 1, scale: "lin", def: 0, unit: "%", hint: "共鳴体の形。弦(0)→調律された棒→自由棒→鐘→膜(1)へ連続に変わる" }),
  P({ id: "stiffness", group: "resonator", label: "剛性", en: "Stiffness", min: 0, max: 1, scale: "lin", def: 0.05, unit: "%", hint: "高次モードほど上へずれる（ピアノ弦の非調和性）" }),
  P({ id: "brightness", group: "resonator", label: "明るさ", en: "Brightness", min: 0, max: 1, scale: "lin", def: 0.6, unit: "%", hint: "高次モードの量" }),
  P({ id: "evenModes", group: "resonator", label: "偶数モード", en: "Even Modes", min: 0, max: 1, scale: "lin", def: 1, unit: "%", hint: "偶数番目のモードの量。0 で閉管（クラリネット）的" }),
  P({ id: "decay", group: "resonator", label: "響きの長さ", en: "Decay", min: 0.02, max: 40, scale: "log", def: 2.5, unit: "s", digits: 2, hint: "基音の残響時間（T60）" }),
  P({ id: "damping", group: "resonator", label: "高域の減衰", en: "Damping", min: 0, max: 1, scale: "lin", def: 0.4, unit: "%", hint: "高次モードほど早く消える度合い（素材の柔らかさ）" }),
  P({ id: "release", group: "resonator", label: "消音", en: "Damper", min: 0.01, max: 12, scale: "log", def: 0.25, unit: "s", digits: 2, hint: "鍵を離したあとの響き（ダンパー）" }),
  P({ id: "spread", group: "resonator", label: "モードの揺らぎ", en: "Mode Spread", min: 0, max: 1, scale: "sq", def: 0.03, unit: "%", hint: "モード周波数を音ごとに少しずらす。うなり・複弦感・古びた楽器" }),
  // --- ノイズ層 ---
  P({ id: "noise", group: "noise", label: "ノイズ", en: "Noise", min: 0, max: 1, scale: "sq", def: 0, unit: "%", hint: "共鳴体を通らない直接のノイズ（スネア線・ハイハット・ピックの擦れ）" }),
  P({ id: "noiseDecay", group: "noise", label: "ノイズ減衰", en: "Noise Decay", min: 0.005, max: 4, scale: "log", def: 0.12, unit: "s", digits: 3, hint: "ノイズの長さ" }),
  P({ id: "noiseFreq", group: "noise", label: "ノイズ帯域", en: "Noise Freq", min: 60, max: 16000, scale: "log", def: 3000, unit: "Hz", digits: 0, hint: "ノイズのバンドパス中心" }),
  P({ id: "noiseQ", group: "noise", label: "ノイズ幅", en: "Noise Q", min: 0.3, max: 12, scale: "log", def: 0.8, unit: "", digits: 2, hint: "ノイズ帯域の鋭さ" }),
  // --- ピッチ ---
  P({ id: "pitchEnv", group: "pitch", label: "ピッチの落下", en: "Pitch Env", min: -24, max: 48, scale: "lin", def: 0, unit: "st", digits: 1, hint: "発音直後のピッチのずれ（808・タム・シンセドラム）" }),
  P({ id: "pitchEnvTime", group: "pitch", label: "落下時間", en: "P.Env Time", min: 0.005, max: 2, scale: "log", def: 0.06, unit: "s", digits: 3, hint: "ピッチが収束するまでの時間" }),
  P({ id: "vibratoRate", group: "pitch", label: "ビブラート速さ", en: "Vib Rate", min: 0.1, max: 12, scale: "log", def: 5.2, unit: "Hz", digits: 2, hint: "ビブラートの速さ" }),
  P({ id: "vibratoDepth", group: "pitch", label: "ビブラート深さ", en: "Vib Depth", min: 0, max: 100, scale: "sq", def: 0, unit: "ct", digits: 1, hint: "ビブラートの深さ（セント）" }),
  P({ id: "vibratoDelay", group: "pitch", label: "ビブラート遅延", en: "Vib Delay", min: 0, max: 3, scale: "sq", def: 0.35, unit: "s", digits: 2, hint: "ビブラートがかかり始めるまで" }),
  P({ id: "drift", group: "pitch", label: "ゆらぎ", en: "Drift", min: 0, max: 1, scale: "sq", def: 0.05, unit: "%", hint: "ゆっくりしたピッチの揺らぎ（生演奏・テープ）" }),
  P({ id: "fine", group: "pitch", label: "微調整", en: "Fine", min: -100, max: 100, scale: "lin", def: 0, unit: "ct", digits: 1, hint: "ピッチの微調整（セント）" }),
  // --- 出力 ---
  P({ id: "saturation", group: "output", label: "歪み", en: "Saturation", min: 0, max: 1, scale: "sq", def: 0, unit: "%", hint: "ボイスごとのソフトな飽和" }),
  P({ id: "level", group: "output", label: "音量", en: "Level", min: -48, max: 6, scale: "lin", def: -6, unit: "dB", digits: 1, hint: "ボイスの音量（ベロシティ 100 のとき）" }),
  P({ id: "pan", group: "output", label: "定位", en: "Pan", min: -1, max: 1, scale: "lin", def: 0, unit: "", digits: 2, hint: "左右の定位" }),
  P({ id: "keySpread", group: "output", label: "鍵盤の広がり", en: "Key Spread", min: 0, max: 1, scale: "lin", def: 0.25, unit: "%", hint: "低音を左・高音を右へ広げる（ピアノの奏者視点）" }),
  // --- モジュレーション・エンベロープ（変調源） ---
  P({ id: "modAttack", group: "modenv", label: "Mod アタック", en: "Mod Attack", min: 0.001, max: 8, scale: "log", def: 0.01, unit: "s", digits: 3, hint: "変調用エンベロープのアタック" }),
  P({ id: "modDecay", group: "modenv", label: "Mod ディケイ", en: "Mod Decay", min: 0.005, max: 12, scale: "log", def: 0.5, unit: "s", digits: 2, hint: "変調用エンベロープのディケイ" }),
  P({ id: "modSustain", group: "modenv", label: "Mod サステイン", en: "Mod Sustain", min: 0, max: 1, scale: "lin", def: 0, unit: "%", hint: "変調用エンベロープのサステイン" }),
  P({ id: "modRelease", group: "modenv", label: "Mod リリース", en: "Mod Release", min: 0.005, max: 12, scale: "log", def: 0.4, unit: "s", digits: 2, hint: "変調用エンベロープのリリース" }),
] as const satisfies readonly ParamSpec[];

/** 楽器全体（バス）パラメータ。ネイティブ Web Audio ノードで処理。 */
export const GLOBAL_PARAMS = [
  P({ id: "lfoRate", group: "lfo", label: "LFO 速さ", en: "LFO Rate", min: 0.02, max: 20, scale: "log", def: 1.5, unit: "Hz", digits: 2, hint: "LFO（変調源）の速さ" }),
  P({ id: "lfoShape", group: "lfo", label: "LFO 波形", en: "LFO Shape", min: 0, max: 1, scale: "lin", def: 0, unit: "", digits: 2, hint: "正弦(0)→三角→矩形→ランダム(1) を連続に" }),
  P({ id: "bodyMix", group: "body", label: "胴鳴り", en: "Body", min: 0, max: 1, scale: "lin", def: 0.4, unit: "%", hint: "楽器の胴（固定共鳴）の強さ。音高に依らない『声色』＝同一音源性の核" }),
  P({ id: "bodySize", group: "body", label: "胴の大きさ", en: "Body Size", min: 0.35, max: 2.8, scale: "log", def: 1, unit: "", digits: 2, hint: "胴の共鳴周波数を一括で伸縮する" }),
  P({ id: "bodyF1", group: "body", label: "胴 共鳴1", en: "Body F1", min: 60, max: 1200, scale: "log", def: 280, unit: "Hz", digits: 0, hint: "第1共鳴（空気の共鳴）" }),
  P({ id: "bodyF2", group: "body", label: "胴 共鳴2", en: "Body F2", min: 200, max: 4000, scale: "log", def: 520, unit: "Hz", digits: 0, hint: "第2共鳴（板の共鳴）" }),
  P({ id: "bodyF3", group: "body", label: "胴 共鳴3", en: "Body F3", min: 800, max: 12000, scale: "log", def: 2800, unit: "Hz", digits: 0, hint: "第3共鳴（輝き）" }),
  P({ id: "bodyQ", group: "body", label: "胴の鋭さ", en: "Body Q", min: 0.5, max: 12, scale: "log", def: 2.5, unit: "", digits: 2, hint: "胴の共鳴の鋭さ" }),
  P({ id: "lowShelf", group: "eq", label: "低域", en: "Low", min: -18, max: 18, scale: "lin", def: 0, unit: "dB", digits: 1, hint: "150Hz 以下のシェルフ" }),
  P({ id: "midGain", group: "eq", label: "中域", en: "Mid", min: -18, max: 18, scale: "lin", def: 0, unit: "dB", digits: 1, hint: "中域のピーク" }),
  P({ id: "midFreq", group: "eq", label: "中域周波数", en: "Mid Freq", min: 200, max: 6000, scale: "log", def: 1000, unit: "Hz", digits: 0, hint: "中域の中心" }),
  P({ id: "highShelf", group: "eq", label: "高域", en: "High", min: -18, max: 18, scale: "lin", def: 0, unit: "dB", digits: 1, hint: "6kHz 以上のシェルフ" }),
  P({ id: "chorusMix", group: "chorus", label: "コーラス", en: "Chorus", min: 0, max: 1, scale: "lin", def: 0, unit: "%", hint: "揺らぎのある重なり（アンサンブル）" }),
  P({ id: "chorusRate", group: "chorus", label: "コーラス速さ", en: "Ch. Rate", min: 0.05, max: 6, scale: "log", def: 0.6, unit: "Hz", digits: 2, hint: "コーラスの揺れの速さ" }),
  P({ id: "chorusDepth", group: "chorus", label: "コーラス深さ", en: "Ch. Depth", min: 0, max: 1, scale: "lin", def: 0.4, unit: "%", hint: "コーラスの揺れの深さ" }),
  P({ id: "delayMix", group: "delay", label: "ディレイ", en: "Delay", min: 0, max: 1, scale: "sq", def: 0, unit: "%", hint: "やまびこ" }),
  P({ id: "delayTime", group: "delay", label: "ディレイ時間", en: "Time", min: 0.02, max: 1.5, scale: "log", def: 0.375, unit: "s", digits: 3, hint: "繰り返しの間隔" }),
  P({ id: "delayFeedback", group: "delay", label: "フィードバック", en: "Feedback", min: 0, max: 0.95, scale: "lin", def: 0.35, unit: "%", hint: "繰り返しの長さ" }),
  P({ id: "delayTone", group: "delay", label: "ディレイの色", en: "Delay Tone", min: 800, max: 16000, scale: "log", def: 5000, unit: "Hz", digits: 0, hint: "繰り返すたびに暗くなる度合い" }),
  P({ id: "reverbMix", group: "reverb", label: "リバーブ", en: "Reverb", min: 0, max: 1, scale: "sq", def: 0.2, unit: "%", hint: "空間の響き" }),
  P({ id: "reverbSize", group: "reverb", label: "空間の大きさ", en: "Size", min: 0.3, max: 14, scale: "log", def: 2.2, unit: "s", digits: 2, hint: "残響時間" }),
  P({ id: "reverbTone", group: "reverb", label: "空間の明るさ", en: "Tone", min: 0, max: 1, scale: "lin", def: 0.5, unit: "%", hint: "残響の高域の残り方" }),
  P({ id: "reverbPreDelay", group: "reverb", label: "プリディレイ", en: "Pre-delay", min: 0, max: 0.15, scale: "lin", def: 0.012, unit: "s", digits: 3, hint: "直接音と残響の間隔（空間の奥行き）" }),
  P({ id: "width", group: "reverb", label: "ステレオ幅", en: "Width", min: 0, max: 1.5, scale: "lin", def: 1, unit: "", digits: 2, hint: "左右の広がり（0 でモノラル）" }),
] as const satisfies readonly ParamSpec[];

export type VoiceParamId = (typeof VOICE_PARAMS)[number]["id"];
export type GlobalParamId = (typeof GLOBAL_PARAMS)[number]["id"];
export type ParamId = VoiceParamId | GlobalParamId;

export const ALL_PARAMS: readonly ParamSpec[] = [...VOICE_PARAMS, ...GLOBAL_PARAMS];
export const PARAM_BY_ID: Record<string, ParamSpec> = Object.fromEntries(ALL_PARAMS.map((p) => [p.id, p]));
export const VOICE_INDEX: Record<string, number> = Object.fromEntries(VOICE_PARAMS.map((p, i) => [p.id, i]));
export const N_VOICE_PARAMS = VOICE_PARAMS.length;

export function isVoiceParam(id: string): id is VoiceParamId {
  return id in VOICE_INDEX;
}

/** 正規化値 → 物理値 */
export function denorm(spec: ParamSpec, n: number): number {
  const x = n < 0 ? 0 : n > 1 ? 1 : n;
  switch (spec.scale) {
    case "log":
      return spec.min * Math.pow(spec.max / spec.min, x);
    case "sq":
      return spec.min + (spec.max - spec.min) * x * x;
    default:
      return spec.min + (spec.max - spec.min) * x;
  }
}

/** 物理値 → 正規化値 */
export function norm(spec: ParamSpec, v: number): number {
  if (!Number.isFinite(v)) return norm(spec, spec.def);
  let n: number;
  switch (spec.scale) {
    case "log":
      n = Math.log(Math.max(v, spec.min) / spec.min) / Math.log(spec.max / spec.min);
      break;
    case "sq":
      n = Math.sqrt(Math.max(0, (v - spec.min) / (spec.max - spec.min)));
      break;
    default:
      n = (v - spec.min) / (spec.max - spec.min);
  }
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export function formatValue(spec: ParamSpec, v: number): string {
  const u = spec.unit ?? "";
  if (u === "%") return `${Math.round(norm(spec, v) * 100)}%`;
  if (u === "s") return v < 1 ? `${(v * 1000).toFixed(v < 0.01 ? 1 : 0)}ms` : `${v.toFixed(2)}s`;
  if (u === "Hz") return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)}k` : `${v.toFixed(spec.digits ?? 0)}Hz`;
  const d = spec.digits ?? 2;
  const s = v.toFixed(d);
  if (u === "dB" || u === "st" || u === "ct") return `${v > 0 ? "+" : ""}${s}${u === "st" ? "st" : u === "ct" ? "¢" : "dB"}`;
  return s;
}

// ------------------------------------------------------------------
// 変調源（モジュレーション・ソース）
// ------------------------------------------------------------------

export const MOD_SOURCES = [
  { id: "velocity", label: "ベロシティ", en: "Velocity", hint: "打鍵の強さ。ノブの値は強さ100のときの音", range: [-1, 0.27] },
  { id: "key", label: "音高", en: "Key", hint: "C4 を中心に低音(−)・高音(+)", range: [-1, 1.12] },
  { id: "pressure", label: "押し込み", en: "Pressure", hint: "アフタータッチ／MPE プレッシャー", range: [0, 1] },
  { id: "timbre", label: "スライド", en: "Slide (CC74)", hint: "MPE の縦方向（CC74）", range: [-1, 1] },
  { id: "modwheel", label: "モッドホイール", en: "Mod Wheel", hint: "CC1", range: [0, 1] },
  { id: "random", label: "ランダム", en: "Random", hint: "音ごとに変わる乱数（人間らしさ）", range: [-1, 1] },
  { id: "modenv", label: "Mod エンベロープ", en: "Mod Env", hint: "音ごとの変調用エンベロープ", range: [0, 1] },
  { id: "lfo", label: "LFO", en: "LFO", hint: "全体で共有する周期的な揺れ", range: [-1, 1] },
  { id: "macro1", label: "マクロ1", en: "Macro 1", hint: "", range: [0, 1] },
  { id: "macro2", label: "マクロ2", en: "Macro 2", hint: "", range: [0, 1] },
  { id: "macro3", label: "マクロ3", en: "Macro 3", hint: "", range: [0, 1] },
  { id: "macro4", label: "マクロ4", en: "Macro 4", hint: "", range: [0, 1] },
  { id: "macro5", label: "マクロ5", en: "Macro 5", hint: "", range: [0, 1] },
  { id: "macro6", label: "マクロ6", en: "Macro 6", hint: "", range: [0, 1] },
  { id: "macro7", label: "マクロ7", en: "Macro 7", hint: "", range: [0, 1] },
  { id: "macro8", label: "マクロ8", en: "Macro 8", hint: "", range: [0, 1] },
] as const;

export type ModSourceId = (typeof MOD_SOURCES)[number]["id"];
export const MOD_SOURCE_INDEX: Record<string, number> = Object.fromEntries(MOD_SOURCES.map((s, i) => [s.id, i]));
export const N_MOD_SOURCES = MOD_SOURCES.length;
export const SRC = {
  velocity: 0,
  key: 1,
  pressure: 2,
  timbre: 3,
  modwheel: 4,
  random: 5,
  modenv: 6,
  lfo: 7,
  macro1: 8,
} as const;
export const N_MACROS = 8;
