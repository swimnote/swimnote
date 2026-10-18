---
name: Production validation evidence
description: Preserve reproducible read-only baseline methods before deployment.
---

Production safety fingerprints must retain their exact query scope, row ordering, and serialization method alongside the hash, without retaining sensitive row contents.

**Why:** A hash alone cannot establish unchanged data after context loss. Eligible reports and all monthly reports are different scopes, and PostgreSQL JSON serialization differs from driver-parsed rows. Matching aggregate counts is not proof of matching full rows.

**How to apply:** Before a production change, save a reusable read-only verification script and non-sensitive hash metadata. Reuse that exact script afterward. Report aggregate preservation and full-row fingerprint equality as separate checks; never label an inconclusive fingerprint check PASS.

For monthly automation, verify publication and parent-notification absence against the sealed eligible cohort, not the pool's entire historical notification feed.

**Why:** A cycle can retain reports outside its current sealed cohort, and the pool feed retains earlier manual sends. Historical parent notifications do not establish automatic publication of the current targets.

**How to apply:** Preserve historical rows. Report zero current-target publication/notification separately from historical totals, and join notification report identities back to the sealed targets when establishing the current boundary.

## Readiness evidence is time-bound

A pre-issue readiness PASS is a snapshot, not a guarantee of readiness or device delivery at the issue deadline. Recheck lifecycle changes within the sealed cohort before attributing a missing PUSH to its provider.

**Why:** In production, post-seal withdrawals removed previously completed, unpublished reports; subsequent preparation recreated unresolved rows and the READY gate correctly remained closed.

**How to apply:** Trace the specific cohort's withdrawal, missing-row and recreation evidence without rerunning analysis or repairing data during diagnosis. Distinguish today's cycle-preparation log from today's readiness execution. A registered cron and an old deduplicated incident do not prove a particular day's reconciliation ran; report that evidence gap explicitly.

## Compilation is not production SQL compatibility

Before applying manual operational migrations, validate new raw SQL against actual production column types in a read-only transaction. Use EXPLAIN without ANALYZE when planning alone can establish compatibility. Do not convert existing column types merely to accommodate new code.

**Why:** TypeScript and pure-domain tests can pass while PostgreSQL rejects a comparison during planning, even with no matching business rows. Additive new tables do not repair incompatible queries over legacy tables, and installed clients depend on the existing data contract.

**How to apply:** Hold migrations and deployment on a failed compatibility gate. Keep the approved source identity fixed, preserve the existing server version, and establish a recoverable pre-change backup before resuming. Report source compilation, SQL planning, backup recoverability, and post-deploy behavior as separate evidence.