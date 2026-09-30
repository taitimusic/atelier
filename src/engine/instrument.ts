/**
 * 楽器定義（Instrument）— アプリ全体の単一の正本データ。
 *
 * 楽器 = 領域（region）＋対応づけ（mapping）＋同一音源性（coherence）
 *  - params: 共鳴体・励起・胴などの物理パラメータ（＝音色空間の「中心」）
 *  - mods:   ベロシティ・音高・押し込み等 → パラメータ への写像（＝演奏が辿る「領域」と「対応づけ」）
 *  - 同一音源性は、全ての音が同じモード構造・同じ胴を共有する物理モデルで構造的に担保される。
 *
 * ファイル形式 `.atelier`（JSON）。値は人間が読める物理値で保存する。
 */

import {
  ALL_PARAMS,
  GLOBAL_PARAMS,
  MOD_SOURCES,
  N_MACROS,
  PARAM_BY_ID,
  VOICE_INDEX,
  VOICE_PARAMS,
  denorm,
  isVoiceParam,
  norm,
  type ModSourceId,
} from "./params";

export const FORMAT = "atelier.instrument";
export const VERSION = 2;

export interface ModRoute {
  source: ModSourceId;
  target: string;
  /** 正規化空間での変調量 −1..1 */
  amount: number;
}

export interface Macro {
  name: string;
  value: number;
}

export type Surface = "keys" | "grid" | "strum" | "pads";

export interface PlaySettings {
  polyphony: number;
  mono: boolean;
  legato: boolean;
  glide: number;
  bendRange: number;
  low: number;
  high: number;
  surface: Surface;
}

export interface LineageEntry {
  id: string;
  name: string;
  weight: number;
}

/** 楽器が持つ音律（任意）。ガムラン・箏・微分音の楽器などでは音律も「対応づけ」の一部。 */
export interface InstrumentTuning {
  name: string;
  /** 1 周期内のステップ（セント、末尾が周期） */
  steps: number[];
  rootNote: number;
  a4: number;
}

export interface Instrument {
  format: typeof FORMAT;
  version: number;
  id: string;
  meta: {
    name: string;
    author?: string;
    category: string;
    tags: string[];
    description?: string;
    createdAt: string;
    updatedAt?: string;
    /** 系譜: どの楽器をどの重みで混ぜて生まれたか */
    lineage: LineageEntry[];
  };
  params: Record<string, number>;
  mods: ModRoute[];
  macros: Macro[];
  play: PlaySettings;
  tuning?: InstrumentTuning;
}

export const CATEGORIES = [
  { id: "keys", label: "鍵盤" },
  { id: "plucked", label: "撥弦" },
  { id: "bowed", label: "擦弦" },
  { id: "wind", label: "管・息" },
  { id: "mallet", label: "鍵盤打楽器" },
  { id: "bell", label: "鐘・金属" },
  { id: "drum", label: "太鼓・打楽器" },
  { id: "voice", label: "声・電子" },
  { id: "hybrid", label: "創作" },
] as const;

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "i-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function defaultParams(): Record<string, number> {
  const p: Record<string, number> = {};
  for (const s of ALL_PARAMS) p[s.id] = s.def;
  return p;
}

export function defaultMacros(): Macro[] {
  return Array.from({ length: N_MACROS }, (_, i) => ({ name: `マクロ${i + 1}`, value: 0 }));
}

export function defaultPlay(): PlaySettings {
  return { polyphony: 12, mono: false, legato: true, glide: 0, bendRange: 2, low: 21, high: 108, surface: "keys" };
}

export function createInstrument(name = "無題の楽器"): Instrument {
  return {
    format: FORMAT,
    version: VERSION,
    id: newId(),
    meta: { name, category: "hybrid", tags: [], createdAt: new Date().toISOString(), lineage: [] },
    params: defaultParams(),
    mods: [],
    macros: defaultMacros(),
    play: defaultPlay(),
  };
}

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const num = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? x : d);

