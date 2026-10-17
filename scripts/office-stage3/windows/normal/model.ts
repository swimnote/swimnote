import fs from "node:fs";
import path from "node:path";
import { candidateRoot } from "./database.js";
export function getOpenAI() {
  return { chat: { completions: { create: async (request: any) => {
    const input = JSON.parse(request.messages.at(-1).content);
    const records = JSON.parse(fs.readFileSync(path.join(candidateRoot, "replay-records.json"), "utf8"));
    const found = records.find((record: any) => record.input.text === input.text && record.input.memberId === input.memberId);
    if (!found) throw new Error("Unrecorded input; no SDK or paid fallback");
    return { choices: [{ message: { content: found.raw }, finish_reason: "stop" }] };
  } } } };
}
export async function notifyPoolEvent() { /* Local acceptance: no SSE/provider dispatch. Requery is authoritative. */ }
