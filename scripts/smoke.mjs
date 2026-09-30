// ヘッドレス Chromium（Playwright 同梱版）でアプリを動かし、エラー・発音・画面を検査する。
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const URL = process.env.URL ?? "http://localhost:5191/";
const OUT = `${process.env.ATELIER_OUT ?? "out"}/screens`;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const errors = [];
const results = {};

async function rms(page, ms = 250) {
  return page.evaluate(async (ms) => {
    const e = window.__atelier.getEngine();
    if (!e) return -1;
    const an = e.analyser;
    const buf = new Float32Array(an.fftSize);
    let peak = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      an.getFloatTimeDomainData(buf);
      let s = 0;
      for (const x of buf) s += x * x;
      peak = Math.max(peak, Math.sqrt(s / buf.length));
      await new Promise((r) => setTimeout(r, 30));
    }
    return peak;
  }, ms);
}

const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(URL);
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/01-gate.png` });
await page.getByRole("button", { name: "音を出してはじめる" }).click();
await page.waitForTimeout(800);
results.audioState = await page.evaluate(() => window.__atelier.getEngine()?.ctx.state);
results.silentBefore = await rms(page, 200);
await page.keyboard.down("KeyA");
results.rmsNote = await rms(page, 400);
await page.keyboard.up("KeyA");
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/02-blend.png` });

// ブレンドパッドをドラッグ
const pad = page.locator(".pad");
const box = await pad.boundingBox();
await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.55, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(400);
results.blendName = await page.evaluate(() => window.__atelier.useStore.getState().inst.meta.name);
results.lineage = await page.evaluate(() => window.__atelier.useStore.getState().inst.meta.lineage.map((l) => `${l.name}:${l.weight}`));
await page.keyboard.down("KeyD");
results.rmsBlend = await rms(page, 400);
await page.keyboard.up("KeyD");
await page.screenshot({ path: `${OUT}/03-blend-moved.png` });

// 各インスペクタのタブ
for (const [i, t] of ["共鳴体", "ピッチ", "胴・空間", "変調", "演奏"].entries()) {
  await page.getByRole("tab", { name: t, exact: true }).click();
  await page.waitForTimeout(150);
  if (i === 0 || i === 2 || i === 3) await page.screenshot({ path: `${OUT}/04-inspector-${i}.png` });
}
// 領域マップ
await page.getByRole("tab", { name: "領域マップ" }).click();
await page.keyboard.down("KeyA");
await page.keyboard.down("KeyG");
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/05-region.png` });
await page.keyboard.up("KeyA");
await page.keyboard.up("KeyG");
// 発見
await page.getByRole("tab", { name: "発見" }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/06-discover.png` });
results.variants = await page.locator(".disc-card").count();

// 種を切り替えて全種の発音を確認
const seeds = await page.evaluate(() => window.__atelier.useStore.getState().library.length);
results.library = seeds;
const seedRms = {};
const names = await page.locator(".inst-row .inst-name").allTextContents();
for (const n of names) {
  await page.locator(".inst-row", { hasText: n }).first().click();
  await page.waitForTimeout(150);
  const r = await rms(page, 350);
  seedRms[n] = +r.toFixed(4);
  await page.waitForTimeout(150);
}
results.seedRms = seedRms;

