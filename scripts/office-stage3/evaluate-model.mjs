import { readFile, appendFile, mkdir } from "node:fs/promises";
import { cases } from "./model-cases.mjs";
const out = new URL("../../generated-artifacts/office-stage3-real-ai/", import.meta.url);
await mkdir(out, { recursive: true });
const session = JSON.parse(await readFile(new URL("../../generated-artifacts/office-stage3-isolated/fixture-session.json", import.meta.url), "utf8"));
const tokens = Object.values(session.evalTokens);
const results = new URL("case-results.jsonl", out);
// Do not retry an existing evaluation run or silently replace first evidence.
try { if ((await readFile(results, "utf8")).trim()) throw new Error("Evaluation evidence already exists; refuse repeat"); }
catch (e) { if (e.code !== "ENOENT") throw e; }
for (let round = 0; round < 2; round++) for (let i = 0; i < cases.length; i++) {
  const c = cases[i], label = `${c.id}-r${round + 1}`;
  const response = await fetch("http://127.0.0.1:20411/api/office/interpret", {
    method: "POST", headers: { authorization: "Bearer " + tokens[Math.floor((round * 12 + i) / 6)],
      "content-type": "application/json", "x-fixture-case": label }, body: JSON.stringify(c.body) });
  const result = await response.json();
  const blocked = response.status >= 400 && ["INPUT", "CLARIFICATION", "MODEL_OUTPUT"].includes(result.code);
  const pass = response.status === 200 && result.kind === c.expect || c.expect === "clarify" && blocked;
  await appendFile(results, JSON.stringify({ id: c.id, round: round + 1, expect: c.expect, status: response.status,
    result, pass, sdkObservedSeparately: true }) + "\n");
  console.log(label, response.status, result.kind ?? result.code, pass ? "PASS" : "FAIL");
  if (response.status === 502 && result.code === "MODEL_FAILURE") {
    console.log("STOP: SDK failure; no automatic repeated request"); process.exit(1);
  }
}
