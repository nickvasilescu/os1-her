#!/usr/bin/env node
// Phone layout check: opens the built phone app (apps/mobile/dist) in headless Chrome at Pixel size,
// visits every screen and fails if anything runs off the side of the screen.
//
//   (cd apps/mobile && npx vite build) && python3 -m http.server 5741 --bind 127.0.0.1 -d apps/mobile/dist &
//   UAOS1_URL=https://server.tail85e19.ts.net:8796 UAOS1_TOKEN=… node scripts/check-phone-layout.mjs
//
// Needs puppeteer-core and Chrome (CHROME=/path/to/chrome). Switching screens goes through the
// server, so other devices follow along while it runs; it puts them back on Talk at the end.
import puppeteer from "puppeteer-core";

const orch = (process.env.UAOS1_URL || "").replace(/\/$/, "");
const token = process.env.UAOS1_TOKEN || "";
const page = process.env.PAGE_URL || "http://localhost:5741/";
const chrome = process.env.CHROME || "/usr/bin/google-chrome";
if (!orch || !token) {
  console.error("Set UAOS1_URL and UAOS1_TOKEN.");
  process.exit(2);
}
const SURFACES = ["conversation", "home", "inbox_cascade", "her_computer", "your_computer", "swarm",
  "made_just_now", "memory", "atlas", "apps", "connectors", "voice_picker"];
const go = (s) => fetch(`${orch}/os1/actions`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ target: "surface", action: s }),
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await puppeteer.launch({ executablePath: chrome, headless: "new", args: ["--no-sandbox"] });
let failures = 0;
try {
  const p = await b.newPage();
  await p.setViewport({ width: 412, height: 860, isMobile: true, hasTouch: true });
  await p.goto(page);
  await p.evaluate((c) => localStorage.setItem("uaos1.config", JSON.stringify(c)), { orchestratorUrl: orch, clientToken: token });
  await p.goto(page);
  const name = await p.waitForSelector("input", { timeout: 40000 }).catch(() => null);
  if (name) {
    await sleep(1500);
    await name.click();
    await name.type("Check");
    for (const x of await p.$$("button")) if ((await x.evaluate((e) => e.textContent)).includes("Begin")) { await x.click(); break; }
  }
  await sleep(6000);
  for (const s of SURFACES) {
    await go(s);
    await sleep(2500);
    const bad = await p.evaluate(() => {
      const W = innerWidth, out = [];
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.width < 10 || r.top > innerHeight || (r.right <= W + 1 && r.left >= -1)) continue;
        if (el.closest(".os1-dock")) continue; // the dock scrolls sideways on purpose
        const par = el.parentElement?.getBoundingClientRect();
        if (par && (par.right > W + 1 || par.left < -1)) continue; // report the outermost only
        out.push(`${el.tagName.toLowerCase()} "${(el.textContent || "").trim().slice(0, 40)}" (${Math.round(r.left)}–${Math.round(r.right)}px)`);
      }
      return out.slice(0, 5);
    });
    const blank = await p.evaluate(() => document.body.innerText.trim().length < 5);
    if (bad.length || blank) failures++;
    console.log(`${bad.length || blank ? "FAIL" : "ok  "} ${s}${blank ? " — blank screen" : ""}${bad.length ? `\n       ${bad.join("\n       ")}` : ""}`);
  }
} finally {
  await go("conversation").catch(() => undefined);
  await b.close();
}
process.exit(failures ? 1 : 0);