// 演奏面
for (const [t, f] of [["グリッド", "07-grid"], ["弦", "08-strum"], ["パッド", "09-pads"]]) {
  await page.getByRole("tab", { name: t, exact: true }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/${f}.png` });
}
// 弦をなぞる
await page.getByRole("tab", { name: "弦", exact: true }).click();
const strum = await page.locator(".strum").boundingBox();
await page.mouse.move(strum.x + strum.width / 2, strum.y + 4);
await page.mouse.down();
await page.mouse.move(strum.x + strum.width / 2, strum.y + strum.height - 4, { steps: 12 });
await page.mouse.up();
results.rmsStrum = await rms(page, 300);


// 遅延
results.latency = await page.evaluate(() => window.__atelier.getEngine().latency);

// ループ録音: 録って → ループにして → 手を離しても鳴り続ける
await page.getByRole("tab", { name: "鍵盤", exact: true }).click();
await page.locator("button", { hasText: "ループ録音" }).click();
await page.waitForTimeout(150);
for (const k of ["KeyA", "KeyD", "KeyG"]) {
  await page.keyboard.down(k);
  await page.waitForTimeout(180);
  await page.keyboard.up(k);
  await page.waitForTimeout(120);
}
await page.locator("button", { hasText: "ループにする" }).click();
await page.waitForTimeout(2600);
results.loopPlayingRms = await rms(page, 900);
results.loopLabel = await page.locator(".transport .loop .val").textContent().catch(() => null);
await page.getByRole("button", { name: "ループの再生／停止" }).click();
await page.waitForTimeout(1500);
results.loopStoppedRms = await rms(page, 300);

// アルペジオ: 和音を押さえると、鳴る音が次々に入れ替わる
await page.locator(".transport select").first().selectOption("up");
await page.keyboard.down("KeyA");
await page.keyboard.down("KeyD");
await page.keyboard.down("KeyG");
const seen = new Set();
for (let i = 0; i < 20; i++) {
  const notes = await page.locator(".key.sounding").evaluateAll((els) => els.map((e) => e.getAttribute("data-note")));
  notes.forEach((n) => seen.add(n));
  await page.waitForTimeout(60);
}
await page.keyboard.up("KeyA");
await page.keyboard.up("KeyD");
await page.keyboard.up("KeyG");
results.arpDistinctNotes = seen.size;
await page.locator(".transport select").first().selectOption("off");

// ライブラリ: 保存 → 再読み込みしても残る → 読み込める → 削除できる
await page.getByRole("button", { name: "保存", exact: true }).click();
await page.waitForTimeout(500);
const savedName = await page.evaluate(() => window.__atelier.useStore.getState().inst.meta.name);
await page.reload();
await page.getByRole("button", { name: "音を出してはじめる" }).click();
await page.waitForTimeout(400);
await page.getByRole("tab", { name: /マイ楽器/ }).click();
results.libraryAfterReload = await page.locator(".inst-row").count();
await page.locator(".inst-row", { hasText: savedName }).first().click();
await page.waitForTimeout(200);
results.libraryLoaded = (await page.evaluate(() => window.__atelier.useStore.getState().inst.meta.name)) === savedName;
page.once("dialog", (d) => d.accept());
await page.locator(".inst-list li").first().hover();
await page.getByRole("button", { name: `${savedName} を削除` }).click();
await page.waitForTimeout(300);
results.libraryAfterDelete = await page.locator(".inst-row").count();
await page.getByRole("tab", { name: /^種/ }).click();

// 書き出しダイアログ + 小さなマルチサンプル
await page.getByRole("button", { name: "書き出し・共有" }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/10-export.png` });
await page.locator("dialog select").nth(2).selectOption("6");
await page.locator("dialog select").nth(3).selectOption("1");
const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.getByRole("button", { name: /サンプルを書き出す/ }).click()]);
const zpath = `${OUT}/test-multisample.zip`;
await dl.saveAs(zpath);
results.zip = dl.suggestedFilename();
// 共有リンクを作り、新しいページで開く
await page.getByRole("button", { name: "リンクを作ってコピー" }).click();
await page.waitForTimeout(400);
const link = await page.locator("input.link").inputValue();
results.shareLen = link.length;
await page.keyboard.press("Escape");
const p2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
p2.on("pageerror", (e) => errors.push(`share pageerror: ${e.message}`));
await p2.goto(link);
await p2.waitForTimeout(600);
results.shareOpened = await p2.evaluate(() => window.__atelier.useStore.getState().inst.meta.name);
results.orbGradients = await p2.evaluate(() => {
  const circles = [...document.querySelectorAll(".inst-row svg circle")].slice(0, 3);
  return circles.map((c) => {
    const f = c.getAttribute("fill") ?? "";
    const m = /url\(#(.+)\)/.exec(f);
    return m ? !!document.getElementById(m[1]) : f;
  });
});
await p2.close();

// モバイル
const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
m.on("pageerror", (e) => errors.push(`mobile pageerror: ${e.message}`));
await m.goto(URL);
await m.getByRole("button", { name: "音を出してはじめる" }).click();
await m.waitForTimeout(500);
await m.screenshot({ path: `${OUT}/11-mobile.png` });
await m.screenshot({ path: `${OUT}/12-mobile-full.png`, fullPage: true });
results.mobileOverflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

results.errors = errors;
writeFileSync(`${OUT}/smoke-results.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();
