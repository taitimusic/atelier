// 実ブラウザの書き出し経路（ワークレット＋胴/EQ/空間 FX）で試聴用デモ WAV を作る。
// 出力: $ATELIER_OUT/renders/browser/（既定 out/）
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const URL = process.env.URL ?? "http://localhost:5191/";
const OUT = `${process.env.ATELIER_OUT ?? "out"}/renders/browser`;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(URL);
await page.getByRole("button", { name: "音を出してはじめる" }).click();
await page.waitForTimeout(500);

async function demo(file) {
  await page.getByRole("button", { name: "書き出し・共有" }).click();
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.getByRole("button", { name: "デモ WAV を書き出す" }).click()]);
  await dl.saveAs(`${OUT}/${file}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
}

const only = process.argv[2];
const names = await page.locator(".inst-row .inst-name").allTextContents();
let i = 0;
for (const n of names) {
  i++;
  if (only && !n.includes(only)) continue;
  await page.locator(".inst-row", { hasText: n }).first().click();
  await page.waitForTimeout(100);
  await demo(`${String(i).padStart(2, "0")}_${n.replace(/[\\/:*?"<>|\s]+/g, "_")}.wav`);
  console.log("ok", n);
}

// 交配の例: ブレンドパッドの角に置いて中間点を書き出す
const hybrids = [
  ["seed:piano", "seed:singingbowl", 0.45, "ピアノ×シンギングボウル"],
  ["seed:koto", "seed:glassharmonica", 0.5, "箏×グラスハーモニカ"],
  ["seed:violin", "seed:bell", 0.4, "バイオリン×調律鐘"],
  ["seed:marimba", "seed:shakuhachi", 0.5, "マリンバ×尺八"],
  ["seed:kick808", "seed:timpani", 0.5, "808×ティンパニ"],
];
if (!only) {
  for (const [a, b, x, label] of hybrids) {
    await page.evaluate(
      ([a, b, x]) => {
        const st = window.__atelier.useStore.getState();
        const lib = window.__atelier.seeds;
        st.setCorner(0, lib[a]);
        st.setCorner(1, lib[b]);
        st.setCorner(2, null);
        st.setCorner(3, null);
        st.movePuck(x, 0);
      },
      [a, b, x],
    );
    await page.waitForTimeout(100);
    await demo(`hybrid_${label}.wav`);
    console.log("ok", label);
  }
}
console.log("errors", errors);
await browser.close();
