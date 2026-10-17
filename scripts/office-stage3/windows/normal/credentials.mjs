import crypto from "node:crypto";
/** Values are only written inside an ACL-protected (Windows) / 0700 (Linux) run. */
export function localCredentials(candidateId) {
  const secret = () => crypto.randomBytes(32).toString("base64url");
  const totpSecret = [...crypto.randomBytes(32)].map(byte => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
  const users = [
    { id: "fixture_admin", identifier: "fixture_pool", poolId: "fixture_pool", role: "pool_admin", pin: String(crypto.randomInt(1000, 10000)) },
    { id: "isolation_other", poolId: "isolation_other_pool", role: "pool_admin" },
    { id: "isolation_teacher", poolId: "fixture_pool", role: "teacher" },
    { id: "isolation_inactive", poolId: "isolation_inactive_pool", role: "pool_admin", active: false },
    { id: "isolation_withdrawn", poolId: "isolation_withdrawn_pool", role: "pool_admin", withdrawn: true },
    { id: "isolation_offpool", poolId: "isolation_off_pool", role: "pool_admin" },
    { id: "isolation_totp", poolId: "isolation_totp_pool", role: "pool_admin", totpSecret },
  ].map(user => ({ ...user, email: user.id + "@example.invalid", password: secret() }));
  return { candidateId, dbPassword: secret(), jwtKey: crypto.randomBytes(48).toString("hex"), accounts: users };
}
