/**
 * Web MIDI 入力。ノート・ベロシティ・ピッチベンド・アフタータッチ（チャンネル／ポリ）・CC74（MPE スライド）・
 * モッドホイール・サステインに対応。チャンネルごとの表情をそのまま保つので MPE コントローラも使える。
 * MIDI Learn: CC をマクロに割り当てられる。
 */
import { create } from "zustand";
import { getEngine } from "../state/audio";
import { liveEdit, useStore } from "../state/store";
import { noteOff, noteOn, setSustain } from "./perform";

interface MidiState {
  supported: boolean;
  enabled: boolean;
  inputs: { id: string; name: string }[];
  lastActivity: number;
  learnMacro: number | null;
  /** CC 番号 → マクロ番号 */
  ccMap: Record<number, number>;
  set: (p: Partial<Omit<MidiState, "set">>) => void;
}

const LS_KEY = "atelier.v2.ccmap";

function loadCcMap(): Record<number, number> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* 無視 */
  }
  return { 71: 0, 72: 1, 73: 2, 91: 3 };
}

export const useMidi = create<MidiState>((set) => ({
  supported: typeof navigator !== "undefined" && "requestMIDIAccess" in navigator,
  enabled: false,
  inputs: [],
  lastActivity: 0,
  learnMacro: null,
  ccMap: loadCcMap(),
  set: (p) => set(p as Partial<MidiState>),
}));

function saveCcMap(m: Record<number, number>): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(m));
  } catch {
    /* プライベートモード等 */
  }
}

let access: MIDIAccess | null = null;

export async function enableMidi(): Promise<void> {
  const st = useMidi.getState();
  if (!st.supported) throw new Error("このブラウザは Web MIDI に対応していません（Chrome / Edge を推奨）");
  if (access) return;
  access = await navigator.requestMIDIAccess({ sysex: false });
  const refresh = () => {
    const inputs: { id: string; name: string }[] = [];
    access!.inputs.forEach((inp) => {
      inputs.push({ id: inp.id, name: inp.name ?? "MIDI 入力" });
      inp.onmidimessage = onMessage;
    });
    useMidi.getState().set({ inputs, enabled: true });
  };
  access.onstatechange = refresh;
  refresh();
}

export function learnCc(macro: number | null): void {
  useMidi.getState().set({ learnMacro: macro });
}

function onMessage(e: MIDIMessageEvent): void {
  const d = e.data;
  if (!d || d.length < 1) return;
  const st = d[0] & 0xf0;
  const ch = d[0] & 0x0f;
  const a = d[1] ?? 0;
  const b = d[2] ?? 0;
  const eng = getEngine();
  useMidi.setState({ lastActivity: performance.now() });
  const bendRange = useStore.getState().inst.play.bendRange;
  switch (st) {
    case 0x90:
      if (b > 0) noteOn(`midi:${ch}:${a}`, a, b / 127, ch);
      else noteOff(`midi:${ch}:${a}`, a, ch);
      break;
    case 0x80:
      noteOff(`midi:${ch}:${a}`, a, ch);
      break;
    case 0xe0: {
      const v = ((b << 7) | a) - 8192;
      // MPE ではメンバーチャンネルのベンドが ±48 半音が標準。ch0（マスター）は楽器のベンド幅。
      const range = ch === 0 ? bendRange : Math.max(bendRange, 48);
      eng?.bend(ch, (v / 8192) * range);
      break;
    }
    case 0xd0:
      eng?.pressure(ch, a / 127);
      break;
    case 0xa0:
      eng?.pressure(ch, b / 127, a);
      break;
    case 0xb0: {
      const learn = useMidi.getState().learnMacro;
      if (learn !== null && a !== 64 && a !== 1 && a !== 74) {
        const m = { ...useMidi.getState().ccMap };
        for (const k of Object.keys(m)) if (m[+k] === learn) delete m[+k];
        m[a] = learn;
        saveCcMap(m);
        useMidi.getState().set({ ccMap: m, learnMacro: null });
        useStore.getState().toast(`CC${a} をマクロ${learn + 1}に割り当てました`, "ok");
        return;
      }
      if (a === 64) setSustain(b >= 64);
      else if (a === 1) useStore.getState().setModWheel(b / 127);
      else if (a === 74) eng?.timbre(ch, (b / 127) * 2 - 1);
      else if (a === 123 || a === 120) eng?.allOff(a === 120);
      else {
        const macro = useMidi.getState().ccMap[a];
        if (macro !== undefined) {
          liveEdit(() => useStore.getState().setMacro(macro, b / 127));
          eng?.setMacro(macro, b / 127);
        }
      }
      break;
    }
  }
}
