import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./common.mjs";

/** Recorded transport only: exact input match, no SDK, HTTP client or fallback. */
export function replayModel(root = ROOT) {
  const cases = JSON.parse(fs.readFileSync(path.join(root, "replay-records.json"), "utf8"));
  return async input => {
    const found = cases.find(row => row.input.text === input.text &&
      row.input.memberId === input.memberId && Object.keys(input).every(k => ["text", "memberId"].includes(k)));
    if (!found) throw new Error("No exact recorded response; paid fallback prohibited");
    return JSON.parse(found.raw);
  };
}
