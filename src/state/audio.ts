/** 状態 ↔ AudioEngine の橋渡し（エンジンはユーザー操作後に 1 度だけ生成） */
import { AudioEngine } from "../engine/engine";
import { useStore } from "./store";

let engine: AudioEngine | null = null;
let creating: Promise<AudioEngine> | null = null;

export function getEngine(): AudioEngine | null {
  return engine;
}

export async function ensureAudio(): Promise<AudioEngine> {
  if (engine) {
    await engine.resume();
    return engine;
  }
  if (!creating) {
    creating = (async () => {
      const e = await AudioEngine.create();
      engine = e;
      wire(e);
      await e.resume();
      useStore.getState().setAudioReady(true);
      return e;
    })();
  }
  return creating;
}

function wire(e: AudioEngine): void {
  let raf = 0;
  const push = () => {
    raf = 0;
    const s = useStore.getState();
    e.setInstrument(s.preview ?? s.inst);
  };
  const s0 = useStore.getState();
  e.setTuning(s0.tuning);
  e.setMpe(true);
  push();
  useStore.subscribe((s, prev) => {
    if (s.inst !== prev.inst || s.preview !== prev.preview) {
      if (!raf) raf = requestAnimationFrame(push);
    }
    if (s.tuning !== prev.tuning) e.setTuning(s.tuning);
    if (s.modwheel !== prev.modwheel) e.setModWheel(s.modwheel);
  });
  e.ctx.addEventListener("statechange", () => {
    useStore.getState().setAudioReady(e.ctx.state === "running");
  });
}
