import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  superAdminDb: {
    execute: vi.fn(),
  },
}));

import { superAdminDb } from "@workspace/db";
import {
  claimParentPhoneProof,
  isParentPhoneVerified,
  issueParentPhoneProof,
  PARENT_PHONE_PROOF_PURPOSE,
  verifyParentPhoneProof,
} from "../parent-phone-proof.js";

const NOW = Date.UTC(2025, 0, 1, 0, 0, 0);

describe("parent signup phone ownership proof", () => {
  beforeEach(() => {
    vi.stubEnv("JWT_SECRET", "test-only-phone-proof-signing-key");
    vi.stubEnv("NODE_ENV", "test");
    vi.mocked(superAdminDb.execute).mockReset();
  });

  it("issues a domain-purpose phone-bound short-lived proof", () => {
    const proof = issueParentPhoneProof("010-1234-5678", "otp-row-1", PARENT_PHONE_PROOF_PURPOSE, NOW);

    expect(verifyParentPhoneProof(proof, "01012345678", NOW)).toMatchObject({
      purpose: PARENT_PHONE_PROOF_PURPOSE,
      phone: "01012345678",
      verificationId: "otp-row-1",
      issuedAt: Math.floor(NOW / 1000),
      expiresAt: Math.floor(NOW / 1000) + 600,
    });
  });

  it("can bind a real legacy signup OTP row to the parent-only proof purpose", () => {
    const proof = issueParentPhoneProof("01012345678", "otp-row-signup", "signup", NOW);

    expect(verifyParentPhoneProof(proof, "01012345678", NOW)).toMatchObject({
      purpose: PARENT_PHONE_PROOF_PURPOSE,
      otpPurpose: "signup",
      verificationId: "otp-row-signup",
    });
  });

  it("rejects tampering, phone mismatch, invalid JSON shape, and expiry", () => {
    const proof = issueParentPhoneProof("01012345678", "otp-row-2", PARENT_PHONE_PROOF_PURPOSE, NOW);
    const [version, claims, signature] = proof.split(".");

    expect(verifyParentPhoneProof(`${version}.${claims}.${signature.slice(0, -1)}x`, "01012345678", NOW)).toBeNull();
    expect(verifyParentPhoneProof(proof, "01099998888", NOW)).toBeNull();
    expect(verifyParentPhoneProof({ token: proof }, "01012345678", NOW)).toBeNull();
    expect(verifyParentPhoneProof(proof, "01012345678", NOW + 601_000)).toBeNull();
  });

  it("requires an actual verified OTP row and atomically allows only one parent claim", async () => {
    const proof = issueParentPhoneProof("01012345678", "otp-row-3", PARENT_PHONE_PROOF_PURPOSE, NOW);
    const execute = vi.mocked(superAdminDb.execute);
    execute
      .mockResolvedValueOnce({ rows: [{ id: "otp-row-3" }] } as any)
      .mockResolvedValueOnce({ rows: [{ id: "otp-row-3" }] } as any);

    expect(await claimParentPhoneProof(proof, "01012345678", "parent-1", NOW)).toBe(true);

    // A real UPDATE ... WHERE ref_id IS NULL returns no row on replay.
    execute.mockResolvedValueOnce({ rows: [] } as any);
    expect(await claimParentPhoneProof(proof, "01012345678", "parent-2", NOW)).toBe(false);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("rejects missing actual verification and mismatched request phone without writes", async () => {
    const proof = issueParentPhoneProof("01012345678", "otp-row-4", PARENT_PHONE_PROOF_PURPOSE, NOW);
    const execute = vi.mocked(superAdminDb.execute);
    execute.mockResolvedValueOnce({ rows: [] } as any);

    expect(await claimParentPhoneProof(proof, "01012345678", "parent-3", NOW)).toBe(false);
    expect(await claimParentPhoneProof(proof, "01099998888", "parent-4", NOW)).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("looks up durable ownership by parent ref_id and canonical phone", async () => {
    const execute = vi.mocked(superAdminDb.execute);
    execute.mockResolvedValueOnce({ rows: [{ id: "otp-row-5" }] } as any);
    expect(await isParentPhoneVerified("parent-5", "01012345678")).toBe(true);

    execute.mockResolvedValueOnce({ rows: [] } as any);
    expect(await isParentPhoneVerified("parent-5", "01099998888")).toBe(false);
    expect(await isParentPhoneVerified("parent-5", "010-1234-5678")).toBe(false);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});