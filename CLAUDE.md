# Atelier v2 — AI エージェント向けメモ

楽器を創るブラウザアプリ。概要は README.md、設計の根拠は docs/DESIGN.md。

## 守ること
- **パラメータは `src/engine/params.ts` が単一正本**。新しい音色パラメータはここに足し、`synth.ts`（と必要なら `descriptors.ts` の式）で使う。UI・変調・保存・ブレンド・ランダム化は自動で追従する。
- `synth.ts` の描画経路（`render*`・カーネル）でアロケーションしない。モード表の式を変えたら `descriptors.ts` の同じ式も揃える。
- UI/状態は `AudioEngine`（`engine.ts`）越しにのみ音を扱う。演奏入力は必ず `input/perform.ts` を通す（アルペジオ・ループ録音が効くように）。
- 楽器データは IndexedDB（`state/library.ts`）。localStorage は MIDI CC 割当など端末ごとの好みだけ。
- `modeTable.ts` は生成物: `pnpm gen:modes`。

## 検証
- `pnpm test`（単体）/ `pnpm build`（型＋ビルド）/ `pnpm bench`（CPU 予算: 16 声最悪ケースで実時間 25% 未満を維持）
- `pnpm build && pnpm preview --port 5191` の上で `pnpm smoke`（ヘッドレス Chromium。スクリーンショットは `out/screens/`、出力先は環境変数 `ATELIER_OUT` で変更可）
- 音を変えたら `pnpm render:browser` で全種のデモ WAV を描画し、クリップ 0 を確認（`out/renders/browser/`）
