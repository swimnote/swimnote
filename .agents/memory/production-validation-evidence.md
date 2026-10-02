---
name: Production validation evidence
description: Preserve reproducible read-only baseline methods before deployment.
---

Production safety fingerprints must retain their exact query scope, row ordering, and serialization method alongside the hash, without retaining sensitive row contents.

**Why:** A hash alone cannot establish unchanged data after context loss. Eligible reports and all monthly reports are different scopes, and PostgreSQL JSON serialization differs from driver-parsed rows. Matching aggregate counts is not proof of matching full rows.

**How to apply:** Before a production change, save a reusable read-only verification script and non-sensitive hash metadata. Reuse that exact script afterward. Report aggregate preservation and full-row fingerprint equality as separate checks; never label an inconclusive fingerprint check PASS.