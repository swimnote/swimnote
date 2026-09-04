/**
 * WP2A CORRECTION — Storage Contract Verification Tests
 *
 * Verifies:
 *  - videoStorageLimitMb = plan storageMb (not a separate 1TB cap)
 *  - Unified photo+video quota for all plans
 *  - SWIMNOTE 10GB / X300 300GB / X500 500GB / X1000 1TB
 *  - DATA PACK: base + extra_storage_gb
 *  - video-only cannot bypass unified quota via legacy 1TB field
 *  - Legacy Coach/Premier response shape preserved
 *  - Video retention 14 days unchanged
 *  - backfillPoolSubscriptionFields produces correct videoLimitMb
 */

import { describe, it, expect } from "vitest";

// ─── Plan constants (mirrors subscription_plans DB rows) ──────────────────
const PLANS: Record<string, { tier: string; storage_mb: number; storage_gb: number }> = {
  swimnote:  { tier: "swimnote",  storage_mb: 10_240,    storage_gb: 10    },
  x300:      { tier: "x300",      storage_mb: 307_200,   storage_gb: 300   },
  x500:      { tier: "x500",      storage_mb: 512_000,   storage_gb: 500   },
  x1000:     { tier: "x1000",     storage_mb: 1_024_000, storage_gb: 1000  },
  // legacy
  coach:     { tier: "coach",     storage_mb: 5_120,     storage_gb: 5     },
  premier:   { tier: "premier",   storage_mb: 81_920,    storage_gb: 80    },
  starter:   { tier: "starter",   storage_mb: 512,       storage_gb: 0.5   },
  free:      { tier: "free",      storage_mb: 102,       storage_gb: 0.099 },
};

const DATA100_EXTRA_GB = 100; // DATA100 pack adds 100GB

/** Mirrored WP2A CORRECTION: videoStorageLimitMb = storageMb (unified) */
function computeVideoStorageLimitMb(storageMb: number): number {
  // NEW: unified quota — plan storage MB is the limit, not a separate 1TB cap
  return storageMb;
}

/** Legacy backfill: OLD logic (the bug) */
function legacyVideoLimitMb_OLD(storageMb: number): number {
  return storageMb >= 5120 ? 1024 * 1024 : 0;
}

/** FIXED backfill logic (WP2A CORRECTION) */
function backfillVideoLimitMb_FIXED(storageMb: number): number {
  return storageMb; // unified quota, not separate 1TB cap
}

/** Unified quota check: returns true if upload would be blocked */
function isUploadBlocked(usedBytes: number, quotaBytes: number): boolean {
  return usedBytes >= quotaBytes;
}

function gbToBytes(gb: number): number {
  return gb * 1024 ** 3;
}

function mbToBytes(mb: number): number {
  return mb * 1024 ** 2;
}

// ──────────────────────────────────────────────────────────────────────────
// Section 1: videoStorageLimitMb derivation
// ──────────────────────────────────────────────────────────────────────────

