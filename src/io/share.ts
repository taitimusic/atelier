/** 楽器を URL に埋め込んで共有する（サーバ不要）。deflate-raw ＋ base64url。 */
import { sanitize, serialize, type Instrument } from "../engine/instrument";

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const res = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

export async function encodeInstrument(inst: Instrument): Promise<string> {
  const json = JSON.stringify(JSON.parse(serialize(inst)));
  const z = await pipe(new TextEncoder().encode(json), new CompressionStream("deflate-raw"));
  return b64url(z);
}

export async function decodeInstrument(code: string): Promise<Instrument> {
  const raw = await pipe(fromB64url(code), new DecompressionStream("deflate-raw"));
  return sanitize(JSON.parse(new TextDecoder().decode(raw)));
}

export async function shareUrl(inst: Instrument): Promise<string> {
  const code = await encodeInstrument(inst);
  const u = new URL(location.href);
  u.hash = `i=${code}`;
  return u.toString();
}

export function readShareHash(): string | null {
  const m = /[#&]i=([A-Za-z0-9_-]+)/.exec(location.hash);
  return m ? m[1] : null;
}
