import { readFile, appendFile } from "node:fs/promises";
import { cases } from "./model-cases.mjs";
const session = JSON.parse(await readFile(new URL("../../generated-artifacts/office-stage3-isolated/fixture-session.json", import.meta.url), "utf8"));
const out = new URL("../../generated-artifacts/office-stage3-real-ai/focused-results.jsonl", import.meta.url);
try { if ((await readFile(out, "utf8")).trim()) throw new Error("Focused evidence already exists"); }
catch (e) { if (e.code !== "ENOENT") throw e; }
for (const check of [
  { id: "move", suffix: "fix-r1", endpoint: "/api/office/interpret" },
  { id: "move", suffix: "fix-r2", endpoint: "/api/office/interpret" },
  { id: "guardian-auth", suffix: "raw-fix", endpoint: "/fixture/model-probe" },
  { id: "compound", suffix: "raw-first", endpoint: "/fixture/model-probe" },
]) {
  const body = cases.find(c => c.id === check.id).body;
  const response = await fetch("http://127.0.0.1:20411" + check.endpoint, { method: "POST",
    headers: { authorization: "Bearer " + session.probeToken, "content-type": "application/json",
      "x-fixture-case": `${check.id}-${check.suffix}` }, body: JSON.stringify(body) });
  const result = await response.json();
  await appendFile(out, JSON.stringify({ ...check, status: response.status, result }) + "\n");
  console.log(check.id, check.suffix, response.status, result.kind, result.raw?.kind ?? "");
  if (!response.ok) break;
}
