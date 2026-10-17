import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { ROOT } from "../common.mjs";

export async function buildNormal(root = ROOT, output, runtimeRoot = root) {
  let require = createRequire(path.join(root, "package.json"));
  try { require.resolve("esbuild"); } catch { require = createRequire(path.join(root, "artifacts/api-server/package.json")); }
  const esbuild = require("esbuild");
  const out = output ?? path.join(root, "build-evidence");
  fs.mkdirSync(out, { recursive: true });
  const forbidden = new Set(["auto-link-v2", "parent-approval-hooks", "member-limit", "sendSms", "parent-phone-proof", "defaultTemplates", "subscriptionService"]);
  const disabledDynamic = { opsAlerts: ["createOpsAlert"], notify: ["notifySuperAdmin"],
    "analytics-logger": ["logAnalyticsEvent"], "push-service": ["sendPushToPoolAdmins"] };
  const seams = [];
  const plugin = {
    name: "isolated-db-and-external-side-effects",
    setup(build) {
      build.onResolve({ filter: /^@workspace\/db(?:\/schema)?$/ }, args => ({
        path: path.join(root, "scripts/office-stage3/windows/normal", args.path.endsWith("/schema") ? "schema.ts" : "database.ts"),
      }));
      build.onResolve({ filter: /(?:pg-realtime|\/ai)\.js$/ }, args => {
        if (!args.importer.includes("artifacts/api-server/src/")) return;
        seams.push({ importer: path.relative(root, args.importer), dependency: args.path, mode: "local replay/notification sink" });
        return { path: path.join(root, "scripts/office-stage3/windows/normal/model.ts") };
      });
      build.onResolve({ filter: /.*/ }, args => {
        const name = path.basename(args.path).replace(/\.js$/, "");
        if (disabledDynamic[name] && args.importer.includes("artifacts/api-server/src/")) {
          seams.push({ importer: path.relative(root, args.importer), dependency: args.path, mode: "external side effect denied, unreachable route" });
          return { path: JSON.stringify(disabledDynamic[name]), namespace: "denied-side-effect" };
        }
        if (!forbidden.has(name) && args.path !== "@replit/object-storage") return;
        if (!args.importer.includes("artifacts/api-server/src/")) return;
        const source = fs.readFileSync(args.importer, "utf8");
        const imports = [...source.matchAll(/import\s+([^;]+?)\s+from\s+["']([^"']+)["'];/g)];
        const clause = imports.find(match => match[2] === args.path)?.[1];
        if (!clause || !clause.trim().startsWith("{")) throw new Error("Unreviewed side-effect import: " + args.path);
        const names = clause.replace(/[{}]/g, "").split(",").map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean);
        seams.push({ importer: path.relative(root, args.importer), dependency: args.path, exports: names, mode: "throws if used; route denied before handler" });
        return { path: JSON.stringify(names), namespace: "denied-side-effect" };
      });
      build.onLoad({ filter: /.*/, namespace: "denied-side-effect" }, args => ({
        contents: JSON.parse(args.path).map(name =>
          `export function ${name}(){throw new Error("External/unsupported branch prohibited in isolation");}`).join("\n"),
      }));
    },
  };
  const reports = {};
  for (const name of ["entry", "seed", "writer"]) {
    const result = await esbuild.build({
      entryPoints: [path.join(root, "scripts/office-stage3/windows/normal", name + ".ts")],
      outfile: path.join(out, "normal-" + name + ".mjs"),
      bundle: true, platform: "node", target: "node24", format: "esm", packages: "external",
      define: { __ISOLATED_ROOT__: JSON.stringify(runtimeRoot) }, plugins: [plugin],
      banner: { js: 'import {createRequire as isolatedRequire} from "node:module"; const require=isolatedRequire(import.meta.url);' },
      metafile: true, logLevel: "silent",
    });
    if (Object.keys(result.metafile.inputs).some(file => /lib\/db\/src\/index|src\/app\.ts|src\/index\.ts|routes\/ai\.ts|growth-report-monthly|lib\/push-service|utils\/notify/.test(file)))
      throw new Error("Operating bootstrap/SDK imported");
    reports[name] = result.metafile;
  }
  fs.writeFileSync(path.join(out, "normal-build-inputs.json"), JSON.stringify({ reports, seams }, null, 2), { flag: "wx" });
}
