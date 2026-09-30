// Firefox / WebKit での最小確認: 起動 → 発音（アナライザ）→ デモ WAV 書き出し
import { firefox, webkit } from "playwright-core";
const URL = process.env.URL ?? "http://localhost:5191/";
const out = {};
for (const [name, bt] of [["firefox", firefox], ["webkit", webkit]]) {
  const r = { errors: [] };
  out[name] = r;
  let browser;
  try {
    browser = await bt.launch({ headless: true, firefoxUserPrefs: { "media.autoplay.default": 0, "media.autoplay.block-webaudio": false } });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
    page.on("pageerror", (e) => r.errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && r.errors.push(m.text()));
    await page.goto(URL);
    await page.getByRole("button", { name: "音を出してはじめる" }).click();
    await page.waitForTimeout(1200);
    r.state = await page.evaluate(() => window.__atelier.getEngine()?.ctx.state ?? "none");
    await page.keyboard.down("KeyA");
    r.rms = await page.evaluate(async () => {
      const an = window.__atelier.getEngine().analyser;
      const buf = new Float32Array(an.fftSize);
      let pk = 0;
      for (let i = 0; i < 12; i++) {
        an.getFloatTimeDomainData(buf);
        let s = 0;
        for (const x of buf) s += x * x;
        pk = Math.max(pk, Math.sqrt(s / buf.length));
        await new Promise((res) => setTimeout(res, 40));
      }
      return pk;
    });
    await page.keyboard.up("KeyA");
    await page.getByRole("button", { name: "書き出し・共有" }).click();
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 90000 }), page.getByRole("button", { name: "デモ WAV を書き出す" }).click()]);
    r.demo = dl.suggestedFilename();
    const p = await dl.path();
    const { statSync } = await import("node:fs");
    r.demoBytes = statSync(p).size;
  } catch (e) {
    r.failure = String(e.message ?? e).split("\n")[0];
  } finally {
    await browser?.close();
  }
}
console.log(JSON.stringify(out, null, 2));
