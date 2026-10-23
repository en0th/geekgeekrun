import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const mobileRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const output = path.resolve(
  process.env.MOBILE_REPORT_DIR ||
    path.join(mobileRoot, "../..", ".ci-reports/mobile"),
);
await mkdir(output, { recursive: true });
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const server = createServer(async (req, res) => {
  try {
    const filename = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    const target = path.resolve(
      mobileRoot,
      "dist",
      "." + filename + (filename === "/" ? "index.html" : ""),
    );
    if (!target.startsWith(path.join(mobileRoot, "dist") + path.sep))
      throw new Error();
    res.setHeader(
      "Content-Type",
      mime[path.extname(target)] || "application/octet-stream",
    );
    res.end(await readFile(target));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const candidates = [
  process.env.CHROME_EXECUTABLE_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
].filter(Boolean);
const executablePath = candidates.find((candidate) => existsSync(candidate));
if (!executablePath) {
  server.close();
  throw new Error("Set CHROME_EXECUTABLE_PATH to run the browser smoke test");
}
const browser = await puppeteer.launch({
  headless: true,
  executablePath,
  args: process.env.CI ? ["--no-sandbox"] : [],
});
const page = await browser.newPage();
const errors = [],
  external = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("request", (request) => {
  if (!request.url().startsWith(origin) && !request.url().startsWith("data:"))
    external.push(request.url());
});
try {
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto(origin, { waitUntil: "networkidle0" });
  await page.waitForSelector(".hero");
  assert.equal(await page.title(), "牛人快跑");
  await page.screenshot({ path: path.join(output, "01-assistant.png") });
  await page.click(".suggestions button");
  await page.waitForFunction(() =>
    document.querySelector(".ai-feed").textContent.includes("虚构数据"),
  );
  await page.click("nav button:nth-child(2)");
  await page.waitForSelector(".job-card");
  assert.equal((await page.$$(".job-card")).length, 3);
  await page.screenshot({ path: path.join(output, "02-jobs.png") });
  await page.click(".job-card");
  await page.waitForSelector(".job-detail");
  await page.click(".job-detail>.primary");
  await page.waitForSelector(".confirm-panel");
  await page.click(".confirm-panel .primary");
  await page.waitForFunction(
    () => document.querySelectorAll(".job-card").length === 2,
  );
  assert.match(
    await page.$eval(".notice", (node) => node.textContent),
    /没有向外部服务发送请求/,
  );
  await page.click("nav button:nth-child(3)");
  await page.click(".contact-card");
  await page.waitForSelector(".chat-composer input");
  await page.type(".chat-composer input", "你好，我想了解这个岗位。");
  await page.click(".chat-composer .send-button");
  await page.waitForFunction(() =>
    document.querySelector("main").textContent.includes("体验消息"),
  );
  await page.screenshot({ path: path.join(output, "03-chat.png") });
  await page.click('button[aria-label="返回会话列表"]');
  await page.click("nav button:nth-child(4)");
  await page.waitForSelector(".profile");
  await page.screenshot({ path: path.join(output, "04-account.png") });
  for (const width of [320, 430, 768]) {
    await page.setViewport({ width, height: 844, deviceScaleFactor: 1 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `horizontal overflow at ${width}`,
    );
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(
      path.join(output, "smoke.json"),
      JSON.stringify(
        {
          status: "passed",
          flows: [
            "demo AI",
            "pending job details",
            "explicit confirmation",
            "demo BOSS chat",
            "account",
            "responsive layout",
          ],
          externalRequests: external.length,
          consoleErrors: errors,
          widths: [320, 390, 430, 768],
        },
        null,
        2,
      ) + "\n",
    ),
  );
  console.log(
    "Mobile browser smoke passed: AI → pending confirmation → chat; no external requests.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
