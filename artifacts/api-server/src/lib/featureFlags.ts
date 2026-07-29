/**
 * lib/featureFlags.ts — 기능 플래그 런타임 조회 헬퍼
 *
 * isFeatureEnabled(key, poolId?)
 *  1. 운영자별 오버라이드(feature_flag_overrides)가 있으면 그 값 우선
 *  2. 없으면 전역 플래그(feature_flags.global_enabled) 사용
 *
 * 성능 — 5초 in-memory 캐시로 DB 호출 최소화
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

interface CachedEntry {
  value: boolean;
  expiresAt: number;
}

const cache = new Map<string, CachedEntry>();
const TTL_MS = 5_000; // 5초 캐시

function cacheKey(flagKey: string, poolId?: string | null): string {
  return poolId ? `${flagKey}::${poolId}` : flagKey;
}

export async function isFeatureEnabled(
  flagKey: string,
  poolId?: string | null,
): Promise<boolean> {
  const key = cacheKey(flagKey, poolId);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    // 운영자별 오버라이드 먼저 확인
    if (poolId) {
      const overrideRow = (await superAdminDb.execute(sql`
        SELECT enabled FROM feature_flag_overrides
        WHERE flag_key = ${flagKey} AND pool_id = ${poolId}
        LIMIT 1
      `)).rows[0] as any;

      if (overrideRow !== undefined) {
        const value = !!overrideRow.enabled;
        cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
        return value;
      }
    }

    // 전역 플래그 조회
    const flagRow = (await superAdminDb.execute(sql`
      SELECT global_enabled FROM feature_flags WHERE key = ${flagKey} LIMIT 1
    `)).rows[0] as any;

    const value = !!flagRow?.global_enabled;
    cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
    return value;
  } catch {
    return false; // 오류 시 안전하게 비활성화
  }
}

/** 캐시 즉시 무효화 (플래그 변경 직후 호출) */
export function invalidateFlagCache(flagKey?: string): void {
  if (!flagKey) {
    cache.clear();
  } else {
    for (const k of cache.keys()) {
      if (k === flagKey || k.startsWith(`${flagKey}::`)) cache.delete(k);
    }
  }
}

/** 플래그 여러 개를 한 번에 조회 (map 반환) */
export async function getFlags(keys: string[]): Promise<Record<string, boolean>> {
  if (keys.length === 0) return {};
  try {
    const rows = (await superAdminDb.execute(sql`
      SELECT key, global_enabled FROM feature_flags WHERE key = ANY(${keys}::text[])
    `)).rows as any[];
    const result: Record<string, boolean> = {};
    for (const k of keys) result[k] = false;
    for (const r of rows) result[r.key] = !!r.global_enabled;
    return result;
  } catch {
    return Object.fromEntries(keys.map(k => [k, false]));
  }
}
