import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const mobileDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoDir = resolve(mobileDir, "..");
const webDir = resolve(mobileDir, "www");

await rm(webDir, { recursive: true, force: true });
await mkdir(webDir, { recursive: true });
for (const name of ["index.html", "app.js", "app.css", "premium.css", "ai.js", "backup.js", "spirit-ai.js", "config.js"]) {
  await cp(resolve(repoDir, name), resolve(webDir, name));
}
await cp(resolve(mobileDir, "mobile-native.css"), resolve(webDir, "mobile-native.css"));
await cp(resolve(repoDir, "assets"), resolve(webDir, "assets"), { recursive: true });

const androidRes = resolve(mobileDir, "android/app/src/main/res");
for (const density of ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]) {
  const mipmapDir = resolve(androidRes, "mipmap-" + density);
  await mkdir(mipmapDir, { recursive: true });
  await cp(resolve(repoDir, "assets/icons/icon-192.png"), resolve(mipmapDir, "ic_launcher.png"));
  await cp(resolve(repoDir, "assets/icons/icon-192.png"), resolve(mipmapDir, "ic_launcher_round.png"));
  await cp(resolve(repoDir, "assets/icons/icon-512-maskable.png"), resolve(mipmapDir, "ic_launcher_foreground.png"));
}
for (const density of ["drawable", "drawable-land-hdpi", "drawable-land-mdpi", "drawable-land-xhdpi", "drawable-land-xxhdpi", "drawable-land-xxxhdpi", "drawable-port-hdpi", "drawable-port-mdpi", "drawable-port-xhdpi", "drawable-port-xxhdpi", "drawable-port-xxxhdpi"]) {
  const drawableDir = resolve(androidRes, density);
  await mkdir(drawableDir, { recursive: true });
  await cp(resolve(repoDir, "assets/icons/icon-512.png"), resolve(drawableDir, "splash.png"));
}

const htmlPath = resolve(webDir, "index.html");
let html = await readFile(htmlPath, "utf8");
if (!html.includes("<title>Spirited Workspace</title>") || !html.includes('src="app.js?')) {
  throw new Error("The Android package must be built from Spirited Workspace at the repository root.");
}
html = html
  .replace('<link rel="manifest" href="./manifest.json">', "")
  .replaceAll("20261101-profile-settings-2", "android-native-1");
html = html.replace("</head>", '  <link rel="stylesheet" href="mobile-native.css">\\n</head>');
await writeFile(htmlPath, html, "utf8");

await build({
  entryPoints: [resolve(mobileDir, "native-runtime-entry.js")],
  outfile: resolve(webDir, "native-runtime.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
});

console.log("Prepared Spirited Workspace at the repository root for Android.");
