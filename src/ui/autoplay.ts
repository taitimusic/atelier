/** 操作中の自動試奏: 音色を動かしている間、弾いていなくても短いフレーズが鳴り続ける（音先行のフィードバック） */
import { usePerf } from "../input/perform";
import { useStore } from "../state/store";
import { audition } from "./audition";

let timer: ReturnType<typeof setInterval> | null = null;
export let autoplayEnabled = true;

export function setAutoplay(v: boolean): void {
  autoplayEnabled = v;
}

function busy(): boolean {
  const p = usePerf.getState();
  return Object.keys(p.held).length > 0 || p.loop.state === "playing" || p.loop.state === "overdub" || p.loop.state === "recording";
}

export function startAutoplay(): void {
  if (!autoplayEnabled || timer) return;
  const tick = () => {
    if (busy()) return;
    const s = useStore.getState();
    void audition(s.preview ?? s.inst);
  };
  tick();
  timer = setInterval(tick, 1100);
}

export function stopAutoplay(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
