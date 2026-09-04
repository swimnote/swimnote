/**
 * useGrowthEvents — WP9
 *
 * WP8 Growth Event READ API 클라이언트 hook.
 *
 * 상태 분리:
 *   "idle"    — studentId 없음 / 초기화 전
 *   "loading" — 요청 중 (첫 페이지 / 필터 변경)
 *   "error"   — 네트워크/서버 오류 → empty로 위장하지 않음
 *   "success" — 정상 완료 (events=[] 포함)
 *
 * 규칙:
 *   - error와 empty를 구분: error=throw, empty=success+[]
 *   - 학생 전환 시 이전 데이터 즉시 초기화 (TC-D)
 *   - event_id 기반 dedup으로 중복 방지 (TC-E)
 *   - 필터 변경 시 page 자동 초기화
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/context/AuthContext";

// ── Types ────────────────────────────────────────────────────────────────────

export interface GrowthEvent {
  event_id:              string;
  student_id:            string;
  source:                string;
  status:                string;
  created_at:            string;
  diary_note_id:         string | null;
  curriculum_item_id:    string | null;
  curriculum_version_id: string | null;
  match_token_id:        string | null;
  confidence:            number | null;
  is_invalidated:        boolean;
  curriculum_title:      string | null;
}

interface GrowthListResponse {
  events:   GrowthEvent[];
  total:    number;
  limit:    number;
  offset:   number;
  has_more: boolean;
}

export type GrowthLoadState = "idle" | "loading" | "error" | "success";

const PAGE_LIMIT = 30;

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface UseGrowthEventsOptions {
  token:         string | null;
  studentId:     string | null;
  filterStatus?: string | null;
  filterSource?: string | null;
}

export interface UseGrowthEventsResult {
  events:     GrowthEvent[];
  total:      number;
  loadState:  GrowthLoadState;
  hasMore:    boolean;
  refreshing: boolean;
  errorCode:  string | null;
  loadMore:   () => void;
  refresh:    () => void;
}

export function useGrowthEvents({
  token,
  studentId,
  filterStatus = null,
  filterSource = null,
}: UseGrowthEventsOptions): UseGrowthEventsResult {
  const [events,     setEvents]     = useState<GrowthEvent[]>([]);
  const [total,      setTotal]      = useState(0);
  const [loadState,  setLoadState]  = useState<GrowthLoadState>("idle");
  const [hasMore,    setHasMore]    = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errorCode,  setErrorCode]  = useState<string | null>(null);
  const [page,       setPage]       = useState(0);
  const [seq,        setSeq]        = useState(0);   // 필터/학생 변경 sequence

  const isLoadingRef = useRef(false);

  // ── 학생 / 필터 변경 → 초기화 (TC-D) ─────────────────────────────────────
  useEffect(() => {
    setEvents([]);
    setTotal(0);
    setHasMore(false);
    setPage(0);
    setErrorCode(null);
    setLoadState(!studentId || !token ? "idle" : "loading");
    // seq 증가 → 이전 in-flight 요청의 결과 무시
    setSeq(s => s + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, filterStatus, filterSource, token]);

  // ── 실제 fetch ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!studentId || !token) return;

    const thisSeq = seq;
    let cancelled = false;

    const doFetch = async () => {
      if (isLoadingRef.current && page > 0) return; // loadMore 중복 방지
      isLoadingRef.current = true;

      try {
        const offset = page * PAGE_LIMIT;
        const params = new URLSearchParams({
          limit:  String(PAGE_LIMIT),
          offset: String(offset),
        });
        if (filterStatus) params.set("status", filterStatus);
        if (filterSource) params.set("source", filterSource);

        const path = `/x-growth/students/${studentId}/events?${params.toString()}`;
        const res = await apiRequest(token, path, { _noCache: true });

        if (cancelled) return;

        if (!res.ok) {
          const code = res.status === 403 ? "forbidden"
                     : res.status === 401 ? "unauthorized"
                     : `http_${res.status}`;
          setLoadState("error");
          setErrorCode(code);
          return;
        }

        const data: GrowthListResponse = await res.json();
        if (cancelled) return;

        if (page === 0) {
          setEvents(data.events);
        } else {
          // dedup: event_id 기준 (TC-E)
          setEvents(prev => {
            const existIds = new Set(prev.map(e => e.event_id));
            const newItems = data.events.filter(e => !existIds.has(e.event_id));
            return [...prev, ...newItems];
          });
        }
        setTotal(data.total);
        setHasMore(data.has_more);
        setLoadState("success");
        setErrorCode(null);
      } catch {
        if (!cancelled) {
          setLoadState("error");
          setErrorCode("network_error");
        }
      } finally {
        if (!cancelled) {
          isLoadingRef.current = false;
          setRefreshing(false);
        }
      }
    };

    doFetch();
    return () => { cancelled = true; };
  // seq가 변경되면 page=0이 설정된 후 이 effect가 실행됨
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, seq]);

  const loadMore = useCallback(() => {
    if (!hasMore || loadState === "loading" || isLoadingRef.current) return;
    setPage(p => p + 1);
  }, [hasMore, loadState]);

  const refresh = useCallback(() => {
    if (isLoadingRef.current) return;
    setRefreshing(true);
    setPage(0);
    setSeq(s => s + 1);
  }, []);

  return { events, total, loadState, hasMore, refreshing, errorCode, loadMore, refresh };
}

// ── Status / Source 라벨 변환 ────────────────────────────────────────────────

export const STATUS_LABELS: Record<string, string> = {
  PENDING_REVIEW:   "검토 대기",
  TEACHER_ACCEPTED: "승인",
  TEACHER_REJECTED: "제외",
  AUTO_ACCEPTED:    "자동 승인",
  DISCARDED:        "폐기",
};

export const SOURCE_LABELS: Record<string, string> = {
  teacher_ai:     "AI 일지",
  teacher_manual: "수동",
  parent_ai:      "학부모 AI",
  video_ai:       "영상 분석",
};

export const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  PENDING_REVIEW:   { bg: "#FEF9C3", text: "#A16207" },
  TEACHER_ACCEPTED: { bg: "#D1FAE5", text: "#065F46" },
  TEACHER_REJECTED: { bg: "#FEE2E2", text: "#991B1B" },
  AUTO_ACCEPTED:    { bg: "#E0F2FE", text: "#0369A1" },
  DISCARDED:        { bg: "#F1F5F9", text: "#64748B" },
};
