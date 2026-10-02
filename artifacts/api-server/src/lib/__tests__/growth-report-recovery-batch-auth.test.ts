import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import {
  signRecoveryBatchOperatorToken,
  verifyToken,
} from "../auth.js";

describe("recovery batch operator delegation", () => {
  it("mints short-lived actor-scoped delegation and rejects it as an APP session", () => {
    const token = signRecoveryBatchOperatorToken({
      userId: "recorded-operator",
      role: "super_admin",
      batchId: "persisted-batch-1",
    });
    const payload = jwt.decode(token) as jwt.JwtPayload & {
      userId: string; role: string; tv: number; purpose: string; batchId: string;
    };
    expect(payload.userId).toBe("recorded-operator");
    expect(payload.role).toBe("super_admin");
    expect(payload.tv).toBe(1);
    expect(payload.purpose).toBe("growth_report_recovery_batch");
    expect(payload.batchId).toBe("persisted-batch-1");
    expect(payload.aud).toBeUndefined();
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(5 * 60);
    expect(() => verifyToken(token)).toThrow(
      "Recovery batch delegation tokens are not valid APP sessions",
    );
  });
});