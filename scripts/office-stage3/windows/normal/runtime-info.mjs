import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { ROOT, cleanEnv, run } from "../common.mjs";
if (process.platform !== "win32") throw new Error("Windows runtime observation only; NOT RUN on Linux");
const require = createRequire(path.join(ROOT,"package.json"));
const electron = path.join(ROOT,"node_modules/electron/dist/electron.exe");
if (!fs.existsSync(electron)) throw new Error("Prepare pinned Electron binary manually first");
console.log(JSON.stringify({ hostNode: process.version,
  requiredHostNode: ">=24.13.0 <25",
  packageElectron: require("electron/package.json").version,
  embedded: JSON.parse(run(electron, ["-e","console.log(JSON.stringify(process.versions))"],
    { env: { ...cleanEnv(), ELECTRON_RUN_AS_NODE: "1" } })) }, null, 2));
