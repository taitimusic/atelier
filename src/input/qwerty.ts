/**
 * PC キーボード演奏（DAW 標準配置）。
 *   A W S E D F T G Y H U J K O L P ; = C〜E（1 オクターブ半）
 *   Z / X = オクターブ −/＋、C / V = ベロシティ −/＋、Space = サステイン、Esc = 全消音
 */
import { useStore } from "../state/store";
import { noteOff, noteOn, panic, setSustain, usePerf } from "./perform";

const MAP: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11,
  KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17,
};

let qVel = 0.8;
const down = new Map<string, number>();

export function qwertyVelocity(): number {
  return qVel;
}

function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}

export function installQwerty(onFirstGesture: () => void): () => void {
  const kd = (e: KeyboardEvent) => {
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    const code = e.code;
    if (code in MAP) {
      e.preventDefault();
      if (e.repeat || down.has(code)) return;
      onFirstGesture();
      const oct = usePerf.getState().octave;
      const note = 60 + oct * 12 + MAP[code];
      down.set(code, note);
      noteOn(`q:${code}`, note, qVel, 0);
      return;
    }
    if (e.repeat) return;
    if (code === "KeyZ") usePerf.setState((s) => ({ octave: Math.max(-4, s.octave - 1) }));
    else if (code === "KeyX") usePerf.setState((s) => ({ octave: Math.min(4, s.octave + 1) }));
    else if (code === "KeyC") {
      qVel = Math.max(0.1, qVel - 0.1);
      useStore.getState().toast(`ベロシティ ${Math.round(qVel * 127)}`);
    } else if (code === "KeyV") {
      qVel = Math.min(1, qVel + 0.1);
      useStore.getState().toast(`ベロシティ ${Math.round(qVel * 127)}`);
    } else if (code === "Space") {
      e.preventDefault();
      setSustain(true);
    } else if (code === "Escape") panic();
  };
  const ku = (e: KeyboardEvent) => {
    const code = e.code;
    if (down.has(code)) {
      const note = down.get(code)!;
      down.delete(code);
      noteOff(`q:${code}`, note, 0);
    } else if (code === "Space" && !typing(e)) {
      setSustain(false);
    }
  };
  const blur = () => {
    for (const [code, note] of down) noteOff(`q:${code}`, note, 0);
    down.clear();
  };
  window.addEventListener("keydown", kd);
  window.addEventListener("keyup", ku);
  window.addEventListener("blur", blur);
  return () => {
    window.removeEventListener("keydown", kd);
    window.removeEventListener("keyup", ku);
    window.removeEventListener("blur", blur);
  };
}
