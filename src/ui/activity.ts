/** エンジンからのボイス活動（鳴っている音）を UI へ。高頻度なので React 状態を最小限に。 */
import { useEffect, useState } from "react";
import { create } from "zustand";
import type { VoiceActivity } from "../engine/engine";

export const useActivity = create<{ voices: VoiceActivity[] }>(() => ({ voices: [] }));

export function setActivity(v: VoiceActivity[]): void {
  const cur = useActivity.getState().voices;
  if (cur.length === 0 && v.length === 0) return;
  useActivity.setState({ voices: v });
}

/** 全体の音量（オーブの鼓動用） */
export function useActivityLevel(): number {
  const [lvl, setLvl] = useState(0);
  useEffect(
    () =>
      useActivity.subscribe((s) => {
        let m = 0;
        for (const v of s.voices) m = Math.max(m, v.level);
        setLvl(Math.min(1, m * 1.5));
      }),
    [],
  );
  return lvl;
}
