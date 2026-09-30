/**
 * アプリ状態（Zustand）。楽器定義 `inst` が唯一の正本で、音・画面・保存はすべてここから導出する。
 * 履歴はジェスチャ単位（つまみを 1 回ドラッグ＝1 手）。
 */
import { create } from "zustand";
import {
  blend,
  createInstrument,
  getN,
  isGlobalSource,
  newId,
  withMod,
  withParamN,
  type Instrument,
  type InstrumentTuning,
  type PlaySettings,
} from "../engine/instrument";
import { ALL_PARAMS, isVoiceParam, type ModSourceId, type ParamGroup } from "../engine/params";
import { defaultTuning, type TuningSettings } from "../engine/tuning";
import { SEEDS, SEED_BY_ID } from "../presets/seeds";
import { deleteInstrument, listInstruments, putInstrument } from "./library";

export type StageTab = "blend" | "map" | "discover";
export type PanelTab = "exciter" | "resonator" | "color" | "space" | "mod" | "play";

export interface Toast {
  id: number;
  msg: string;
  kind: "info" | "ok" | "error";
}

export interface BlendState {
  corners: (Instrument | null)[];
  x: number;
  y: number;
}

export interface DiscoverState {
  sigma: number;
  seed: number;
  groups: ParamGroup[];
  variants: Instrument[];
}

const HISTORY_MAX = 120;

interface State {
  inst: Instrument;
  past: Instrument[];
  future: Instrument[];
  inGesture: boolean;
  gestureBase: Instrument | null;
  /** 最後に保存（または読み込み）した時点の内容 */
  savedJson: string;
  ab: { active: "A" | "B"; other: Instrument | null };
  blend: BlendState;
  stage: StageTab;
  panel: PanelTab;
  assign: ModSourceId | null;
  locks: Record<string, boolean>;
  tuning: TuningSettings;
  library: Instrument[];
  discover: DiscoverState;
  preview: Instrument | null;
  audioReady: boolean;
  toasts: Toast[];
  modwheel: number;
  /** 明示的な読み込みの回数（演奏面の切替などに使う） */
  loadSeq: number;
  /** 現在の音律が楽器から来たものか */
  tuningFromInst: boolean;

  load(inst: Instrument, opts?: { keepHistory?: boolean; asNew?: boolean }): void;
  commit(next: Instrument): void;
  beginGesture(): void;
  endGesture(): void;
  setParamN(id: string, n: number): void;
  setMod(source: ModSourceId, target: string, amount: number): void;
  setMacro(i: number, v: number): void;
  renameMacro(i: number, name: string): void;
  setPlay(p: Partial<PlaySettings>): void;
  setMeta(m: Partial<Instrument["meta"]>): void;
  undo(): void;
  redo(): void;
  toggleAB(): void;
  copyToOther(): void;
  setStage(s: StageTab): void;
  setPanel(p: PanelTab): void;
  setAssign(s: ModSourceId | null): void;
  toggleLock(id: string): void;
  setTuning(t: Partial<TuningSettings>): void;
  attachTuning(on: boolean): void;
  setCorner(i: number, inst: Instrument | null): void;
  movePuck(x: number, y: number): void;
  regenerate(opts?: Partial<Pick<DiscoverState, "sigma" | "groups">> & { newSeed?: boolean }): void;
  setPreview(i: Instrument | null): void;
  refreshLibrary(): Promise<void>;
  save(asNew?: boolean): Promise<void>;
  removeFromLibrary(id: string): Promise<void>;
  toast(msg: string, kind?: Toast["kind"]): void;
  dismissToast(id: number): void;
  setAudioReady(v: boolean): void;
  setModWheel(v: number): void;
}

const json = (i: Instrument) => JSON.stringify({ p: i.params, m: i.mods, k: i.macros, y: i.play, n: i.meta.name, t: i.tuning });

let toastSeq = 0;

