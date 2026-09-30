/** Standard MIDI File（フォーマット 0）の書き出し・読み込み（ノート・サステインのみ）。 */
import type { NoteEvent } from "../engine/engine";

const PPQ = 480;

function vlq(n: number): number[] {
  const out = [n & 0x7f];
  n >>= 7;
  while (n > 0) {
    out.unshift((n & 0x7f) | 0x80);
    n >>= 7;
  }
  return out;
}

export function writeMidi(events: NoteEvent[], bpm = 120, name = "Atelier"): Uint8Array {
  const sorted = [...events].sort((a, b) => a.time - b.time || (a.type === "off" ? -1 : 1));
  const tpsec = (PPQ * bpm) / 60;
  const trk: number[] = [];
  const nameBytes = Array.from(new TextEncoder().encode(name));
  trk.push(0, 0xff, 0x03, ...vlq(nameBytes.length), ...nameBytes);
  const us = Math.round(60000000 / bpm);
  trk.push(0, 0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff);
  let last = 0;
  for (const e of sorted) {
    const tick = Math.max(0, Math.round(e.time * tpsec));
    trk.push(...vlq(tick - last));
    last = tick;
    const ch = (e.ch ?? 0) & 15;
    if (e.type === "on") trk.push(0x90 | ch, e.note & 127, Math.max(1, Math.min(127, Math.round(e.vel * 127))));
    else if (e.type === "off") trk.push(0x80 | ch, e.note & 127, 64);
    else trk.push(0xb0 | ch, 64, e.vel > 0 ? 127 : 0);
  }
  trk.push(0, 0xff, 0x2f, 0);
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (PPQ >> 8) & 0xff, PPQ & 0xff];
  const len = trk.length;
  const th = [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff];
  return new Uint8Array([...head, ...th, ...trk]);
}

/** SMF を読み、全トラックのノートを秒時刻の NoteEvent 列へ（テンポ変化に対応） */
export function readMidi(bytes: Uint8Array): { events: NoteEvent[]; duration: number } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (str(0) !== "MThd") throw new Error("MIDI ファイルではありません");
  const ntrk = dv.getUint16(10);
  const div = dv.getUint16(12);
  if (div & 0x8000) throw new Error("SMPTE 時間形式は未対応です");
  let o = 8 + dv.getUint32(4);
  type Raw = { tick: number; kind: "on" | "off" | "sus" | "tempo"; a: number; b: number; ch: number };
  const raws: Raw[] = [];
  for (let t = 0; t < ntrk && o < bytes.length; t++) {
    if (str(o) !== "MTrk") break;
    const len = dv.getUint32(o + 4);
    let p = o + 8;
    const end = p + len;
    let tick = 0;
    let status = 0;
    const readVlq = () => {
      let v = 0;
      for (let i = 0; i < 4; i++) {
        const b = bytes[p++];
        v = (v << 7) | (b & 0x7f);
        if (!(b & 0x80)) break;
      }
      return v;
    };
    while (p < end) {
      tick += readVlq();
      let st = bytes[p];
      if (st & 0x80) p++;
      else st = status;
      if (st === 0xff) {
        const type = bytes[p++];
        const l = readVlq();
        if (type === 0x51 && l === 3) raws.push({ tick, kind: "tempo", a: (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2], b: 0, ch: 0 });
        p += l;
        continue;
      }
      if (st === 0xf0 || st === 0xf7) {
        p += readVlq();
        continue;
      }
      status = st;
      const hi = st & 0xf0;
      const ch = st & 0x0f;
      const d1 = bytes[p++];
      const d2 = hi === 0xc0 || hi === 0xd0 ? 0 : bytes[p++];
      if (hi === 0x90 && d2 > 0) raws.push({ tick, kind: "on", a: d1, b: d2, ch });
      else if (hi === 0x80 || (hi === 0x90 && d2 === 0)) raws.push({ tick, kind: "off", a: d1, b: 0, ch });
      else if (hi === 0xb0 && d1 === 64) raws.push({ tick, kind: "sus", a: d2, b: 0, ch });
    }
    o = end;
  }
  raws.sort((a, b) => a.tick - b.tick);
  let usPerQ = 500000;
  let lastTick = 0;
  let sec = 0;
  const events: NoteEvent[] = [];
  for (const r of raws) {
    sec += ((r.tick - lastTick) * usPerQ) / div / 1e6;
    lastTick = r.tick;
    if (r.kind === "tempo") usPerQ = r.a;
    else if (r.kind === "on") events.push({ time: sec, type: "on", note: r.a, vel: r.b / 127, ch: 0 });
    else if (r.kind === "off") events.push({ time: sec, type: "off", note: r.a, vel: 0, ch: 0 });
    else events.push({ time: sec, type: "sustain", note: 0, vel: r.a >= 64 ? 1 : 0 });
  }
  return { events, duration: sec };
}
