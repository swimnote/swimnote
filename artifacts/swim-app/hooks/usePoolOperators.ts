/**
 * usePoolOperators.ts
 *
 * 풀 운영자(pool_admin) 목록을 `/admin/operators`에서 가져오는 훅.
 *
 * 보호 로직:
 *   - API가 빈 배열을 반환해도 기존 데이터를 덮어쓰지 않는다.
 *   - 에러 발생 시 기존 operators 유지.
 */

import { useState, useCallback, useRef } from "react";
import { apiRequest } from "../context/AuthContext";

export interface PoolOperator {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  is_activated: boolean;
  created_at: string;
  last_login_at: string | null;
}

interface UsePoolOperatorsResult {
  operators: PoolOperator[];
  count: number;
  loading: boolean;
  error: string | null;
  fetchOperators: (token: string) => Promise<void>;
  refresh: (token: string) => Promise<void>;
}

export function usePoolOperators(): UsePoolOperatorsResult {
  const [operators, setOperators] = useState<PoolOperator[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const fetchedOnce               = useRef(false);

  const fetchOperators = useCallback(async (token: string) => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest(token, "/admin/operators");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any)?.error ?? `HTTP ${res.status}`);
      }
      const body = await res.json();
      const rows: PoolOperator[] = Array.isArray(body)
        ? body
        : (body?.data ?? []);

      // 빈 배열 덮어쓰기 방지: 첫 호출 이후 빈 응답은 무시
      if (rows.length === 0 && fetchedOnce.current) return;

      setOperators(rows);
      fetchedOnce.current = true;
    } catch (e: any) {
      console.error("[usePoolOperators]", e?.message);
      setError(e?.message ?? "서버 오류");
      // 에러 시 기존 operators 유지 (setOperators 호출 안 함)
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(
    (token: string) => fetchOperators(token),
    [fetchOperators]
  );

  return {
    operators,
    count: operators.length,
    loading,
    error,
    fetchOperators,
    refresh,
  };
}
