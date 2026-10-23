import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "public/icon.svg"), "utf8");
const executablePath = [
  process.env.CHROME_EXECUTABLE_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
]
  .filter(Boolean)
  .find(existsSync);
if (!executablePath) throw new Error("Set CHROME_EXECUTABLE_PATH");
const browser = await puppeteer.launch({ headless: true, executablePath });
const page = await browser.newPage();
async function render(svg, size, target) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace("<svg ", '<svg width="100%" height="100%" ')}</body></html>`,
  );
  await page.screenshot({
    path: path.join(root, target),
    omitBackground: true,
  });
}
try {
  await render(
    source,
    1024,
    "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
  );
  const foreground =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><g transform="translate(205 205) scale(.6)"><path d="M302 722 722 302M355 302h367v367" fill="none" stroke="#d3edb2" stroke-width="92" stroke-linecap="round" stroke-linejoin="round"/></g></svg>';
  for (const [density, scale] of [
    ["mdpi", 1],
    ["hdpi", 1.5],
    ["xhdpi", 2],
    ["xxhdpi", 3],
    ["xxxhdpi", 4],
  ]) {
    const dir = `android/app/src/main/res/mipmap-${density}/`;
    await render(source, 48 * scale, dir + "ic_launcher.png");
    await render(source, 48 * scale, dir + "ic_launcher_round.png");
    await render(foreground, 108 * scale, dir + "ic_launcher_foreground.png");
  }
  await writeFile(
    path.join(
      root,
      "android/app/src/main/res/values/ic_launcher_background.xml",
    ),
    '<?xml version="1.0" encoding="utf-8"?><resources><color name="ic_launcher_background">#17665f</color></resources>\n',
  );
} finally {
  await browser.close();
}
console.log("Generated native icons from public/icon.svg");
