import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// 検証・自動テスト用の読み取り窓口（UI からは使わない）
import { getEngine } from "./state/audio";
import { useStore } from "./state/store";
import { SEED_BY_ID } from "./presets/seeds";
(window as unknown as { __atelier: unknown }).__atelier = { getEngine, useStore, seeds: SEED_BY_ID };