export const useStore = create<State>((set, get) => {
  const initial = structuredClone(SEED_BY_ID["seed:piano"] ?? SEEDS[0]);
  const pushPast = (s: State): Instrument[] => {
    const p = [...s.past, s.inst];
    return p.length > HISTORY_MAX ? p.slice(p.length - HISTORY_MAX) : p;
  };

  return {
    inst: initial,
    past: [],
    future: [],
    inGesture: false,
    gestureBase: null,
    savedJson: json(initial),
    ab: { active: "A", other: null },
    blend: {
      corners: [SEED_BY_ID["seed:piano"], SEED_BY_ID["seed:violin"], SEED_BY_ID["seed:marimba"], SEED_BY_ID["seed:singingbowl"]].map((x) => x ?? null),
      x: 0,
      y: 0,
    },
    stage: "blend",
    panel: "exciter",
    assign: null,
    locks: {},
    tuning: defaultTuning(),
    library: [],
    discover: { sigma: 0.12, seed: 1, groups: ["exciter", "drive", "resonator", "noise", "body"], variants: [] },
    preview: null,
    audioReady: false,
    toasts: [],
    modwheel: 0,
    loadSeq: 0,
    tuningFromInst: false,

    load(inst, opts = {}) {
      const next = structuredClone(inst);
      if (opts.asNew) {
        next.id = newId();
        next.meta = { ...next.meta, createdAt: new Date().toISOString(), lineage: next.meta.lineage.length ? next.meta.lineage : [{ id: inst.id, name: inst.meta.name, weight: 1 }] };
      }
      set((s) => ({
        inst: next,
        past: opts.keepHistory === false ? [] : pushPast(s),
        future: [],
        savedJson: json(next),
        preview: null,
        loadSeq: s.loadSeq + 1,
        ...tuningFor(next, s),
      }));
    },

    commit(next) {
      set((s) => {
        if (s.inGesture) return { inst: next };
        return { inst: next, past: pushPast(s), future: [] };
      });
    },

    beginGesture() {
      const s = get();
      if (s.inGesture) return;
      set({ inGesture: true, gestureBase: s.inst });
    },

    endGesture() {
      const s = get();
      if (!s.inGesture) return;
      const changed = s.gestureBase && s.gestureBase !== s.inst;
      set({
        inGesture: false,
        gestureBase: null,
        past: changed && s.gestureBase ? [...s.past, s.gestureBase].slice(-HISTORY_MAX) : s.past,
        future: changed ? [] : s.future,
      });
    },

    setParamN(id, n) {
      get().commit(withParamN(get().inst, id, n));
    },

    setMod(source, target, amount) {
      if (!isVoiceParam(target) && !isGlobalSource(source)) {
        get().toast("この変調源は音ごとに変わるため、胴や空間系には割り当てられません（マクロ／モッドホイールなら可）", "info");
        return;
      }
      get().commit(withMod(get().inst, source, target, amount));
    },

    setMacro(i, v) {
      const inst = get().inst;
      get().commit({ ...inst, macros: inst.macros.map((m, j) => (j === i ? { ...m, value: v } : m)) });
    },

    renameMacro(i, name) {
      const inst = get().inst;
      get().commit({ ...inst, macros: inst.macros.map((m, j) => (j === i ? { ...m, name: name.slice(0, 16) || m.name } : m)) });
    },

    setPlay(p) {
      const inst = get().inst;
      get().commit({ ...inst, play: { ...inst.play, ...p } });
    },

    setMeta(m) {
      const inst = get().inst;
      get().commit({ ...inst, meta: { ...inst.meta, ...m } });
    },

    undo() {
      const s = get();
      if (!s.past.length) return;
      const prev = s.past[s.past.length - 1];
      set({ inst: prev, past: s.past.slice(0, -1), future: [s.inst, ...s.future].slice(0, HISTORY_MAX), ...(prev.tuning !== s.inst.tuning ? tuningFor(prev, s) : {}) });
    },

    redo() {
      const s = get();
      if (!s.future.length) return;
      const [next, ...rest] = s.future;
      set({ inst: next, past: [...s.past, s.inst], future: rest, ...(next.tuning !== s.inst.tuning ? tuningFor(next, s) : {}) });
    },

    toggleAB() {
      const s = get();
      const other = s.ab.other ?? s.inst;
      set({ inst: other, ab: { active: s.ab.active === "A" ? "B" : "A", other: s.inst } });
    },

    copyToOther() {
      const s = get();
      set({ ab: { ...s.ab, other: structuredClone(s.inst) } });
      get().toast(`${s.ab.active} の音を ${s.ab.active === "A" ? "B" : "A"} にコピーしました`, "ok");
    },

    setStage(stage) {
      set({ stage, preview: null });
      if (stage === "discover" && get().discover.variants.length === 0) get().regenerate();
    },
    setPanel(panel) {
      set({ panel });
    },
    setAssign(assign) {
      set({ assign });
    },
    toggleLock(id) {
      set((s) => ({ locks: { ...s.locks, [id]: !s.locks[id] } }));
    },
    setTuning(t) {
      set((s) => ({ tuning: { ...s.tuning, ...t } }));
      const s = get();
      if (s.inst.tuning) s.commit({ ...s.inst, tuning: toInstTuning(s.tuning) });
    },
    attachTuning(on) {
      const s = get();
      s.commit({ ...s.inst, tuning: on ? toInstTuning(s.tuning) : undefined });
      set({ tuningFromInst: on });
    },

    setCorner(i, inst) {
      set((s) => {
        const corners = s.blend.corners.slice();
        corners[i] = inst ? structuredClone(inst) : null;
        return { blend: { ...s.blend, corners } };
      });
      const b = get().blend;
      get().movePuck(b.x, b.y);
    },

    movePuck(x, y) {
      const s = get();
      const cx = Math.max(0, Math.min(1, x));
      const cy = Math.max(0, Math.min(1, y));
      const w = [(1 - cx) * (1 - cy), cx * (1 - cy), (1 - cx) * cy, cx * cy];
      const parts = s.blend.corners
        .map((inst, i) => (inst ? { inst, weight: w[i] } : null))
        .filter((p): p is { inst: Instrument; weight: number } => !!p);
      set({ blend: { ...s.blend, x: cx, y: cy } });
      if (!parts.length) return;
      const tw = parts.reduce((a, p) => a + p.weight, 0);
      if (tw < 1e-6) return;
      const sorted = [...parts].sort((a, b) => b.weight - a.weight);
      const autoName =
        sorted[0].weight / tw > 0.97 ? sorted[0].inst.meta.name : sorted.filter((p) => p.weight / tw > 0.12).map((p) => p.inst.meta.name.replace(/（.*?）|「.*?」/g, "")).slice(0, 3).join(" × ");
      const next = blend(parts, autoName);
      const cornerIds = new Set(parts.map((p) => p.inst.id));
      next.id = s.inst.id.startsWith("seed:") || cornerIds.has(s.inst.id) ? newId() : s.inst.id;
      next.meta.createdAt = s.inst.meta.createdAt;
      next.meta.category = sorted[0].weight / tw > 0.97 ? sorted[0].inst.meta.category : "hybrid";
      s.commit(next);
    },

    regenerate(opts = {}) {
      const s = get();
      const d = { ...s.discover, ...opts };
      if (opts.newSeed !== false) d.seed = (d.seed * 1103515245 + 12345) & 0x7fffffff;
      const rng = mulberry32(d.seed || 1);
      const gauss = () => {
        const u = Math.max(1e-9, rng());
        const v = rng();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      };
      const groups = new Set(d.groups);
      const variants: Instrument[] = [];
      for (let k = 0; k < 8; k++) {
        let v = structuredClone(s.inst);
        for (const p of ALL_PARAMS) {
          if (!groups.has(p.group) || s.locks[p.id]) continue;
          if (p.id === "level" || p.id === "pan" || p.id === "fine") continue;
          const n = getN(v, p.id) + gauss() * d.sigma;
          v = withParamN(v, p.id, Math.max(0, Math.min(1, n)));
        }
        v.meta = { ...v.meta, name: `${s.inst.meta.name.replace(/ · 変奏\d+$/, "")} · 変奏${k + 1}` };
        variants.push(v);
      }
      set({ discover: { ...d, variants }, preview: null });
    },

    setPreview(preview) {
      set({ preview });
    },

    async refreshLibrary() {
      set({ library: await listInstruments() });
    },

    async save(asNew = false) {
      const s = get();
      let inst = s.inst;
      if (asNew || inst.id.startsWith("seed:")) {
        inst = {
          ...inst,
          id: newId(),
          meta: {
            ...inst.meta,
            author: inst.meta.author === "Atelier" ? undefined : inst.meta.author,
            createdAt: new Date().toISOString(),
            lineage: inst.meta.lineage.length ? inst.meta.lineage : [{ id: s.inst.id, name: s.inst.meta.name, weight: 1 }],
          },
        };
      }
      try {
        await putInstrument(inst);
        set({ inst, savedJson: json(inst) });
        await get().refreshLibrary();
        get().toast(`「${inst.meta.name}」をライブラリに保存しました`, "ok");
      } catch (e) {
        get().toast(`保存できませんでした: ${(e as Error).message}`, "error");
      }
    },

    async removeFromLibrary(id) {
      await deleteInstrument(id);
      await get().refreshLibrary();
    },

    toast(msg, kind = "info") {
      const id = ++toastSeq;
      set((s) => ({ toasts: [...s.toasts.slice(-3), { id, msg, kind }] }));
      setTimeout(() => get().dismissToast(id), kind === "error" ? 7000 : 3800);
    },
    dismissToast(id) {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },
    setAudioReady(audioReady) {
      set({ audioReady });
    },
    setModWheel(modwheel) {
      set({ modwheel });
    },
  };
});

