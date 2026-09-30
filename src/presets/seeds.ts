/**
 * 種（Seed）楽器 — 創作の出発点となる、物理的な特徴を捉えた基準楽器群。
 *
 * どれも同じ音色空間の「点」ではなく「領域」として定義する:
 * ベロシティ→硬さ・音量、音高→減衰、押し込み→駆動 などの写像（mods）が、
 * 実楽器のように「強く弾けば明るく、高い音ほど短い」一貫性を与える。
 */

import { createInstrument, type Instrument, type ModRoute, type PlaySettings } from "../engine/instrument";
import type { ModSourceId } from "../engine/params";

type M = [ModSourceId, string, number];

interface SeedDef {
  id: string;
  name: string;
  category: string;
  description: string;
  tags: string[];
  p: Record<string, number>;
  mods?: M[];
  macros?: { name: string; routes: [string, number][] }[];
  play?: Partial<PlaySettings>;
}

/** 実楽器らしい一貫性の基本写像（多くの種で共有） */
const COHERENCE: M[] = [
  ["velocity", "level", 0.34],
  ["velocity", "hardness", 0.35],
  ["key", "decay", -0.2],
];

const SPACE_MACRO = { name: "空間", routes: [["reverbMix", 0.45], ["reverbSize", 0.25]] as [string, number][] };

