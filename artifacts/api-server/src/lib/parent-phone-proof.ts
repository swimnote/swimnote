import { createHmac, timingSafeEqual } from "node:crypto";
import { superAdminDb } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";

export const PARENT_PHONE_PROOF_PURPOSE = "parent_signup_ownership_v1";

const PROOF_DOMAIN = "swimnote:parent-phone-ownership-proof:v1";
const PROOF_KEY_DOMAIN = "swimnote:parent-phone-ownership-proof-key:v1";
const PROOF_TTL_SECONDS = 10 * 60;
const DEV_JWT_SECRET = "swim-platform-secret-key-dev-only";

type ParentPhoneProofClaims = {
  v: 1;
  purpose: typeof PARENT_PHONE_PROOF_PURPOSE;
  otpPurpose: typeof PARENT_PHONE_PROOF_PURPOSE | "signup";
  phone: string;
  verificationId: string;
  issuedAt: number;
  expiresAt: number;
};

function canonicalPhone(phone: string): string {
  return (phone || "").replace(/[^0-9]/g, "");
}

function getSigningKey(): Buffer {
  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (!jwtSecret && process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be configured before issuing parent phone proofs");
  }
  return createHmac("sha256", jwtSecret || DEV_JWT_SECRET)
    .update(PROOF_KEY_DOMAIN)
    .digest();
}

function signatureFor(encodedClaims: string): Buffer {
  return createHmac("sha256", getSigningKey())
    .update(`${PROOF_DOMAIN}.${encodedClaims}`)
    .digest();
}

export function issueParentPhoneProof(
  phone: string,
  verificationId: string,
  otpPurpose: typeof PARENT_PHONE_PROOF_PURPOSE | "signup" = PARENT_PHONE_PROOF_PURPOSE,
  now = Date.now(),
): string {
  const phoneNorm = canonicalPhone(phone);
  if (
    !/^01[016789]\d{7,8}$/.test(phoneNorm) ||
    !verificationId ||
    verificationId.length > 256 ||
    (otpPurpose !== PARENT_PHONE_PROOF_PURPOSE && otpPurpose !== "signup")
  ) {
    throw new Error("Invalid verified phone record");
  }

  const issuedAt = Math.floor(now / 1000);
  const claims: ParentPhoneProofClaims = {
    v: 1,
    purpose: PARENT_PHONE_PROOF_PURPOSE,
    otpPurpose,
    phone: phoneNorm,
    verificationId,
    issuedAt,
    expiresAt: issuedAt + PROOF_TTL_SECONDS,
  };
  const encodedClaims = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = signatureFor(encodedClaims).toString("base64url");
  return `v1.${encodedClaims}.${signature}`;
}

export function verifyParentPhoneProof(
  proof: unknown,
  phone: string,
  now = Date.now(),
): ParentPhoneProofClaims | null {
  if (typeof proof !== "string" || proof.length > 4096) return null;

  const parts = proof.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !parts[1] || !parts[2]) return null;

  try {
    const submittedSignature = Buffer.from(parts[2], "base64url");
    const expectedSignature = signatureFor(parts[1]);
    if (
      submittedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(submittedSignature, expectedSignature)
    ) {
      return null;
    }

    const rawClaims: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!rawClaims || typeof rawClaims !== "object" || Array.isArray(rawClaims)) return null;
    const claims = rawClaims as Partial<ParentPhoneProofClaims>;
    const claimKeys = Object.keys(rawClaims);
    const expectedKeys = ["v", "purpose", "otpPurpose", "phone", "verificationId", "issuedAt", "expiresAt"];
    if (claimKeys.length !== expectedKeys.length || claimKeys.some(key => !expectedKeys.includes(key))) return null;
    const phoneNorm = canonicalPhone(phone);
    const nowSeconds = Math.floor(now / 1000);

    if (
      claims.v !== 1 ||
      claims.purpose !== PARENT_PHONE_PROOF_PURPOSE ||
      (claims.otpPurpose !== PARENT_PHONE_PROOF_PURPOSE && claims.otpPurpose !== "signup") ||
      typeof claims.phone !== "string" ||
      !/^01[016789]\d{7,8}$/.test(claims.phone) ||
      claims.phone !== phoneNorm ||
      typeof claims.verificationId !== "string" ||
      !claims.verificationId ||
      claims.verificationId.length > 256 ||
      !Number.isSafeInteger(claims.issuedAt) ||
      !Number.isSafeInteger(claims.expiresAt) ||
      claims.issuedAt! > nowSeconds + 30 ||
      claims.expiresAt! <= nowSeconds ||
      claims.expiresAt! <= claims.issuedAt! ||
      claims.expiresAt! - claims.issuedAt! > PROOF_TTL_SECONDS
    ) {
      return null;
    }

    return claims as ParentPhoneProofClaims;
  } catch {
    return null;
  }
}

/**
 * Atomically binds the verified OTP row to a newly generated parent ID.
 * The proof expiry limits signup use; the claimed row itself remains durable
 * for later parent-account ownership checks and intentionally ignores OTP expiry.
 */
export async function claimParentPhoneProof(
  proof: unknown,
  phoneNorm: string,
  parentId: string,
  now = Date.now(),
): Promise<boolean> {
  const claims = verifyParentPhoneProof(proof, phoneNorm, now);
  if (!claims || !parentId) return false;

  const claimed = await superAdminDb.execute(sql`
    UPDATE phone_verifications
    SET ref_id = ${parentId}, purpose = ${PARENT_PHONE_PROOF_PURPOSE}
    WHERE id = ${claims.verificationId}
      AND phone = ${claims.phone}
      AND purpose = ${claims.otpPurpose}
      AND code_hash IS NOT NULL
      AND is_used = true
      AND verified_at IS NOT NULL
      AND ref_id IS NULL
    RETURNING id
  `);
  if (!claimed.rows.length) return false;

  return isParentPhoneVerified(parentId, claims.phone);
}

/**
 * Durable lookup for ownership established by a claimed, real parent-signup OTP.
 * Do not check expires_at: that timestamp belongs to the one-time OTP, not the
 * durable parent-bound verification record.
 */
export async function isParentPhoneVerified(
  parentId: string,
  phoneNorm: string,
  reader: { execute(query: SQL): Promise<any> } = superAdminDb,
): Promise<boolean> {
  const canonical = canonicalPhone(phoneNorm);
  if (!parentId || !/^01[016789]\d{7,8}$/.test(canonical) || canonical !== phoneNorm) {
    return false;
  }

  const result = await reader.execute(sql`
    SELECT id
    FROM phone_verifications
    WHERE ref_id = ${parentId}
      AND phone = ${canonical}
      AND purpose = ${PARENT_PHONE_PROOF_PURPOSE}
      AND code_hash IS NOT NULL
      AND is_used = true
      AND verified_at IS NOT NULL
    LIMIT 1
  `);
  return result.rows.length > 0;
}