function toInstTuning(t: TuningSettings): InstrumentTuning {
  return { name: t.tuning.name, steps: t.tuning.steps.slice(), rootNote: t.rootNote, a4: t.a4 };
}

/** 楽器が音律を持っていればそれを使い、持たない楽器へ移ったら 12 平均律へ戻す */
function tuningFor(inst: Instrument, s: { tuning: TuningSettings; tuningFromInst: boolean }): Partial<State> {
  if (inst.tuning) {
    const t = inst.tuning;
    return {
      tuning: { tuning: { id: `inst-${t.name}-${t.steps.length}-${t.steps[t.steps.length - 1].toFixed(2)}`, name: t.name, steps: t.steps.slice(), description: "楽器に保存された音律" }, rootNote: t.rootNote, a4: t.a4 },
      tuningFromInst: true,
    };
  }
  if (s.tuningFromInst) return { tuning: defaultTuning(), tuningFromInst: false };
  return {};
}

let liveTimer: ReturnType<typeof setTimeout> | null = null;
/** 連続する外部操作（MIDI CC など）を 1 手の履歴にまとめる */
export function liveEdit(fn: () => void): void {
  const s = useStore.getState();
  if (!s.inGesture) s.beginGesture();
  fn();
  if (liveTimer) clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
    liveTimer = null;
    useStore.getState().endGesture();
  }, 400);
}

export function isDirty(s: { inst: Instrument; savedJson: string }): boolean {
  return json(s.inst) !== s.savedJson;
}

export function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export { createInstrument };
