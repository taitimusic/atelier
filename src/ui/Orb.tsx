/**
 * オーブ: 楽器ごとの視覚的アイデンティティ。音色記述子から決定論的に生成する。
 * 色相＝明るさ（暗い藍 → 明るい琥珀）、輪郭の波打ち＝非調和性とノイズ感、大きさ＝持続、
 * 核の大きさ＝立ち上がりの鋭さ、内側の輪＝非調和なモードの多さ。
 */
import { useId, useMemo } from "react";
import type { Descriptor } from "../engine/descriptors";

export function orbHue(d: Descriptor): number {
  return 250 - d.brightness * 215;
}

export function Orb({ d, size = 40, level = 0, className }: { d: Descriptor; size?: number; level?: number; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const shape = useMemo(() => {
    const h = orbHue(d);
    const h2 = h - 30 - d.noisiness * 60;
    const sat = 58 + d.sustain * 22;
    const R = 25 + d.sustain * 9;
    const lobes = 3 + Math.round(d.inharmonicity * 5 + d.noisiness * 3);
    const amp = 0.035 + d.inharmonicity * 0.2 + d.noisiness * 0.1;
    const phase = d.attack * Math.PI;
    let path = "";
    const N = 72;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const r = R * (1 + amp * Math.sin(lobes * a + phase) + amp * 0.35 * Math.sin((lobes + 2) * a - phase * 1.7));
      path += `${i === 0 ? "M" : "L"}${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`;
    }
    const rings = Math.round(d.inharmonicity * 4 + (d.noisiness > 0.2 ? 1 : 0));
    return { h, h2, sat, R, path: path + "Z", rings };
  }, [d]);
  const { h, h2, sat, R, path, rings } = shape;
  const sw = Math.max(1.4, (100 / size) * 0.9);
  const scale = 1 + Math.min(0.22, level * 0.5);
  return (
    <svg className={className} width={size} height={size} viewBox="-50 -50 100 100" aria-hidden="true">
      <defs>
        <radialGradient id={`ob${uid}`} cx="40%" cy="38%" r="70%">
          <stop offset="0%" stopColor={`hsl(${h} ${sat}% 88%)`} />
          <stop offset="45%" stopColor={`hsl(${h} ${sat}% 60%)`} />
          <stop offset="100%" stopColor={`hsl(${h2} ${sat - 10}% 30%)`} />
        </radialGradient>
        <radialGradient id={`oh${uid}`}>
          <stop offset="55%" stopColor={`hsl(${h} ${sat}% 55%)`} stopOpacity="0.35" />
          <stop offset="100%" stopColor={`hsl(${h} ${sat}% 40%)`} stopOpacity="0" />
        </radialGradient>
      </defs>
      <g style={{ transform: `scale(${scale})`, transition: "transform 90ms linear" }}>
        <circle r={Math.min(49, R * 1.45)} fill={`url(#oh${uid})`} />
        <path d={path} fill={`url(#ob${uid})`} />
        {Array.from({ length: rings }, (_, i) => (
          <circle key={i} r={R * (0.32 + i * 0.16)} fill="none" stroke={`hsl(${h} 90% 94%)`} strokeOpacity={0.45 - i * 0.07} strokeWidth={sw * 0.7} />
        ))}
        <circle r={3 + d.attack * 7} fill={`hsl(${h} 100% 96%)`} opacity={0.9} />
      </g>
    </svg>
  );
}
