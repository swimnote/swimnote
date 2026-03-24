import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "swim-platform-secret-key-2024";

export type PlatformPermissions = {
  canViewPools: boolean;
  canEditPools: boolean;
  canApprovePools: boolean;
  canManageSubscriptions: boolean;
  canManagePlatformAdmins: boolean;
};

export const SUPER_ADMIN_PERMISSIONS: PlatformPermissions = {
  canViewPools: true,
  canEditPools: true,
  canApprovePools: true,
  canManageSubscriptions: true,
  canManagePlatformAdmins: true,
};

export const DEFAULT_PLATFORM_ADMIN_PERMISSIONS: PlatformPermissions = {
  canViewPools: true,
  canEditPools: false,
  canApprovePools: false,
  canManageSubscriptions: false,
  canManagePlatformAdmins: false,
};

export type JwtPayload = {
  userId: string;
  role: string;
  poolId?: string | null;
  permissions?: PlatformPermissions;
};

export type TotpSessionPayload = {
  userId: string;
  totpPending: true;
};

export function signTotpSession(userId: string): string {
  return jwt.sign({ userId, totpPending: true } as TotpSessionPayload, JWT_SECRET, { expiresIn: "5m" });
}

export function verifyTotpSession(token: string): TotpSessionPayload {
  const payload = jwt.verify(token, JWT_SECRET) as any;
  if (!payload.totpPending) throw new Error("Invalid TOTP session token");
  return payload as TotpSessionPayload;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}
