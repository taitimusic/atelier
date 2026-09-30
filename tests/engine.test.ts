import { describe, expect, it } from "vitest";
import { computeFamilies } from "../src/engine/modesCompute";
import { MODE_FAMILIES, computeRatios, MAX_MODES } from "../src/engine/modes";
import { Synth } from "../src/engine/synth";
import { SEEDS } from "../src/presets/seeds";
import { blend, sanitize, serialize, toVoicePatch, withMod, createInstrument } from "../src/engine/instrument";
import { describe as describeTimbre, region, coherence } from "../src/engine/descriptors";
import { ALL_PARAMS, denorm, norm } from "../src/engine/params";

describe("モード比", () => {
  it("埋め込み表が物理式からの再計算と一致する", () => {
    const fresh = computeFamilies();
    for (const f of fresh) {
      const table = MODE_FAMILIES.find((x) => x.id === f.id)!;
      for (let k = 0; k < MAX_MODES; k++) expect(table.ratios[k]).toBeCloseTo(f.ratios[k], 3);
    }
  });
  it("既知の物理値: 自由棒 2.756/5.404、円形膜 1.593/2.136", () => {
    const bar = MODE_FAMILIES.find((f) => f.id === "bar")!.ratios;
    expect(bar[1]).toBeCloseTo(2.756, 2);
    expect(bar[2]).toBeCloseTo(5.404, 2);
    const mem = MODE_FAMILIES.find((f) => f.id === "membrane")!.ratios;
    expect(mem[1]).toBeCloseTo(1.593, 2);
    expect(mem[2]).toBeCloseTo(2.136, 2);
  });
  it("構造 0 は理想弦（整数倍）", () => {
    const out = new Float64Array(MAX_MODES);
    computeRatios(0, 0, out);
    for (let k = 0; k < 10; k++) expect(out[k]).toBeCloseTo(k + 1, 6);
  });
});

function renderNote(inst = SEEDS[0], note = 60, vel = 0.8, holdSec = 0.5, totalSec = 1.5) {
  const s = new Synth(48000);
  const { base, routes } = toVoicePatch(inst);
  s.setPatch(base, routes);
  s.schedule(0, 1, note, vel, 0);
  s.schedule(Math.round(holdSec * 48000), 2, note, 0, 0);
  const N = Math.round(totalSec * 48000);
  const L = new Float32Array(N);
  const R = new Float32Array(N);
  for (let o = 0; o < N; o += 128) s.render(L, R, Math.min(128, N - o), o);
  return { s, L, R };
}

describe("合成コア", () => {
  it("全ての種が有限で、鳴り、飽和しすぎない", () => {
    for (const inst of SEEDS) {
      const mid = Math.round((inst.play.low + inst.play.high) / 2);
      const { L } = renderNote(inst, mid, 0.9, 0.4, 0.8);
      let pk = 0;
      let bad = 0;
      for (const x of L) {
        if (!Number.isFinite(x)) bad++;
        else pk = Math.max(pk, Math.abs(x));
      }
      expect(bad, inst.meta.name).toBe(0);
      expect(pk, inst.meta.name).toBeGreaterThan(0.01);
      expect(pk, inst.meta.name).toBeLessThan(2.5);
    }
  });
  it("離鍵後は減衰してボイスが解放される", () => {
    const { s } = renderNote(SEEDS.find((x) => x.id === "seed:violin")!, 67, 0.8, 0.3, 3);
    expect(s.activeVoiceCount()).toBe(0);
  });
  it("強く弾くほど明るい（ベロシティ→硬さ）", () => {
    const piano = SEEDS[0];
    const soft = describeTimbre(piano, 60, 0.2);
    const hard = describeTimbre(piano, 60, 1.0);
    expect(hard.brightness).toBeGreaterThan(soft.brightness);
  });
  it("同時発音数を超えても破綻しない（ボイス・スティール）", () => {
    const s = new Synth(48000);
    s.polyphony = 4;
    const { base, routes } = toVoicePatch(SEEDS[0]);
    s.setPatch(base, routes);
    for (let n = 0; n < 20; n++) s.noteOn(48 + n, 0.8);
    const L = new Float32Array(128);
    const R = new Float32Array(128);
    for (let i = 0; i < 200; i++) s.render(L, R, 128);
    expect(s.activeVoiceCount()).toBeLessThanOrEqual(8);
    expect(L.every((x) => Number.isFinite(x))).toBe(true);
  });
  it("予約イベントはサンプル精度で発音する", () => {
    const s = new Synth(48000);
    const { base, routes } = toVoicePatch(SEEDS[0]);
    s.setPatch(base, routes);
    s.schedule(1000, 1, 60, 1, 0);
    const L = new Float32Array(2048);
    const R = new Float32Array(2048);
    s.render(L, R, 2048);
    for (let i = 0; i < 1000; i++) expect(L[i]).toBe(0);
    let any = 0;
    for (let i = 1000; i < 1200; i++) any += Math.abs(L[i]);
    expect(any).toBeGreaterThan(0);
  });
});