const DEFS: SeedDef[] = [
  // ---------------- 鍵盤 ----------------
  {
    id: "piano",
    name: "グランドピアノ",
    category: "keys",
    description: "剛性のある弦をハンマーで打つ。高音ほど弦が硬く、減衰が速い。",
    tags: ["piano", "acoustic"],
    p: { structure: 0, stiffness: 0.13, hardness: 0.52, strikeNoise: 0.05, position: 0.12, brightness: 0.6, decay: 9, damping: 0.55, release: 0.3, spread: 0.07, noise: 0.07, noiseDecay: 0.03, noiseFreq: 1100, noiseQ: 0.7, keySpread: 0.45, level: -7.1, bodyMix: 0.35, bodyF1: 180, bodyF2: 700, bodyF3: 2500, bodyQ: 1.3, reverbMix: 0.22, reverbSize: 2.4 },
    mods: [["velocity", "level", 0.38], ["velocity", "hardness", 0.5], ["velocity", "strikeNoise", 0.1], ["key", "decay", -0.36], ["key", "stiffness", 0.18], ["key", "hardness", 0.1]],
    macros: [
      { name: "ハンマー", routes: [["hardness", 0.4], ["strikeNoise", 0.2]] },
      { name: "響き", routes: [["decay", 0.25], ["release", 0.45]] },
      { name: "古びた", routes: [["spread", 0.55], ["drift", 0.35], ["stiffness", 0.2]] },
      SPACE_MACRO,
    ],
  },
  {
    id: "epiano",
    name: "エレクトリックピアノ",
    category: "keys",
    description: "音叉状のタインを叩く。鐘のような立ち上がりの後、丸い正弦へ。",
    tags: ["rhodes", "electric"],
    p: { structure: 0.33, stiffness: 0.05, hardness: 0.45, position: 0.2, brightness: 0.35, decay: 5, damping: 0.95, release: 0.2, spread: 0.02, saturation: 0.18, level: -3.8, bodyMix: 0.1, lfoRate: 4.2, chorusMix: 0.2, reverbMix: 0.18 },
    mods: [["velocity", "level", 0.34], ["velocity", "hardness", 0.45], ["velocity", "saturation", 0.35], ["key", "decay", -0.3], ["lfo", "pan", 0.2]],
    macros: [
      { name: "ベル感", routes: [["damping", -0.5], ["hardness", 0.3]] },
      { name: "トレモロ", routes: [["lfoRate", 0.25]] },
      { name: "歪み", routes: [["saturation", 0.6]] },
      SPACE_MACRO,
    ],
  },
  {
    id: "harpsichord",
    name: "チェンバロ",
    category: "keys",
    description: "弦の端近くを爪で弾く。鋭く明るく、胴が響く。",
    tags: ["baroque", "plucked"],
    p: { structure: 0, stiffness: 0.03, hardness: 0.9, strikeNoise: 0.2, position: 0.06, brightness: 0.8, decay: 4, damping: 0.45, release: 0.18, spread: 0.03, noise: 0.06, noiseDecay: 0.012, noiseFreq: 5000, level: -4.6, bodyMix: 0.5, bodyF1: 200, bodyF2: 600, bodyF3: 3500, bodyQ: 2, reverbMix: 0.25 },
    mods: [["velocity", "level", 0.1], ["key", "decay", -0.3]],
    macros: [
      { name: "爪", routes: [["hardness", 0.2], ["position", -0.1]] },
      { name: "リュート・ストップ", routes: [["damping", 0.4], ["decay", -0.2]] },
      { name: "複弦", routes: [["spread", 0.4]] },
      SPACE_MACRO,
    ],
  },
  // ---------------- 撥弦 ----------------
  {
    id: "nylon",
    name: "ナイロン弦ギター",
    category: "plucked",
    description: "指で弾くナイロン弦。空洞の胴が低域を支える。",
    tags: ["guitar", "classical"],
    p: { structure: 0, stiffness: 0.03, hardness: 0.42, strikeNoise: 0.14, position: 0.18, brightness: 0.5, decay: 3.5, damping: 0.62, release: 0.15, spread: 0.02, noise: 0.05, noiseDecay: 0.02, noiseFreq: 2500, keySpread: 0.15, level: -3.3, bodyMix: 0.6, bodyF1: 105, bodyF2: 230, bodyF3: 2500, bodyQ: 3, reverbMix: 0.2 },
    mods: [...COHERENCE, ["key", "decay", -0.25], ["random", "position", 0.04]],
    macros: [
      { name: "爪の当たり", routes: [["hardness", 0.35], ["strikeNoise", 0.2]] },
      { name: "弾く位置", routes: [["position", -0.35]] },
      { name: "胴鳴り", routes: [["bodyMix", 0.4]] },
      SPACE_MACRO,
    ],
    play: { surface: "strum", low: 40, high: 88 },
  },
  {
    id: "steel",
    name: "スチール弦ギター",
    category: "plucked",
    description: "ピックで弾くスチール弦。明るく長い余韻。",
    tags: ["guitar", "acoustic"],
    p: { structure: 0, stiffness: 0.06, hardness: 0.7, strikeNoise: 0.18, position: 0.14, brightness: 0.7, decay: 5, damping: 0.45, release: 0.15, spread: 0.04, noise: 0.06, noiseDecay: 0.015, noiseFreq: 4000, keySpread: 0.15, level: -6, bodyMix: 0.45, bodyF1: 100, bodyF2: 200, bodyF3: 3000, bodyQ: 2.5, chorusMix: 0.08, reverbMix: 0.2 },
    mods: [...COHERENCE, ["key", "decay", -0.25], ["random", "position", 0.05]],
    macros: [
      { name: "ピック", routes: [["hardness", 0.3], ["strikeNoise", 0.2]] },
      { name: "ミュート", routes: [["release", -0.5], ["decay", -0.4], ["damping", 0.3]] },
      { name: "12弦", routes: [["spread", 0.5], ["chorusMix", 0.4]] },
      SPACE_MACRO,
    ],
    play: { surface: "strum", low: 40, high: 88 },
  },
  {
    id: "harp",
    name: "ハープ",
    category: "plucked",
    description: "弦の中ほどを指の腹で弾く。ダンパーがなく、余韻が重なる。",
    tags: ["harp", "orchestral"],
    p: { structure: 0, stiffness: 0.03, hardness: 0.33, strikeNoise: 0.06, position: 0.42, brightness: 0.45, decay: 6, damping: 0.6, release: 4, spread: 0.02, keySpread: 0.45, level: -6.9, bodyMix: 0.35, bodyF1: 150, bodyF2: 400, bodyF3: 2200, bodyQ: 2, reverbMix: 0.35, reverbSize: 3 },
    mods: [...COHERENCE, ["key", "decay", -0.3]],
    macros: [
      { name: "指の硬さ", routes: [["hardness", 0.4]] },
      { name: "駒の近く", routes: [["position", -0.4], ["brightness", 0.2]] },
      { name: "余韻", routes: [["release", 0.3], ["decay", 0.15]] },
      SPACE_MACRO,
    ],
    play: { surface: "strum", low: 24, high: 103 },
  },
  {
    id: "koto",
    name: "箏（こと）",
    category: "plucked",
    description: "爪で駒の近くを弾く。張力でわずかに音程が沈み、胴の木が鳴る。",
    tags: ["koto", "japanese"],
    p: { structure: 0, stiffness: 0.04, hardness: 0.75, strikeNoise: 0.25, position: 0.1, brightness: 0.68, decay: 4, damping: 0.5, release: 2.5, spread: 0.05, pitchEnv: 0.35, pitchEnvTime: 0.09, noise: 0.1, noiseDecay: 0.015, noiseFreq: 4000, drift: 0.1, level: -4.5, bodyMix: 0.5, bodyF1: 250, bodyF2: 550, bodyF3: 3200, bodyQ: 3, vibratoRate: 5, vibratoDelay: 0.3, reverbMix: 0.25 },
    mods: [...COHERENCE, ["key", "decay", -0.25], ["velocity", "pitchEnv", 0.03], ["modwheel", "vibratoDepth", 0.55]],
    macros: [
      { name: "爪の硬さ", routes: [["hardness", 0.25], ["strikeNoise", 0.2]] },
      { name: "余韻", routes: [["release", 0.25], ["decay", 0.2]] },
      { name: "揺り色", routes: [["vibratoDepth", 0.55]] },
      SPACE_MACRO,
    ],
    play: { surface: "strum", low: 43, high: 91 },
  },
  // ---------------- 擦弦 ----------------
  {
    id: "violin",
    name: "バイオリン",
    category: "bowed",
    description: "弓で擦り続ける弦。胴の共鳴が全音域で同じ声色を与える。",
    tags: ["violin", "strings", "orchestral"],
    p: { strike: 0.15, hardness: 0.6, drive: 0.85, driveColor: 0.75, breath: 0.18, grain: 0.35, driveAttack: 0.07, driveDecay: 0.3, driveSustain: 0.85, driveRelease: 0.18, structure: 0, stiffness: 0.02, brightness: 0.55, position: 0.12, decay: 1.2, damping: 0.5, release: 0.25, spread: 0.01, vibratoRate: 5.6, vibratoDepth: 22, vibratoDelay: 0.25, drift: 0.08, keySpread: 0.1, level: -7.8, bodyMix: 0.7, bodyF1: 280, bodyF2: 520, bodyF3: 2800, bodyQ: 3.5, reverbMix: 0.28, reverbSize: 2.6 },
    mods: [["velocity", "level", 0.25], ["velocity", "driveAttack", -0.3], ["pressure", "drive", 0.3], ["pressure", "driveColor", 0.15], ["timbre", "position", 0.3], ["modwheel", "vibratoDepth", 0.4], ["random", "fine", 0.01]],
    macros: [
      { name: "弓圧", routes: [["drive", 0.25], ["driveColor", 0.2], ["breath", 0.25]] },
      { name: "駒寄り", routes: [["position", -0.25], ["brightness", 0.25]] },
      { name: "ビブラート", routes: [["vibratoDepth", 0.5]] },
      SPACE_MACRO,
    ],
    play: { low: 55, high: 100, polyphony: 6 },
  },
  {
    id: "cello",
    name: "チェロ",
    category: "bowed",
    description: "大きな胴が低い共鳴を持つ擦弦楽器。",
    tags: ["cello", "strings", "orchestral"],
    p: { strike: 0.12, hardness: 0.5, drive: 0.85, driveColor: 0.7, breath: 0.2, grain: 0.35, driveAttack: 0.09, driveDecay: 0.35, driveSustain: 0.85, driveRelease: 0.25, structure: 0, stiffness: 0.02, brightness: 0.5, position: 0.13, decay: 2, damping: 0.5, release: 0.3, spread: 0.01, vibratoRate: 5.2, vibratoDepth: 18, vibratoDelay: 0.3, drift: 0.08, keySpread: 0.1, level: -7.5, bodyMix: 0.7, bodyF1: 105, bodyF2: 220, bodyF3: 1800, bodyQ: 3, reverbMix: 0.28, reverbSize: 2.6 },
    mods: [["velocity", "level", 0.25], ["velocity", "driveAttack", -0.3], ["pressure", "drive", 0.3], ["timbre", "position", 0.3], ["modwheel", "vibratoDepth", 0.4], ["random", "fine", 0.01]],
    macros: [
      { name: "弓圧", routes: [["drive", 0.25], ["driveColor", 0.2], ["breath", 0.25]] },
      { name: "ピチカート", routes: [["drive", -1], ["strike", 0.85], ["hardness", -0.1]] },
      { name: "ビブラート", routes: [["vibratoDepth", 0.5]] },
      SPACE_MACRO,
    ],
    play: { low: 36, high: 81, polyphony: 6 },
  },
  {
    id: "glassharmonica",
    name: "グラスハーモニカ",
    category: "bowed",
    description: "回るガラス椀を濡れた指で擦る。純粋で浮遊する持続音。",
    tags: ["glass", "ethereal"],
    p: { strike: 0, drive: 0.7, driveColor: 0.15, breath: 0.08, grain: 0.2, driveAttack: 0.35, driveSustain: 0.9, driveRelease: 1, structure: 0.62, stiffness: 0, brightness: 0.4, decay: 4, damping: 0.4, release: 1.2, spread: 0.03, vibratoDepth: 4, vibratoRate: 4, level: -2.5, bodyMix: 0.1, reverbMix: 0.4, reverbSize: 4 },
    mods: [["velocity", "level", 0.2], ["pressure", "drive", 0.3]],
    macros: [
      { name: "擦る強さ", routes: [["breath", 0.3], ["driveColor", 0.3]] },
      { name: "ガラスの厚み", routes: [["structure", -0.15]] },
      { name: "揺らぎ", routes: [["spread", 0.4], ["vibratoDepth", 0.3]] },
      SPACE_MACRO,
    ],
    play: { low: 55, high: 96 },
  },
  // ---------------- 管・息 ----------------
  {
    id: "flute",
    name: "フルート",
    category: "wind",
    description: "開管に息を吹き込む。正弦に近い芯と息の音。",
    tags: ["flute", "woodwind"],
    p: { strike: 0, drive: 0.8, driveColor: 0.25, breath: 0.35, grain: 0.25, driveAttack: 0.09, driveDecay: 0.3, driveSustain: 0.9, driveRelease: 0.12, structure: 0, brightness: 0.35, decay: 0.5, damping: 0.7, release: 0.15, noise: 0.08, noiseDecay: 0.08, noiseFreq: 2500, noiseQ: 1.2, vibratoRate: 5, vibratoDepth: 12, vibratoDelay: 0.3, drift: 0.06, keySpread: 0, level: -5.5, bodyMix: 0.15, reverbMix: 0.28 },
    mods: [["velocity", "level", 0.25], ["velocity", "noise", 0.2], ["pressure", "drive", 0.3], ["pressure", "driveColor", 0.2], ["modwheel", "vibratoDepth", 0.4], ["key", "breath", -0.1]],
    macros: [
      { name: "息", routes: [["breath", 0.35], ["noise", 0.2]] },
      { name: "芯", routes: [["driveColor", 0.4]] },
      { name: "ビブラート", routes: [["vibratoDepth", 0.45]] },
      SPACE_MACRO,
    ],
    play: { low: 60, high: 98, polyphony: 4 },
  },
  {
    id: "clarinet",
    name: "クラリネット",
    category: "wind",
    description: "閉管＝奇数倍音が主体。木の温かい芯。",
    tags: ["clarinet", "woodwind"],
    p: { strike: 0, drive: 0.8, driveColor: 0.55, breath: 0.12, grain: 0.2, driveAttack: 0.05, driveSustain: 0.9, driveRelease: 0.1, structure: 0, evenModes: 0.08, brightness: 0.5, decay: 0.6, damping: 0.5, release: 0.1, noise: 0.03, noiseDecay: 0.04, level: -6.5, bodyMix: 0.2, reverbMix: 0.25 },
    mods: [["velocity", "level", 0.25], ["velocity", "driveColor", 0.15], ["pressure", "drive", 0.3], ["modwheel", "vibratoDepth", 0.3]],
    macros: [
      { name: "息の強さ", routes: [["driveColor", 0.3], ["breath", 0.2]] },
      { name: "偶数倍音", routes: [["evenModes", 0.6]] },
      { name: "ビブラート", routes: [["vibratoDepth", 0.35]] },
      SPACE_MACRO,
    ],
    play: { low: 50, high: 91, polyphony: 4 },
  },
  {
    id: "shakuhachi",
    name: "尺八",
    category: "wind",
    description: "竹の管に強い息。下から掬い上げる音程と、ざらついた息。",
    tags: ["shakuhachi", "japanese", "breath"],
    p: { strike: 0, drive: 0.6, driveColor: 0.2, breath: 0.7, grain: 0.5, driveAttack: 0.12, driveSustain: 0.85, driveRelease: 0.2, structure: 0, brightness: 0.4, decay: 0.4, damping: 0.7, release: 0.2, noise: 0.15, noiseDecay: 0.2, noiseFreq: 1800, noiseQ: 0.9, vibratoRate: 4.5, vibratoDepth: 20, vibratoDelay: 0.5, drift: 0.15, pitchEnv: -0.6, pitchEnvTime: 0.18, level: -9, bodyMix: 0.2, reverbMix: 0.35, reverbSize: 3 },
    mods: [["velocity", "level", 0.25], ["velocity", "breath", 0.2], ["pressure", "breath", 0.3], ["modwheel", "vibratoDepth", 0.45]],
    macros: [
      { name: "ムラ息", routes: [["breath", 0.3], ["grain", 0.4]] },
      { name: "メリ", routes: [["pitchEnv", -0.08]] },
      { name: "ビブラート", routes: [["vibratoDepth", 0.45]] },
      SPACE_MACRO,
    ],
    play: { low: 50, high: 88, polyphony: 4 },
  },
  // ---------------- 鍵盤打楽器 ----------------
  {
    id: "marimba",
    name: "マリンバ",
    category: "mallet",
    description: "1:4:10 に削り調律された木の棒。柔らかな毛糸マレット。",
    tags: ["marimba", "wood"],
    p: { structure: 0.25, stiffness: 0, hardness: 0.35, strikeNoise: 0.05, position: 0.22, brightness: 0.55, decay: 1.2, damping: 0.75, release: 1, spread: 0.01, keySpread: 0.35, level: -1.6, bodyMix: 0.2, reverbMix: 0.25 },
    mods: [["velocity", "level", 0.34], ["velocity", "hardness", 0.45], ["key", "decay", -0.35]],
    macros: [
      { name: "マレット", routes: [["hardness", 0.45]] },
      { name: "木の乾き", routes: [["damping", 0.2], ["decay", -0.2]] },
      { name: "共鳴管", routes: [["decay", 0.2], ["bodyMix", 0.3]] },
      SPACE_MACRO,
    ],
    play: { surface: "grid", low: 45, high: 96 },
  },
  {
    id: "vibraphone",
    name: "ビブラフォン",
    category: "mallet",
    description: "金属の棒とモーターによる揺れ。ダンパーペダルで止める。",
    tags: ["vibes", "metal", "jazz"],
    p: { structure: 0.25, stiffness: 0.01, hardness: 0.55, position: 0.22, brightness: 0.6, decay: 6, damping: 0.45, release: 0.25, spread: 0.01, keySpread: 0.35, level: -7.1, lfoRate: 5.5, bodyMix: 0.1, reverbMix: 0.3 },
    mods: [["velocity", "level", 0.34], ["velocity", "hardness", 0.4], ["key", "decay", -0.2], ["lfo", "level", 0.05]],
    macros: [
      { name: "モーター速度", routes: [["lfoRate", 0.2]] },
      { name: "マレット", routes: [["hardness", 0.35]] },
      { name: "ペダル", routes: [["release", 0.6]] },
      SPACE_MACRO,
    ],
    play: { surface: "grid", low: 53, high: 89 },
  },
  {
    id: "glock",
    name: "グロッケンシュピール",
    category: "mallet",
    description: "自由振動する鋼の棒。非調和な高次モードが煌めく。",
    tags: ["glockenspiel", "metal"],
    p: { structure: 0.5, hardness: 0.85, position: 0.3, brightness: 0.7, decay: 4, damping: 0.35, release: 3, spread: 0.01, keySpread: 0.3, level: -2.4, bodyMix: 0.05, reverbMix: 0.3 },
    mods: [["velocity", "level", 0.3], ["velocity", "hardness", 0.3], ["key", "decay", -0.25]],
    macros: [
      { name: "マレット", routes: [["hardness", 0.3]] },
      { name: "余韻", routes: [["decay", 0.25]] },
      { name: "チェレスタ", routes: [["structure", -0.25], ["bodyMix", 0.5], ["hardness", -0.3]] },
      SPACE_MACRO,
    ],
    play: { surface: "grid", low: 72, high: 108 },
  },
  {
    id: "kalimba",
    name: "カリンバ",
    category: "mallet",
    description: "親指で弾く金属の舌。小さな木箱が鳴る。",
    tags: ["kalimba", "mbira", "africa"],
    p: { structure: 0.4, hardness: 0.6, strikeNoise: 0.15, position: 0.15, brightness: 0.35, decay: 2.5, damping: 0.6, release: 1.5, spread: 0.02, level: -1.7, bodyMix: 0.6, bodyF1: 300, bodyF2: 800, bodyF3: 2600, bodyQ: 4, reverbMix: 0.22 },
    mods: [...COHERENCE],
    macros: [
      { name: "爪", routes: [["hardness", 0.3], ["strikeNoise", 0.2]] },
      { name: "箱鳴り", routes: [["bodyMix", 0.4], ["bodyQ", 0.3]] },
      { name: "ビリつき", routes: [["noise", 0.4], ["spread", 0.3]] },
      SPACE_MACRO,
    ],
    play: { surface: "grid", low: 55, high: 96 },
  },
  {
    id: "musicbox",
    name: "オルゴール",
    category: "mallet",
    description: "櫛歯をピンが弾く。小さな箱の響き。",
    tags: ["music box", "toy"],
    p: { structure: 0.5, hardness: 0.9, position: 0.2, brightness: 0.5, decay: 3, damping: 0.5, release: 3, spread: 0.02, level: -0.7, bodyMix: 0.6, bodyF1: 500, bodyF2: 1500, bodyF3: 4000, bodyQ: 4, reverbMix: 0.3 },
    mods: [["velocity", "level", 0.2], ["key", "decay", -0.25]],
    macros: [
      { name: "箱", routes: [["bodyMix", 0.4]] },
      { name: "櫛の硬さ", routes: [["structure", 0.1], ["brightness", 0.2]] },
      { name: "古いゼンマイ", routes: [["drift", 0.5], ["spread", 0.3]] },
      SPACE_MACRO,
    ],
    play: { surface: "grid", low: 67, high: 108 },
  },
  {
    id: "steelpan",
    name: "スチールパン",
    category: "mallet",
    description: "ドラム缶を叩き出して調律。伸びた倍音がきらめく。",
    tags: ["steelpan", "caribbean"],
    p: { structure: 0, stiffness: 0.3, hardness: 0.5, position: 0.25, brightness: 0.6, decay: 2, damping: 0.45, release: 1, spread: 0.1, level: -4.4, bodyMix: 0.15, chorusMix: 0.2, reverbMix: 0.25 },
    mods: [...COHERENCE],
    macros: [
      { name: "ゴムの硬さ", routes: [["hardness", 0.35]] },
      { name: "金属感", routes: [["stiffness", 0.3]] },
      { name: "うなり", routes: [["spread", 0.4]] },
      SPACE_MACRO,
    ],
    play: { surface: "grid", low: 55, high: 91 },
  },
  // ---------------- 鐘・金属 ----------------
  {
    id: "bell",
    name: "調律鐘",
    category: "bell",
    description: "ハム・プライム・短三度・五度・ノミナル…と調律された鐘の部分音。",
    tags: ["bell", "metal", "church"],
    p: { structure: 0.75, hardness: 0.75, position: 0.2, brightness: 0.6, decay: 8, damping: 0.3, release: 8, spread: 0.05, keySpread: 0.3, level: -6.7, bodyMix: 0.1, reverbMix: 0.45, reverbSize: 4 },
    mods: [["velocity", "level", 0.3], ["velocity", "hardness", 0.3], ["key", "decay", -0.2]],
    macros: [
      { name: "打ち木", routes: [["hardness", 0.25], ["strikeNoise", 0.3]] },
      { name: "余韻", routes: [["decay", 0.2]] },
      { name: "うなり", routes: [["spread", 0.4]] },
      SPACE_MACRO,
    ],
    play: { low: 36, high: 96 },
  },
  {
    id: "singingbowl",
    name: "シンギングボウル",
    category: "bell",
    description: "椀の縁を擦り続けると、鐘の部分音が持続して歌い出す。",
    tags: ["bowl", "meditation", "drone"],
    p: { strike: 0.3, hardness: 0.4, drive: 0.5, driveColor: 0.25, breath: 0.1, grain: 0.3, driveAttack: 1.5, driveSustain: 1, driveRelease: 3, structure: 0.75, brightness: 0.5, decay: 15, damping: 0.25, release: 10, spread: 0.12, level: -1.5, bodyMix: 0.05, reverbMix: 0.35, reverbSize: 5 },
    mods: [["velocity", "level", 0.25], ["pressure", "drive", 0.4], ["lfo", "brightness", 0.05]],
    macros: [
      { name: "擦る速さ", routes: [["drive", 0.3], ["driveColor", 0.3]] },
      { name: "うなり", routes: [["spread", 0.4]] },
      { name: "椀の深さ", routes: [["structure", 0.15]] },
      SPACE_MACRO,
    ],
    play: { low: 36, high: 84, polyphony: 6 },
  },
  // ---------------- 太鼓・打楽器 ----------------
  {
    id: "timpani",
    name: "ティンパニ",
    category: "drum",
    description: "張った膜をマレットで。音程のある太鼓。",
    tags: ["timpani", "orchestral", "membrane"],
    p: { structure: 0.95, hardness: 0.3, position: 0.25, brightness: 0.4, decay: 3, damping: 0.6, release: 2, pitchEnv: 0.3, pitchEnvTime: 0.1, noise: 0.1, noiseDecay: 0.05, noiseFreq: 400, level: -4.6, bodyMix: 0.3, bodyF1: 90, bodyF2: 300, bodyF3: 1500, reverbMix: 0.3, reverbSize: 3 },
    mods: [["velocity", "level", 0.35], ["velocity", "hardness", 0.4], ["velocity", "pitchEnv", 0.02]],
    macros: [
      { name: "マレット", routes: [["hardness", 0.4]] },
      { name: "膜の張り", routes: [["pitchEnv", 0.05], ["decay", -0.2]] },
      { name: "ロール", routes: [["breath", 0.6], ["drive", 0.2]] },
      SPACE_MACRO,
    ],
    play: { surface: "pads", low: 36, high: 60 },
  },
  {
    id: "handdrum",
    name: "ハンドドラム",
    category: "drum",
    description: "手で打つ枠太鼓。打った瞬間に音程が沈む。",
    tags: ["frame drum", "percussion"],
    p: { structure: 1, hardness: 0.6, position: 0.3, brightness: 0.45, decay: 0.6, damping: 0.7, release: 0.5, pitchEnv: 2, pitchEnvTime: 0.08, noise: 0.2, noiseDecay: 0.03, noiseFreq: 800, level: -3, bodyMix: 0.3, bodyF1: 120, bodyF2: 400, reverbMix: 0.2 },
    mods: [["velocity", "level", 0.35], ["velocity", "hardness", 0.4], ["velocity", "pitchEnv", 0.03], ["random", "position", 0.08]],
    macros: [
      { name: "手の硬さ", routes: [["hardness", 0.35]] },
      { name: "ミュート", routes: [["decay", -0.3]] },
      { name: "ジングル", routes: [["noise", 0.5], ["noiseFreq", 0.4], ["noiseDecay", 0.3]] },
      SPACE_MACRO,
    ],
    play: { surface: "pads", low: 36, high: 72 },
  },
  {
    id: "snare",
    name: "スネア",
    category: "drum",
    description: "膜の音＋響き線のざらついたノイズ。",
    tags: ["snare", "drums"],
    p: { structure: 1, hardness: 0.75, position: 0.3, brightness: 0.6, decay: 0.25, damping: 0.5, release: 0.25, pitchEnv: 3, pitchEnvTime: 0.03, noise: 0.75, noiseDecay: 0.18, noiseFreq: 4500, noiseQ: 0.7, level: -7.2, bodyMix: 0.1, reverbMix: 0.18 },
    mods: [["velocity", "level", 0.35], ["velocity", "noise", 0.1], ["random", "noiseFreq", 0.03]],
    macros: [
      { name: "響き線", routes: [["noise", 0.3], ["noiseDecay", 0.3]] },
      { name: "胴の鳴り", routes: [["decay", 0.3]] },
      { name: "チューニング", routes: [["fine", 0.3]] },
      SPACE_MACRO,
    ],
    play: { surface: "pads", low: 48, high: 72 },
  },
  {
    id: "kick808",
    name: "808 キック／ベース",
    category: "drum",
    description: "ほぼ正弦の膜＋ピッチ落下＋飽和。音程を付ければ 808 ベース。",
    tags: ["808", "kick", "bass", "electronic"],
    p: { structure: 0, hardness: 0.2, brightness: 0, evenModes: 0, decay: 1.6, damping: 1, release: 0.4, pitchEnv: 12, pitchEnvTime: 0.08, saturation: 0.35, noise: 0.04, noiseDecay: 0.006, noiseFreq: 3000, keySpread: 0, spread: 0, drift: 0, level: 4.5, bodyMix: 0, reverbMix: 0.05 },
    mods: [["velocity", "level", 0.3], ["velocity", "saturation", 0.2]],
    macros: [
      { name: "ピッチ落下", routes: [["pitchEnv", 0.2], ["pitchEnvTime", 0.2]] },
      { name: "長さ", routes: [["decay", 0.3]] },
      { name: "歪み", routes: [["saturation", 0.6]] },
      SPACE_MACRO,
    ],
    play: { surface: "pads", low: 24, high: 55, polyphony: 1, mono: true, legato: false, glide: 0.06 },
  },
  {
    id: "hihat",
    name: "ハイハット",
    category: "drum",
    description: "金属の非調和なモードと高域ノイズ。マクロで開閉。",
    tags: ["hihat", "cymbal", "drums"],
    p: { strike: 0.35, structure: 0.7, stiffness: 1, hardness: 1, brightness: 1, decay: 0.15, damping: 0, release: 0.1, spread: 0.5, noise: 0.9, noiseDecay: 0.06, noiseFreq: 9000, noiseQ: 0.6, keySpread: 0, level: -5, bodyMix: 0, reverbMix: 0.15 },
    mods: [["velocity", "level", 0.35], ["velocity", "noiseFreq", 0.05]],
    macros: [
      { name: "開閉", routes: [["noiseDecay", 0.45], ["decay", 0.35]] },
      { name: "金属感", routes: [["strike", 0.5]] },
      { name: "明るさ", routes: [["noiseFreq", 0.2]] },
      SPACE_MACRO,
    ],
    play: { surface: "pads", low: 54, high: 72 },
  },
  // ---------------- 声・電子 ----------------
  {
    id: "choir",
    name: "合唱「ア」",
    category: "voice",
    description: "声帯の持続振動＋母音のフォルマント（胴＝口腔）。音高が変わっても同じ母音。",
    tags: ["choir", "vocal", "pad"],
    p: { strike: 0, drive: 0.75, driveColor: 0.62, breath: 0.2, grain: 0.3, driveAttack: 0.25, driveSustain: 0.9, driveRelease: 0.5, structure: 0, brightness: 0.55, decay: 0.8, damping: 0.5, spread: 0.02, vibratoRate: 5, vibratoDepth: 15, vibratoDelay: 0.4, drift: 0.12, level: -5.9, bodyMix: 0.95, bodyF1: 750, bodyF2: 1200, bodyF3: 2600, bodyQ: 6, chorusMix: 0.4, reverbMix: 0.45, reverbSize: 4 },
    mods: [["velocity", "level", 0.2], ["modwheel", "bodyF2", 0.3], ["random", "fine", 0.02]],
    macros: [
      { name: "母音 ア→イ", routes: [["bodyF1", -0.35], ["bodyF2", 0.35]] },
      { name: "息まじり", routes: [["breath", 0.35]] },
      { name: "人数", routes: [["chorusMix", 0.5], ["spread", 0.3]] },
      SPACE_MACRO,
    ],
    play: { low: 43, high: 84, polyphony: 8 },
  },
  {
    id: "glasspad",
    name: "グラス・パッド",
    category: "voice",
    description: "伸びた倍音を擦り続ける物理モデル・パッド。",
    tags: ["pad", "synth", "ambient"],
    p: { strike: 0, drive: 0.7, driveColor: 0.6, breath: 0.1, grain: 0.1, driveAttack: 0.8, driveDecay: 1, driveSustain: 0.85, driveRelease: 2.5, structure: 0.15, stiffness: 0.1, brightness: 0.5, decay: 2, damping: 0.4, spread: 0.25, drift: 0.2, level: 0.5, bodyMix: 0.2, lfoRate: 0.2, chorusMix: 0.5, reverbMix: 0.5, reverbSize: 5 },
    mods: [["velocity", "level", 0.15], ["lfo", "driveColor", 0.08], ["modwheel", "brightness", 0.3]],
    macros: [
      { name: "明るさ", routes: [["driveColor", 0.3], ["brightness", 0.3]] },
      { name: "金属化", routes: [["structure", 0.35]] },
      { name: "うねり", routes: [["spread", 0.3], ["lfoRate", 0.3]] },
      SPACE_MACRO,
    ],
    play: { low: 36, high: 96, polyphony: 8 },
  },
  {
    id: "subbass",
    name: "サブベース",
    category: "voice",
    description: "持続する低い正弦に、少しの飽和。単音でレガート。",
    tags: ["bass", "synth", "electronic"],
    p: { strike: 0.2, hardness: 0.3, drive: 0.8, driveColor: 0.1, driveAttack: 0.005, driveSustain: 1, driveRelease: 0.08, structure: 0, brightness: 0.1, evenModes: 0.5, decay: 0.5, damping: 0.8, release: 0.08, saturation: 0.3, keySpread: 0, spread: 0, drift: 0, level: 2.5, bodyMix: 0, reverbMix: 0 },
    mods: [["velocity", "level", 0.15], ["modwheel", "saturation", 0.5]],
    macros: [
      { name: "倍音", routes: [["driveColor", 0.5]] },
      { name: "歪み", routes: [["saturation", 0.5]] },
      { name: "アタック", routes: [["strike", 0.6], ["hardness", 0.4]] },
      SPACE_MACRO,
    ],
    play: { low: 24, high: 60, polyphony: 1, mono: true, legato: true, glide: 0.08 },
  },
];

function build(d: SeedDef): Instrument {
  const inst = createInstrument(d.name);
  inst.id = `seed:${d.id}`;
  inst.meta = {
    name: d.name,
    author: "Atelier",
    category: d.category,
    tags: d.tags,
    description: d.description,
    createdAt: "2026-09-30T00:00:00.000Z",
    lineage: [],
  };
  Object.assign(inst.params, d.p);
  const mods: ModRoute[] = [];
  const push = (source: ModSourceId, target: string, amount: number) => {
    const ex = mods.find((m) => m.source === source && m.target === target);
    if (ex) ex.amount = amount;
    else mods.push({ source, target, amount });
  };
  for (const [s, t, a] of d.mods ?? COHERENCE) push(s, t, a);
  (d.macros ?? []).forEach((m, i) => {
    inst.macros[i].name = m.name;
    for (const [t, a] of m.routes) push(`macro${i + 1}` as ModSourceId, t, a);
  });
  inst.mods = mods;
  inst.play = { ...inst.play, ...d.play };
  return inst;
}

export const SEEDS: Instrument[] = DEFS.map(build);
export const SEED_BY_ID: Record<string, Instrument> = Object.fromEntries(SEEDS.map((s) => [s.id, s]));
