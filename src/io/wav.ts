/** PCM WAV エンコーダ（16/24bit・ステレオ/モノ）。依存なし。 */
export function encodeWav(channels: Float32Array[], sampleRate: number, bits: 16 | 24 = 24): Uint8Array {
  const nch = channels.length;
  const frames = channels[0]?.length ?? 0;
  const bps = bits / 8;
  const dataLen = frames * nch * bps;
  const buf = new ArrayBuffer(44 + dataLen);
  const dv = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  dv.setUint32(4, 36 + dataLen, true);
  str(8, "WAVE");
  str(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, nch, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * nch * bps, true);
  dv.setUint16(32, nch * bps, true);
  dv.setUint16(34, bits, true);
  str(36, "data");
  dv.setUint32(40, dataLen, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      let x = channels[c][i];
      x = !Number.isFinite(x) ? 0 : x > 1 ? 1 : x < -1 ? -1 : x;
      if (bits === 16) {
        dv.setInt16(o, Math.round(x * 32767), true);
        o += 2;
      } else {
        const v = Math.round(x * 8388607);
        dv.setUint8(o, v & 0xff);
        dv.setUint8(o + 1, (v >> 8) & 0xff);
        dv.setUint8(o + 2, (v >> 16) & 0xff);
        o += 3;
      }
    }
  }
  return new Uint8Array(buf);
}