describe("楽器データ", () => {
  it("正規化 ⇄ 物理値が往復する", () => {
    for (const p of ALL_PARAMS) {
      for (const n of [0, 0.25, 0.5, 1]) expect(norm(p, denorm(p, n))).toBeCloseTo(n, 6);
    }
  });
  it("書き出し → 読み込みで同一になる", () => {
    for (const inst of SEEDS.slice(0, 6)) {
      const back = sanitize(JSON.parse(serialize(inst)));
      for (const p of ALL_PARAMS) expect(back.params[p.id]).toBeCloseTo(inst.params[p.id], 4);
      expect(back.mods.length).toBe(inst.mods.length);
      expect(back.macros.map((m) => m.name)).toEqual(inst.macros.map((m) => m.name));
    }
  });
  it("壊れた入力を範囲内に整える", () => {
    const bad = { format: "atelier.instrument", params: { decay: -5, hardness: 99, level: NaN }, mods: [{ source: "velocity", target: "nope", amount: 3 }, { source: "velocity", target: "hardness", amount: 3 }], play: { polyphony: 99, low: 80, high: 10 } };
    const s = sanitize(bad);
    expect(s.params.decay).toBeGreaterThan(0);
    expect(s.params.hardness).toBeLessThanOrEqual(1);
    expect(Number.isFinite(s.params.level)).toBe(true);
    expect(s.mods).toEqual([{ source: "velocity", target: "hardness", amount: 1 }]);
    expect(s.play.polyphony).toBe(16);
    expect(s.play.high).toBeGreaterThan(s.play.low);
  });
  it("別形式は拒否する", () => {
    expect(() => sanitize({ format: "something" })).toThrow();
  });
  it("ブレンドは端点で元の楽器に一致し、系譜を持つ", () => {
    const a = SEEDS[0];
    const b = SEEDS[7];
    const at0 = blend([{ inst: a, weight: 1 }, { inst: b, weight: 0 }]);
    for (const p of ALL_PARAMS) expect(at0.params[p.id]).toBeCloseTo(a.params[p.id], 6);
    const mid = blend([{ inst: a, weight: 0.5 }, { inst: b, weight: 0.5 }]);
    expect(mid.meta.lineage.map((l) => l.name)).toEqual([a.meta.name, b.meta.name]);
  });
  it("変調の追加・削除", () => {
    let i = createInstrument();
    i = withMod(i, "velocity", "hardness", 0.4);
    expect(i.mods).toHaveLength(1);
    i = withMod(i, "velocity", "hardness", 0);
    expect(i.mods).toHaveLength(0);
  });
});

describe("領域と同一音源性", () => {
  it("種楽器はなめらかな領域を持つ（同一音源性 0.75 以上）", () => {
    for (const inst of SEEDS) expect(coherence(region(inst)), inst.meta.name).toBeGreaterThan(0.75);
  });
});

describe("旧版ファイル", () => {
  it("v1 の .atelier は理由付きで拒否する（黙って既定値の楽器にしない）", () => {
    const v1 = { format: "atelier.instrument", version: "1.0.0", id: "x", engine: "structured-synth@1", meta: { name: "旧い楽器" }, timbre: {} };
    expect(() => sanitize(v1)).toThrow(/旧版/);
  });
});
