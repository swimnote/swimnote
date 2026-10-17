// Reuse the real API build's allowlist/options, but NEVER delete/rewrite tracked dist.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../.."), api = path.join(root, "artifacts/api-server");
const requireApi = createRequire(path.join(api, "package.json"));
const build = fs.readFileSync(path.join(api, "build.ts"), "utf8");
const match = build.match(/const allowlist = (\[[\s\S]*?\]);/);
if (!match) throw new Error("Review changed build contract");
const allowlist = vm.runInNewContext(match[1]);
const pkg = JSON.parse(fs.readFileSync(path.join(api, "package.json")));
const external = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]
  .filter(dep => !allowlist.includes(dep) && !pkg.dependencies?.[dep]?.startsWith("workspace:"));
const out = path.join(root, "generated-artifacts/office-stage3-search-recheck/build-evidence");
if (fs.existsSync(out)) throw new Error("Preserve existing build evidence");
fs.mkdirSync(out, { recursive: true });
requireApi("esbuild").build({ entryPoints: [path.join(api, "src/index.ts")], platform: "node",
  bundle: true, format: "esm", outfile: path.join(out, "index.mjs"), define: { "process.env.NODE_ENV": '"production"' },
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  minify: true, external, metafile: true }).then(result => {
    fs.writeFileSync(path.join(out, "metafile.json"), JSON.stringify(result.metafile));
    console.log("API compile PASS; ignored build evidence only; tracked dist unchanged; no server startup");
  }).catch(() => { console.error("API compile failed"); process.exitCode = 1; });
