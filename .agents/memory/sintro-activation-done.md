---
name: SINTRO ki_swimnote_intro Activation + scoreText Korean Stemming
description: ki_swimnote_intro PENDING→ACTIVE approval, scoreText stemKorean fix, SINTRO 41 tests. SHA bcc87891.
---

## What happened
ki_swimnote_intro was PENDING. Score for "스윔노트 알려줘" was 55 < 60 (HIGH_CONFIDENCE) — NOT a deterministic hit.

## Root cause
Korean particles attach to tokens: "스윔노트가" ≠ "스윔노트" in exact token comparison.
The scoreText token overlap check returned 55 (below 60 threshold).

## Fix
Added `stemKorean(token)` function that strips common Korean particles (가/이/는/은/를/을/에/에서/에게/이나/으로/도/만/나/와/과) from token end.

Updated `scoreText §2`:
- Uses `qStems = tokens.map(stemKorean)`, `tStems = titleTokens.map(stemKorean)`
- If `titleOverlap / qStems.length >= 0.5` → return 65 (was 55)
- Else if `totalOverlap / qStems.length >= 0.5` → return 55

**Why:** Title-exclusive overlap (e.g. "스윔노트" in "스윔노트 소개") is a strong signal. Returning 65 (≥60 threshold) enables deterministic hit.

## Verified scores (post-fix)
- "스윔노트 알려줘" vs ki_swimnote_intro = 65 ✅
- "스윔노트가 뭐야" vs ki_swimnote_intro = 65 ✅  
- "스윔노트 설명해줘" vs ki_swimnote_intro = 65 ✅
- "SWIMNOTE가 뭐야" vs ki_swimnote_intro = 0 (known limitation: no cross-lang synonym)
- "스윔노트X에 대해 알려줘" vs ki_swimnote_intro = 0 ✅ (no bleed)
- "스윔노트X에 대해 알려줘" vs ki_x_mode_intro = 90 ✅ (unchanged)

## Knowledge approval
- PATCH /super/support/knowledge/ki_swimnote_intro/approve → 200 { ok:true, status:'active' }
- reviewed_by = sa_system, reviewed_at = 2026-08-18T07:30:03Z, revision = 2
- SQL direct UPDATE: FORBIDDEN (used API only)

## Commit SHA
bcc87891 (deploy-photo-clone branch)

## Tests
41/41 SINTRO + 1907/1907 full suite
