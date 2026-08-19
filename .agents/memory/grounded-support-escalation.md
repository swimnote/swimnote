---
name: Grounded support escalation
description: Rules for the customer-support transition from deterministic help to GPT and human review.
---

Support escalation must remain a user-controlled, evidence-bounded sequence:

1. Deterministic support answers may run first.
2. Only a same-conversation, same-topic three-turn streak may offer the explicit second-stage GPT action.
3. The second-stage GPT may receive only the current-case excerpt and server-verified evidence. Evidence must be active and role/mode/pool scoped; Known Issue evidence additionally requires an active linked incident.
4. GPT may use grounded reasoning to turn verified Knowledge into a short natural counselor response. Its structured output must cite only retrieved Knowledge IDs; the server validates every ID, blocks repeats, and applies high-risk policy/price/privacy/UI guards before showing the prose.
5. No evidence, an unknown citation, a repeated instruction, unsupported high-risk claim, or invalid counselor output means an evidence-insufficient response rather than a fabricated answer.
6. A Human Case and Super Admin notification are permitted only after that GPT response and an explicit unresolved confirmation. A resolved confirmation must not create a ticket or alert.
7. Human escalation must atomically claim an unresolved Case. Only the winner may create a ticket or notify Super Admins; a concurrent resolve must prevent the claim, and ticket creation failure must release it.
8. Every second-stage GPT trace must retain only the verified evidence IDs, their revisions, and the retrieval scope alongside the role and mode. It must never retain raw conversation or evidence content.

**Why:** Automatic no-match GPT and direct-human paths can invent unsupported product guidance, create duplicate operations, and notify staff before the user has confirmed the automated path did not solve the issue.

**How to apply:** Keep repeat metadata case-local and raw-message-free. Pass a bounded, redacted Case excerpt and structured active Knowledge to GPT; require `answer` plus a subset of allowed `used_knowledge_ids`, never a free-form uncited answer. Use compare-and-swap conditions for resolved-vs-unresolved state changes and duplicate Human requests; bind agent state transition plus reply insert in one transaction, then push only after commit. Store an optional callback number only when a user directly enters it and consents within that Case; never copy it into learning data, knowledge, traces, or push content. Audit retrieval through identifier/revision metadata rather than message text.