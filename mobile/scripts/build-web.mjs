import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const mobileDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoDir = resolve(mobileDir, "..");
const webDir = resolve(mobileDir, "www");

// Package the dedicated /hub/ page as the Android app's launch screen.
// Its shared app.js, styles.css, config, and image assets remain at the web root.
for (const name of ["app.js", "app-config.js", "styles.css"]) {
  await cp(resolve(repoDir, name), resolve(webDir, name));
}
await cp(resolve(repoDir, "hub/index.html"), resolve(webDir, "index.html"));
await cp(resolve(repoDir, "icons"), resolve(webDir, "icons"), { recursive: true });
await cp(resolve(repoDir, "spirit-wordmark.png"), resolve(webDir, "spirit-wordmark.png"));

const androidRes = resolve(mobileDir, "android/app/src/main/res");
for (const density of ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]) {
  const mipmapDir = resolve(androidRes, `mipmap-${density}`);
  await mkdir(mipmapDir, { recursive: true });
  await cp(resolve(repoDir, "icons/icon-192.png"), resolve(mipmapDir, "ic_launcher.png"));
  await cp(resolve(repoDir, "icons/icon-192.png"), resolve(mipmapDir, "ic_launcher_round.png"));
  await cp(resolve(repoDir, "icons/icon-512-maskable.png"), resolve(mipmapDir, "ic_launcher_foreground.png"));
}
for (const density of ["drawable", "drawable-land-hdpi", "drawable-land-mdpi", "drawable-land-xhdpi", "drawable-land-xxhdpi", "drawable-land-xxxhdpi", "drawable-port-hdpi", "drawable-port-mdpi", "drawable-port-xhdpi", "drawable-port-xxhdpi", "drawable-port-xxxhdpi"]) {
  const drawableDir = resolve(androidRes, density);
  await mkdir(drawableDir, { recursive: true });
  await cp(resolve(repoDir, "icons/icon-512.png"), resolve(drawableDir, "splash.png"));
}

const htmlPath = resolve(webDir, "index.html");
let html = await readFile(htmlPath, "utf8");
html = html
  .replaceAll("/Spirit/", "./")
  .replace(/^[ \\t]*<link rel="manifest" href="\\.\\/manifest\\.json">[ \\t]*\\r?\\n/m, "");
await writeFile(htmlPath, html, "utf8");

await build({
  entryPoints: [resolve(mobileDir, "native-runtime-entry.js")],
  outfile: resolve(webDir, "native-runtime.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
});

console.log("Prepared the SpiritHUB /hub/ experience and native Capacitor plugins.");
