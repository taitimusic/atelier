/** スペクトル（対数周波数）表示。マスター出力の読み取り専用タップの実データのみ。 */
import { useRef } from "react";
import { getEngine } from "../state/audio";
import { useRaf } from "./hooks";

export function Scope({ height = 64 }: { height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const buf = useRef<Float32Array | null>(null);
  useRaf(() => {
    const cv = ref.current;
    const e = getEngine();
    if (!cv) return;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const g = cv.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!e) return;
    const an = e.analyser;
    if (!buf.current || buf.current.length !== an.frequencyBinCount) buf.current = new Float32Array(an.frequencyBinCount);
    an.getFloatFrequencyData(buf.current as Float32Array<ArrayBuffer>);
    const data = buf.current;
    const sr = e.sampleRate;
    const fmin = 30;
    const fmax = 16000;
    const css = getComputedStyle(cv);
    const acc = css.getPropertyValue("--accent").trim() || "#e8a857";
    g.beginPath();
    for (let x = 0; x <= w; x += 2) {
      const f = fmin * Math.pow(fmax / fmin, x / w);
      const bin = Math.min(data.length - 1, Math.round((f / (sr / 2)) * data.length));
      const db = Math.max(-100, data[bin]);
      const y = h - ((db + 100) / 90) * h;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokeStyle = acc;
    g.lineWidth = 1.3;
    g.stroke();
    g.lineTo(w, h);
    g.lineTo(0, h);
    g.closePath();
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "rgba(232,168,87,0.28)");
    grad.addColorStop(1, "rgba(232,168,87,0)");
    g.fillStyle = grad;
    g.fill();
  });
  return <canvas ref={ref} className="scope" style={{ height }} aria-hidden="true" />;
}