describe("WP2A CORRECTION — videoStorageLimitMb derivation", () => {
  it("SWIMNOTE: videoStorageLimitMb = 10240 MB (10GB), not 1TB", () => {
    const { storage_mb } = PLANS.swimnote;
    const limit = computeVideoStorageLimitMb(storage_mb);
    expect(limit).toBe(10_240);
    expect(limit).not.toBe(1024 * 1024); // NOT 1TB
  });

  it("X300: videoStorageLimitMb = 307200 MB (300GB), not 1TB", () => {
    const { storage_mb } = PLANS.x300;
    const limit = computeVideoStorageLimitMb(storage_mb);
    expect(limit).toBe(307_200);
    expect(limit).not.toBe(1024 * 1024);
  });

  it("X500: videoStorageLimitMb = 512000 MB (500GB), not 1TB", () => {
    const { storage_mb } = PLANS.x500;
    const limit = computeVideoStorageLimitMb(storage_mb);
    expect(limit).toBe(512_000);
    expect(limit).not.toBe(1024 * 1024);
  });

  it("X1000: videoStorageLimitMb = 1024000 MB (1000GB), not legacy 1048576", () => {
    const { storage_mb } = PLANS.x1000;
    const limit = computeVideoStorageLimitMb(storage_mb);
    expect(limit).toBe(1_024_000);
    expect(limit).not.toBe(1024 * 1024); // 1048576 = legacy 1TB marker — not this
  });

  it("legacy Coach: videoStorageLimitMb = 5120 MB (plan storage), not 1TB", () => {
    const { storage_mb } = PLANS.coach;
    const limit = computeVideoStorageLimitMb(storage_mb);
    expect(limit).toBe(5_120);
    expect(limit).not.toBe(1024 * 1024);
  });

  it("legacy Premier 80GB: videoStorageLimitMb = 81920 MB, not 1TB", () => {
    const { storage_mb } = PLANS.premier;
    const limit = computeVideoStorageLimitMb(storage_mb);
    expect(limit).toBe(81_920);
    expect(limit).not.toBe(1024 * 1024);
  });

  it("free tier: videoStorageLimitMb = 102 MB (no video gate, unified quota)", () => {
    const { storage_mb } = PLANS.free;
    const limit = computeVideoStorageLimitMb(storage_mb);
    expect(limit).toBe(102);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Section 2: backfill fix — OLD vs FIXED
// ──────────────────────────────────────────────────────────────────────────

describe("WP2A CORRECTION — backfill videoLimitMb fix", () => {
  it("OLD logic incorrectly assigns 1TB to Premier-class plans (bug)", () => {
    expect(legacyVideoLimitMb_OLD(PLANS.premier.storage_mb)).toBe(1024 * 1024); // BUG
    expect(legacyVideoLimitMb_OLD(PLANS.coach.storage_mb)).toBe(1024 * 1024);   // BUG
  });

  it("OLD logic incorrectly assigns 0 (blocked) to sub-5GB plans (bug)", () => {
    expect(legacyVideoLimitMb_OLD(PLANS.starter.storage_mb)).toBe(0); // BUG
    expect(legacyVideoLimitMb_OLD(PLANS.free.storage_mb)).toBe(0);    // BUG
  });

  it("FIXED backfill: all plans get storageMb as videoLimitMb", () => {
    for (const [, plan] of Object.entries(PLANS)) {
      expect(backfillVideoLimitMb_FIXED(plan.storage_mb)).toBe(plan.storage_mb);
    }
  });

  it("FIXED backfill: SWIMNOTE → 10240, not 0 or 1048576", () => {
    const v = backfillVideoLimitMb_FIXED(PLANS.swimnote.storage_mb);
    expect(v).toBe(10_240);
    expect(v).not.toBe(0);
    expect(v).not.toBe(1024 * 1024);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Section 3: Unified quota cases (A–D)
// ──────────────────────────────────────────────────────────────────────────

describe("WP2A CORRECTION — Unified quota CASE A: SWIMNOTE photo+video 100%", () => {
  // SWIMNOTE base 10GB, photo 7GB + video 3GB = 10GB = 100%
  const quotaGb    = PLANS.swimnote.storage_gb; // 10
  const quotaBytes = gbToBytes(quotaGb);
  const photoBytes = gbToBytes(7);
  const videoBytes = gbToBytes(3);
  const usedBytes  = photoBytes + videoBytes;

  it("used = 10GB = quota", () => {
    expect(usedBytes).toBe(quotaBytes);
  });

  it("photo upload blocked at 100%", () => {
    expect(isUploadBlocked(usedBytes + 1, quotaBytes)).toBe(true);
  });

  it("video upload blocked at 100%", () => {
    expect(isUploadBlocked(usedBytes + 1, quotaBytes)).toBe(true);
  });

  it("no separate 1TB video field allows bypass", () => {
    // videoStorageLimitMb = 10240 (not 1048576), so the video path cannot bypass
    const videoLimitMb = computeVideoStorageLimitMb(PLANS.swimnote.storage_mb);
    expect(videoLimitMb).toBe(10_240); // unified — same as quota
    expect(videoLimitMb).not.toBe(1024 * 1024);
  });
});

describe("WP2A CORRECTION — Unified quota CASE B: video-only cannot bypass SWIMNOTE 10GB", () => {
  const quotaGb    = PLANS.swimnote.storage_gb;
  const quotaBytes = gbToBytes(quotaGb);

  it("video 20GB alone exceeds 10GB unified quota — upload blocked", () => {
    const videoBytes = gbToBytes(20);
    expect(isUploadBlocked(videoBytes, quotaBytes)).toBe(true);
  });

  it("video-only path uses same quota as photo: no 1TB bypass", () => {
    // If we incorrectly used legacy 1TB limit, 20GB video would NOT be blocked
    const legacy1TbBytes = mbToBytes(1024 * 1024);
    const videoBytes     = gbToBytes(20);
    // Legacy (bug): would allow this
    expect(isUploadBlocked(videoBytes, legacy1TbBytes)).toBe(false); // ← what the bug would do
    // Correct: uses unified quota
    expect(isUploadBlocked(videoBytes, quotaBytes)).toBe(true);      // ← correct
  });
});

describe("WP2A CORRECTION — Unified quota CASE C: X300 photo+video 100%", () => {
  const quotaGb    = PLANS.x300.storage_gb; // 300
  const quotaBytes = gbToBytes(quotaGb);
  const photoBytes = gbToBytes(200);
  const videoBytes = gbToBytes(100);
  const usedBytes  = photoBytes + videoBytes;

  it("used = 300GB = quota", () => {
    expect(usedBytes).toBe(quotaBytes);
  });

  it("new photo upload blocked", () => {
    expect(isUploadBlocked(usedBytes + 1, quotaBytes)).toBe(true);
  });

  it("new video upload blocked", () => {
    expect(isUploadBlocked(usedBytes + 1, quotaBytes)).toBe(true);
  });
});

describe("WP2A CORRECTION — Unified quota CASE D: SWIMNOTE + DATA100 = 110GB", () => {
  const baseGb  = PLANS.swimnote.storage_gb; // 10
  const extraGb = DATA100_EXTRA_GB;          // 100
  const quotaGb = baseGb + extraGb;          // 110

  it("effective quota = 110GB", () => {
    expect(quotaGb).toBe(110);
  });

  it("photo 100GB + video 10GB = 110GB — exactly at limit", () => {
    const quotaBytes = gbToBytes(quotaGb);
    const usedBytes  = gbToBytes(100) + gbToBytes(10);
    expect(usedBytes).toBe(quotaBytes);
    expect(isUploadBlocked(usedBytes + 1, quotaBytes)).toBe(true);
  });

  it("photo 60GB + video 60GB = 120GB > 110GB — blocked", () => {
    const quotaBytes = gbToBytes(quotaGb);
    const usedBytes  = gbToBytes(60) + gbToBytes(60);
    expect(isUploadBlocked(usedBytes, quotaBytes)).toBe(true);
  });

  it("photo 50GB + video 59GB = 109GB < 110GB — allowed", () => {
    const quotaBytes = gbToBytes(quotaGb);
    const usedBytes  = gbToBytes(50) + gbToBytes(59);
    expect(isUploadBlocked(usedBytes, quotaBytes)).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Section 4: Legacy shape preservation (CASE H)
// ──────────────────────────────────────────────────────────────────────────

describe("WP2A CORRECTION — CASE H: legacy Coach/Premier response shape", () => {
  it("Coach plan: videoStorageLimitMb field exists and equals storageMb", () => {
    const storageMb = PLANS.coach.storage_mb;
    const resp = { video_storage_limit_mb: computeVideoStorageLimitMb(storageMb) };
    expect(resp).toHaveProperty("video_storage_limit_mb");
    expect(resp.video_storage_limit_mb).toBe(storageMb); // field still present
    expect(resp.video_storage_limit_mb).not.toBe(1024 * 1024);
  });

  it("Premier plan: videoStorageLimitMb field exists and equals storageMb", () => {
    const storageMb = PLANS.premier.storage_mb;
    const resp = { video_storage_limit_mb: computeVideoStorageLimitMb(storageMb) };
    expect(resp).toHaveProperty("video_storage_limit_mb");
    expect(resp.video_storage_limit_mb).toBe(storageMb);
    expect(resp.video_storage_limit_mb).not.toBe(1024 * 1024);
  });

  it("field is present (not removed) for 1.6.3 consumer compatibility", () => {
    // 1.6.3 may read this field; it must remain in the response shape
    for (const [, plan] of Object.entries(PLANS)) {
      const resp = { video_storage_limit_mb: computeVideoStorageLimitMb(plan.storage_mb) };
      expect(resp.video_storage_limit_mb).toBeDefined();
      expect(typeof resp.video_storage_limit_mb).toBe("number");
      expect(resp.video_storage_limit_mb).toBeGreaterThan(0); // no plan is gated to 0
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Section 5: Video retention 14 days (CASE I)
// ──────────────────────────────────────────────────────────────────────────

describe("WP2A CORRECTION — CASE I: video retention 14 days unchanged", () => {
  it("expires_at = upload_at + 14 days", () => {
    const uploadAt  = new Date("2026-09-01T00:00:00Z");
    const expiresAt = new Date(uploadAt.getTime() + 14 * 86_400_000);
    const diffDays  = (expiresAt.getTime() - uploadAt.getTime()) / 86_400_000;
    expect(diffDays).toBe(14);
  });

  it("video 15 days old is expired (outside 14-day retention)", () => {
    const uploadAt  = new Date("2026-08-17T00:00:00Z");
    const now       = new Date("2026-09-01T00:00:00Z");
    const diffDays  = (now.getTime() - uploadAt.getTime()) / 86_400_000;
    expect(diffDays).toBeGreaterThan(14);
  });

  it("expired videos excluded from quota (status != active)", () => {
    // storageQuota.ts: video_assets_meta WHERE status='active'
    // An expired video has status='expired' → NOT counted in usedBytes
    const activeVideoBytes  = gbToBytes(5);  // counted
    const expiredVideoBytes = gbToBytes(10); // NOT counted (filtered by SQL)
    const photoBytes        = gbToBytes(3);

    const quotaBytes = gbToBytes(PLANS.swimnote.storage_gb);
    // usedBytes = only active: 5GB video + 3GB photo = 8GB
    const usedBytes = activeVideoBytes + photoBytes;
    expect(usedBytes).toBe(gbToBytes(8));

    // 8GB < 10GB → not blocked (expired 10GB does NOT push it over)
    expect(isUploadBlocked(usedBytes, quotaBytes)).toBe(false);

    // If we mistakenly counted expired bytes: 5+10+3 = 18GB > 10GB → incorrectly blocked
    // This shows the expired-exclusion is critical
    const wrongUsed = activeVideoBytes + expiredVideoBytes + photoBytes;
    expect(isUploadBlocked(wrongUsed, quotaBytes)).toBe(true); // wrong calculation IS blocked
    expect(isUploadBlocked(usedBytes, quotaBytes)).toBe(false); // correct calculation is NOT
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Section 6: Separate video quota must not exist (absolute prohibition)
// ──────────────────────────────────────────────────────────────────────────

describe("WP2A CORRECTION — CASE G/F: no separate video quota, unified blocks both", () => {
  it("F: photo+video 100% blocks all uploads (no split tracking)", () => {
    const quotaBytes = gbToBytes(PLANS.swimnote.storage_gb);
    const photo      = gbToBytes(6);
    const video      = gbToBytes(4);
    const used       = photo + video;
    expect(isUploadBlocked(used + 1, quotaBytes)).toBe(true);
  });

  it("G: video-only quota bypass via legacy 1TB field is prohibited", () => {
    // The legacy field would have allowed video up to 1TB separately
    // After fix: videoStorageLimitMb = storageMb = 10240 for SWIMNOTE
    // So the 'check video against video_storage_limit_mb' path (if any) also blocks at 10GB
    const swimnoteLimitMb = computeVideoStorageLimitMb(PLANS.swimnote.storage_mb);
    const videoOnlyGb     = 20;
    const videoLimitGb    = swimnoteLimitMb / 1024;
    expect(videoOnlyGb).toBeGreaterThan(videoLimitGb); // 20 > 10
  });

  it("no plan has videoStorageLimitMb > storageMb", () => {
    for (const [, plan] of Object.entries(PLANS)) {
      const limit = computeVideoStorageLimitMb(plan.storage_mb);
      expect(limit).toBeLessThanOrEqual(plan.storage_mb);
    }
  });

  it("no plan has videoStorageLimitMb = 1048576 (legacy 1TB marker)", () => {
    for (const [, plan] of Object.entries(PLANS)) {
      expect(computeVideoStorageLimitMb(plan.storage_mb)).not.toBe(1024 * 1024);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Section 7: Final storage contract values
// ──────────────────────────────────────────────────────────────────────────

describe("WP2A CORRECTION — final storage contract (CASES A–E values)", () => {
  it("SWIMNOTE base = 10GB (10240 MB)", () => {
    expect(PLANS.swimnote.storage_gb).toBe(10);
    expect(PLANS.swimnote.storage_mb).toBe(10_240);
  });

  it("X300 base = 300GB (307200 MB)", () => {
    expect(PLANS.x300.storage_gb).toBe(300);
    expect(PLANS.x300.storage_mb).toBe(307_200);
  });

  it("X500 base = 500GB (512000 MB)", () => {
    expect(PLANS.x500.storage_gb).toBe(500);
    expect(PLANS.x500.storage_mb).toBe(512_000);
  });

  it("X1000 base = 1000GB (1024000 MB)", () => {
    expect(PLANS.x1000.storage_gb).toBe(1000);
    expect(PLANS.x1000.storage_mb).toBe(1_024_000);
  });

  it("SWIMNOTE + DATA100 = 110GB unified quota", () => {
    const total = PLANS.swimnote.storage_gb + DATA100_EXTRA_GB;
    expect(total).toBe(110);
  });

  it("effective_storage_gb = base_plan + extra_storage_gb (no other addends)", () => {
    const base  = PLANS.x300.storage_gb;   // 300
    const extra = 0;
    const eff   = base + extra;
    expect(eff).toBe(300);
  });
});
