// Explicitly approved isolated acceptance only. No operating API/DB import.
import OpenAI from "../../artifacts/api-server/node_modules/openai/index.mjs";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AsyncLocalStorage } from "node:async_hooks";
import { completeOfficeModel, officeModelMessages } from "../../artifacts/api-server/src/lib/office-model.js";
import { OfficeError } from "../../artifacts/api-server/src/lib/office-command.js";
export const context = new AsyncLocalStorage<{ actor: string; caseId: string }>();
const out = fileURLToPath(new URL("../../generated-artifacts/office-stage3-real-ai/", import.meta.url));
mkdirSync(out, { recursive: true });
const ledger = out + "model-attempts.jsonl";
const records = () => existsSync(ledger) ? readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean).map(s => JSON.parse(s)) : [];
const save = (record: unknown) => appendFileSync(ledger, JSON.stringify(record) + "\n", { mode: 0o600 });
export async function approvedModel() {
  if (!process.argv.includes("--real-ai-approved")) throw new Error("Explicit real AI approval required");
  if (!process.env.OPENAI_API_KEY) throw new Error("Existing OPENAI_API_KEY missing");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 12000,
    baseURL: "https://api.openai.com/v1" });
  // Free model metadata check, not a completion. Do not print headers, keys, error objects or owner identifiers.
  try {
    const model = await client.models.retrieve("gpt-4o-mini");
    if (model.id !== "gpt-4o-mini") throw new Error("Unexpected model");
    writeFileSync(out + "preflight.json", JSON.stringify({ at: new Date().toISOString(), model: model.id,
      metadataAccess: true, officialSource: "https://developers.openai.com/api/docs/models/gpt-4o-mini.md",
      inputUSDPerMillion: .15, outputUSDPerMillion: .60, worstCase24CallsUSD: .0221184,
      note: "Model metadata availability is not proof of sufficient billing quota" }, null, 2));
  } catch { throw new Error("Model metadata access unavailable; no inference attempted"); }
  return async (input: { text: string; memberId?: string }) => {
    officeModelMessages(input); // Limit before reserving a paid attempt.
    const evidence = records();
    if (evidence.some(r => r.event === "failure" && r.code === "USAGE_LIMIT"))
      throw new OfficeError(429, "SESSION_STOP", "Unexpected prior usage stopped this approval session");
    const previous = evidence.filter(r => r.event === "attempt");
    const owner = context.getStore();
    if (!owner) throw new OfficeError(403, "FIXTURE_CONTEXT", "Synthetic model context required");
    if (previous.length >= 24) throw new OfficeError(429, "SESSION_CAP", "24 SDK attempts exhausted");
    if (previous.filter(r => r.actor === owner.actor && Date.now() - r.atMs < 600000).length >= 6)
      throw new OfficeError(429, "ACTOR_CAP", "6 attempts/actor/10min");
    const seq = previous.length + 1;
    save({ event: "attempt", seq, atMs: Date.now(), ...owner, input });
    try {
      const result = await completeOfficeModel(client, "gpt-4o-mini", input, response => {
        save({ event: "response", seq, model: response.model, usage: response.usage,
          finish: response.choices[0]?.finish_reason, raw: response.choices[0]?.message.content });
        if (!response.usage || response.usage.prompt_tokens > 4096 || response.usage.completion_tokens > 512)
          throw new OfficeError(502, "USAGE_LIMIT", "Unexpected usage; stop approval session");
      });
      save({ event: "parsed", seq, result });
      return result;
    } catch (e: any) {
      save({ event: "failure", seq, code: e.code ?? e.name ?? "MODEL_FAILURE", status: e.status ?? 0 });
      throw new OfficeError(502, "MODEL_FAILURE", "모델 해석 실패. 자동 재시도하지 않습니다.");
    }
  };
}