/** 外部から来たデータを安全な Instrument に整える（未知キーは捨て、欠損は既定、値は範囲へ） */
export function sanitize(raw: unknown): Instrument {
  if (!raw || typeof raw !== "object") throw new Error("楽器データではありません");
  const r = raw as Record<string, unknown>;
  if (r.format !== FORMAT) throw new Error("atelier の楽器ファイルではありません");
  if (typeof r.version === "string" || "timbre" in r || "engine" in r) {
    throw new Error("旧版（Atelier v1）の楽器ファイルです。音源の仕組みが異なるため v2 では読み込めません");
  }
  const meta = (r.meta ?? {}) as Record<string, unknown>;
  const params = defaultParams();
  const rp = (r.params ?? {}) as Record<string, unknown>;
  for (const s of ALL_PARAMS) {
    const v = num(rp[s.id], s.def);
    params[s.id] = clamp(v, Math.min(s.min, s.max), Math.max(s.min, s.max));
  }
  const srcIds = new Set(MOD_SOURCES.map((s) => s.id as string));
  const seen = new Set<string>();
  const mods: ModRoute[] = [];
  for (const m of Array.isArray(r.mods) ? r.mods : []) {
    if (!m || typeof m !== "object") continue;
    const mm = m as Record<string, unknown>;
    const source = String(mm.source);
    const target = String(mm.target);
    if (!srcIds.has(source) || !(target in PARAM_BY_ID)) continue;
    if (!isVoiceParam(target) && !isGlobalSource(source as ModSourceId)) continue;
    const key = source + ">" + target;
    if (seen.has(key)) continue;
    seen.add(key);
    mods.push({ source: source as ModSourceId, target, amount: clamp(num(mm.amount, 0), -1, 1) });
  }
  const macros = defaultMacros();
  if (Array.isArray(r.macros)) {
    r.macros.slice(0, N_MACROS).forEach((m, i) => {
      if (!m || typeof m !== "object") return;
      const mm = m as Record<string, unknown>;
      if (typeof mm.name === "string" && mm.name.trim()) macros[i].name = mm.name.slice(0, 24);
      macros[i].value = clamp(num(mm.value, 0), 0, 1);
    });
  }
  const pd = defaultPlay();
  const rp2 = (r.play ?? {}) as Record<string, unknown>;
  const surfaces: Surface[] = ["keys", "grid", "strum", "pads"];
  const play: PlaySettings = {
    polyphony: Math.round(clamp(num(rp2.polyphony, pd.polyphony), 1, 16)),
    mono: rp2.mono === true,
    legato: rp2.legato !== false,
    glide: clamp(num(rp2.glide, 0), 0, 2),
    bendRange: Math.round(clamp(num(rp2.bendRange, 2), 0, 48)),
    low: Math.round(clamp(num(rp2.low, pd.low), 0, 126)),
    high: Math.round(clamp(num(rp2.high, pd.high), 1, 127)),
    surface: surfaces.includes(rp2.surface as Surface) ? (rp2.surface as Surface) : "keys",
  };
  if (play.high <= play.low) play.high = Math.min(127, play.low + 12);
  const lineage: LineageEntry[] = Array.isArray(meta.lineage)
    ? (meta.lineage as unknown[])
        .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
        .map((x) => ({ id: String(x.id ?? ""), name: String(x.name ?? ""), weight: clamp(num(x.weight, 0), 0, 1) }))
        .slice(0, 16)
    : [];
  let tuning: InstrumentTuning | undefined;
  const rt = r.tuning as Record<string, unknown> | undefined;
  if (rt && typeof rt === "object" && Array.isArray(rt.steps)) {
    const steps = (rt.steps as unknown[]).map(Number).filter((x) => Number.isFinite(x)).slice(0, 256);
    if (steps.length >= 1 && steps[steps.length - 1] > 0) {
      tuning = {
        name: typeof rt.name === "string" ? rt.name.slice(0, 48) : "楽器の音律",
        steps,
        rootNote: Math.round(clamp(num(rt.rootNote, 60), 0, 127)),
        a4: clamp(num(rt.a4, 440), 300, 600),
      };
    }
  }
  return {
    tuning,
    format: FORMAT,
    version: VERSION,
    id: typeof r.id === "string" && r.id.trim() ? r.id : newId(),
    meta: {
      name: typeof meta.name === "string" && meta.name.trim() ? meta.name.slice(0, 60) : "無題の楽器",
      author: typeof meta.author === "string" ? meta.author.slice(0, 60) : undefined,
      category: typeof meta.category === "string" ? meta.category : "hybrid",
      tags: Array.isArray(meta.tags) ? meta.tags.filter((t): t is string => typeof t === "string").slice(0, 16) : [],
      description: typeof meta.description === "string" ? meta.description.slice(0, 500) : undefined,
      createdAt: typeof meta.createdAt === "string" ? meta.createdAt : new Date().toISOString(),
      updatedAt: typeof meta.updatedAt === "string" ? meta.updatedAt : undefined,
      lineage,
    },
    params,
    mods,
    macros,
    play,
  };
}

/** マクロ・モッドホイールは全体（グローバル）パラメータも動かせる */
export function isGlobalSource(s: ModSourceId): boolean {
  return s === "modwheel" || s.startsWith("macro");
}

// ------------------------------------------------------------------
// エンジン向けの平坦化
// ------------------------------------------------------------------

