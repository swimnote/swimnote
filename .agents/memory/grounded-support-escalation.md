---
name: Grounded support escalation
description: Rules for the customer-support transition from deterministic help to GPT and human review.
---

Support escalation must remain a user-controlled, evidence-bounded sequence:

1. Deterministic support answers may run first.
2. Only a same-conversation, same-topic three-turn streak may offer the explicit second-stage GPT action.
3. The second-stage GPT may receive only the current-case excerpt and server-verified evidence. Evidence must be active and role/mode/pool scoped; Known Issue evidence additionally requires an active linked incident.
4. No evidence means no GPT call and an evidence-insufficient response rather than a fabricated answer.
5. A Human Case and Super Admin notification are permitted only after that GPT response and an explicit unresolved confirmation. A resolved confirmation must not create a ticket or alert.
6. Every second-stage GPT trace must retain only the verified evidence IDs, their revisions, and the retrieval scope alongside the role and mode. It must never retain raw conversation or evidence content.

**Why:** Automatic no-match GPT and direct-human paths can invent unsupported product guidance, create duplicate operations, and notify staff before the user has confirmed the automated path did not solve the issue.

**How to apply:** Keep repeat metadata case-local and raw-message-free. Store an optional callback number only when a user directly enters it and consents within that Case; never copy it into learning data, knowledge, traces, or push content. Audit retrieval through identifier/revision metadata rather than message text.