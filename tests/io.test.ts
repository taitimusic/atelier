import { describe, expect, it } from "vitest";
import { BUILTIN_TUNINGS, edo, frequencyTable, parseScala } from "../src/engine/tuning";
import { crc32, makeZip } from "../src/io/zip";
import { readMidi, writeMidi } from "../src/io/midifile";
import { encodeWav } from "../src/io/wav";
import { decodeInstrument, encodeInstrument } from "../src/io/share";
import { SEEDS } from "../src/presets/seeds";
import { asciiName } from "../src/io/multisample";

describe("調律", () => {
  it("12 平均律: A4=440, C4≈261.63", () => {
    const t = frequencyTable({ tuning: BUILTIN_TUNINGS[0], rootNote: 60, a4: 440 });
    expect(t[69]).toBeCloseTo(440, 6);
    expect(t[60]).toBeCloseTo(261.6256, 3);
  });
  it("19 平均律は 19 鍵でオクターブ", () => {
    const t = frequencyTable({ tuning: edo(19), rootNote: 60, a4: 440 });
    expect(t[79] / t[60]).toBeCloseTo(2, 9);
  });
  it("1/4 コンマ・ミーントーンの長三度は純正 (5/4)", () => {
    const m = BUILTIN_TUNINGS.find((x) => x.id === "meantone")!;
    expect(m.steps[3]).toBeCloseTo(1200 * Math.log2(5 / 4), 2); // E
  });
  it("Scala を読める（比とセント混在）", () => {
    const scl = `! test.scl\nTest scale\n 3\n!\n 9/8\n 386.3137\n 2/1\n`;
    const t = parseScala(scl, "test.scl");
    expect(t.steps).toHaveLength(3);
    expect(t.steps[0]).toBeCloseTo(203.91, 1);
    expect(t.steps[2]).toBeCloseTo(1200, 6);
  });
  it("壊れた Scala は理由付きで拒否", () => {
    expect(() => parseScala("x\n5\n100.0\n", "bad.scl")).toThrow(/音/);
  });
});

describe("ファイル", () => {
  it("CRC32 の既知値", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  it("ZIP の構造（ローカルヘッダ・中央ディレクトリ・終端）", () => {
    const z = makeZip([{ name: "a.txt", data: new TextEncoder().encode("hello") }]);
    const dv = new DataView(z.buffer);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    expect(dv.getUint32(z.length - 22, true)).toBe(0x06054b50);
    expect(dv.getUint16(z.length - 22 + 10, true)).toBe(1);
  });
  it("WAV ヘッダと長さ", () => {
    const w = encodeWav([new Float32Array(100), new Float32Array(100)], 48000, 24);
    expect(new TextDecoder().decode(w.slice(0, 4))).toBe("RIFF");
    expect(w.length).toBe(44 + 100 * 2 * 3);
  });
  it("MIDI 書き出し → 読み込みで時刻と音が保たれる", () => {
    const ev = [
      { time: 0, type: "on" as const, note: 60, vel: 0.8 },
      { time: 0.5, type: "off" as const, note: 60, vel: 0 },
      { time: 0.75, type: "on" as const, note: 64, vel: 0.5 },
      { time: 1.25, type: "off" as const, note: 64, vel: 0 },
    ];
    const back = readMidi(writeMidi(ev, 120));
    const ons = back.events.filter((e) => e.type === "on");
    expect(ons.map((e) => e.note)).toEqual([60, 64]);
    expect(ons[1].time).toBeCloseTo(0.75, 2);
    expect(back.duration).toBeCloseTo(1.25, 2);
  });
  it("共有リンクの符号化 → 復号で楽器が一致", async () => {
    const inst = SEEDS[3];
    const code = await encodeInstrument(inst);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = await decodeInstrument(code);
    expect(back.meta.name).toBe(inst.meta.name);
    expect(back.params.hardness).toBeCloseTo(inst.params.hardness, 4);
    expect(code.length).toBeLessThan(2500);
  });
  it("サンプル名は ASCII", () => {
    expect(asciiName("グランドピアノ", "fallback")).toBe("fallback");
    expect(asciiName("My Piano 2", "x")).toBe("My_Piano_2");
  });
});