/** ボイス用: 正規化ベース値の配列と [src,target,amount] 平坦配列 */
export function toVoicePatch(inst: Instrument): { base: Float64Array; routes: Float32Array } {
  const base = new Float64Array(VOICE_PARAMS.length);
  VOICE_PARAMS.forEach((s, i) => {
    base[i] = norm(s, inst.params[s.id] ?? s.def);
  });
  const vr = inst.mods.filter((m) => isVoiceParam(m.target) && m.amount !== 0);
  const routes = new Float32Array(vr.length * 3);
  vr.forEach((m, j) => {
    routes[j * 3] = MOD_SOURCES.findIndex((s) => s.id === m.source);
    routes[j * 3 + 1] = VOICE_INDEX[m.target];
    routes[j * 3 + 2] = m.amount;
  });
  return { base, routes };
}

/** 全体パラメータの実効値（マクロ／モッドホイールの変調を反映した物理値） */
export function effectiveGlobals(inst: Instrument, modwheel: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of GLOBAL_PARAMS) {
    let n = norm(s, inst.params[s.id] ?? s.def);
    for (const m of inst.mods) {
      if (m.target !== s.id) continue;
      const src = m.source === "modwheel" ? modwheel : m.source.startsWith("macro") ? inst.macros[Number(m.source.slice(5)) - 1]?.value ?? 0 : 0;
      n += m.amount * src;
    }
    out[s.id] = denorm(s, n);
  }
  return out;
}

export function getN(inst: Instrument, id: string): number {
  const s = PARAM_BY_ID[id];
  return norm(s, inst.params[id] ?? s.def);
}

export function withParamN(inst: Instrument, id: string, n: number): Instrument {
  const s = PARAM_BY_ID[id];
  return { ...inst, params: { ...inst.params, [id]: denorm(s, n) } };
}

export function modAmount(inst: Instrument, source: string, target: string): number {
  return inst.mods.find((m) => m.source === source && m.target === target)?.amount ?? 0;
}

export function withMod(inst: Instrument, source: ModSourceId, target: string, amount: number): Instrument {
  const a = clamp(amount, -1, 1);
  const rest = inst.mods.filter((m) => !(m.source === source && m.target === target));
  if (Math.abs(a) < 1e-4) return { ...inst, mods: rest };
  return { ...inst, mods: [...rest, { source, target, amount: a }] };
}

// ------------------------------------------------------------------
// 補間（モーフ）— 正規化空間で重み付き平均。どの中間点も有効な楽器になる。
// ------------------------------------------------------------------

export function blend(parts: { inst: Instrument; weight: number }[], name?: string): Instrument {
  const ps = parts.filter((p) => p.weight > 1e-6);
  if (ps.length === 0) return structuredClone(parts[0].inst);
  const total = ps.reduce((a, p) => a + p.weight, 0);
  const w = ps.map((p) => p.weight / total);
  const dom = ps[w.indexOf(Math.max(...w))].inst;
  const params: Record<string, number> = {};
  for (const s of ALL_PARAMS) {
    let n = 0;
    ps.forEach((p, i) => {
      n += w[i] * norm(s, p.inst.params[s.id] ?? s.def);
    });
    params[s.id] = denorm(s, n);
  }
  const modMap = new Map<string, ModRoute>();
  ps.forEach((p, i) => {
    for (const m of p.inst.mods) {
      const k = m.source + ">" + m.target;
      const cur = modMap.get(k) ?? { source: m.source, target: m.target, amount: 0 };
      cur.amount += w[i] * m.amount;
      modMap.set(k, cur);
    }
  });
  const macros = dom.macros.map((m, j) => ({
    name: m.name,
    value: ps.reduce((a, p, i) => a + w[i] * (p.inst.macros[j]?.value ?? 0), 0),
  }));
  const lineage: LineageEntry[] = ps.map((p, i) => ({ id: p.inst.id, name: p.inst.meta.name, weight: +w[i].toFixed(3) }));
  return {
    tuning: dom.tuning,
    format: FORMAT,
    version: VERSION,
    id: dom.id,
    meta: {
      ...dom.meta,
      name: name ?? dom.meta.name,
      lineage,
      category: dom.meta.category,
    },
    params,
    mods: [...modMap.values()].filter((m) => Math.abs(m.amount) > 1e-4),
    macros,
    play: {
      ...dom.play,
      low: Math.round(ps.reduce((a, p, i) => a + w[i] * p.inst.play.low, 0)),
      high: Math.round(ps.reduce((a, p, i) => a + w[i] * p.inst.play.high, 0)),
      glide: ps.reduce((a, p, i) => a + w[i] * p.inst.play.glide, 0),
    },
  };
}

export function serialize(inst: Instrument): string {
  const round = (x: number) => +x.toPrecision(6);
  const out = {
    ...inst,
    meta: { ...inst.meta, updatedAt: new Date().toISOString() },
    params: Object.fromEntries(Object.entries(inst.params).map(([k, v]) => [k, round(v)])),
    mods: inst.mods.map((m) => ({ ...m, amount: round(m.amount) })),
    macros: inst.macros.map((m) => ({ ...m, value: round(m.value) })),
  };
  return JSON.stringify(out, null, 2);
}
