import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { ROOT, verifyCandidate, sha, cleanEnv } from "./common.mjs";

export async function buildCandidate(root = ROOT) {
  const manifest = verifyCandidate(root);
  const out = path.join(root, "build-evidence");
  if (fs.existsSync(out)) throw new Error("Build output exists; preserve it, use a fresh candidate extraction");
  fs.mkdirSync(out);
  const require = createRequire(path.join(root, "package.json"));
  const esbuild = require("esbuild");
  const dashboard = path.join(root, "artifacts/swimnote-dashboard");
  const metadata = {};
  try {
    for (const name of ["main", "preload", "security", "session-ipc", "token-store"]) {
      const result = await esbuild.build({
        entryPoints: [path.join(dashboard, "desktop", name + ".cts")], platform: "node",
        target: "node22", format: "cjs", outfile: path.join(out, "app/desktop", name + ".cjs"),
        bundle: false, metafile: true, logLevel: "silent",
      });
      metadata[name] = result.metafile;
    }
    const api = await esbuild.build({
      entryPoints: [path.join(root, "scripts/office-stage3/windows/api.ts")],
      platform: "node", target: "node24", format: "esm", bundle: true, packages: "external",
      outfile: path.join(out, "isolated-api.mjs"), metafile: true, logLevel: "silent",
    });
    metadata.api = api.metafile;
    const inputs = Object.keys(api.metafile.inputs);
    if (inputs.some(name => /(?:\/routes\/|\/db\/|\/app\.ts$|\/index\.ts$|real-ai|isolated-api\.ts$)/.test(name)))
      throw new Error("Operating/fixture bootstrap leaked into API build");
    // Preserve directory-relative common.mjs ROOT semantics in the bundled entrypoint.
    fs.copyFileSync(path.join(root, "scripts/office-stage3/windows/common.mjs"), path.join(out, "common.mjs"));
    const vite = path.join(path.dirname(require.resolve("vite/package.json")), "bin/vite.js");
    const result = spawnSync(process.execPath, [vite, "build", "--config", path.join(dashboard, "vite.desktop.config.ts")],
      { cwd: root, env: cleanEnv(), encoding: "utf8" });
    fs.writeFileSync(path.join(out, "renderer-build.log"), (result.stdout ?? "") + (result.stderr ?? ""));
    if (result.status !== 0) throw new Error("Renderer build failed; preserved build log");
    const walk = folder => fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory() ? walk(path.join(folder, entry.name)) : [path.join(folder, entry.name)]);
    const appFiles = walk(path.join(out, "app"));
    const text = appFiles.filter(file => /\.(?:js|cjs|html)$/.test(file)).map(file => fs.readFileSync(file, "utf8")).join("\n");
    if (/fixture_admin|fixture-session|fixtureAuth|http:\/\/127\.0\.0\.1:20412/.test(text))
      throw new Error("Fixture leakage into verification Desktop");
    if (!text.includes("http://127.0.0.1:20411") || text.includes("connect-src https://swimnote-api.onrender.com"))
      throw new Error("Verification origin/CSP mismatch");
    fs.writeFileSync(path.join(out, "input-metafile.json"), JSON.stringify(metadata, null, 2), { flag: "wx" });
    const files = walk(out).filter(file => !file.endsWith("build-manifest.json")).sort().map(file => ({
      path: path.relative(root, file).replaceAll("\\", "/"), sha256: sha(fs.readFileSync(file)),
    }));
    fs.writeFileSync(path.join(out, "build-manifest.json"), JSON.stringify({
      candidateId: manifest.candidateId, platform: process.platform, node: process.version,
      scope: "Cross-platform compilation only; NOT Windows/DPAPI/login acceptance",
      commands: ["esbuild main/preload/security/session-ipc/token-store .cts -> separate app/desktop",
        "esbuild isolated tool API, packages external", "vite build --config artifacts/swimnote-dashboard/vite.desktop.config.ts"],
      files,
    }, null, 2), { flag: "wx" });
    return out;
  } catch (error) {
    fs.writeFileSync(path.join(out, "FAILED.txt"), String(error), { flag: "wx" });
    throw error;
  }
}
if (process.argv[1] === import.meta.filename) await buildCandidate();
