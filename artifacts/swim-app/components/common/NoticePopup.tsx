/**
 * components/common/NoticePopup.tsx — 콜드런치 공지 팝업
 *
 * ─ 트리거 기준 ─────────────────────────────────────────────────────────
 * 앱이 완전히 종료된 뒤 재실행(콜드런치)되었을 때 1회만 실행.
 * 백그라운드 복귀 시에는 실행하지 않음.
 *
 * 구현: 모듈 레벨 변수 _coldLaunchProcessed 활용
 *   - 프로세스 재시작 → 변수 false(초기값) → 처리 후 true로 변경
 *   - 백그라운드 복귀 → 변수는 이미 true → 처리 안 함
 *
 * ─ 노출 순서 ───────────────────────────────────────────────────────────
 * 1. 전체 공지 (audience_scope = global)
 * 2. 수영장 공지 (audience_scope = pool)
 * 각 그룹 안에서: is_pinned 먼저, 그다음 최신순
 *
 * ─ 버튼 정책 ───────────────────────────────────────────────────────────
 * - "닫기"        : 현재 팝업만 닫음. 다음 콜드런치 시 다시 표시.
 * - "다시보지않기": AsyncStorage에 영구 저장. 이후 팝업에 나타나지 않음.
 *
 * ─ 공지함 ──────────────────────────────────────────────────────────────
 * 자동팝업 숨김과 공지함 열람은 별개.
 * 다시보지않기 해도 공지함에서 계속 확인 가능.
 */
import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNoticeStore, NOTICE_TYPE_CFG, type NoticeType } from "@/store/noticeStore";
import { useAuth, apiRequest } from "@/context/AuthContext";

// ─────────────────────────────────────────────────────────────────────────────
// 콜드런치 감지 플래그
// 모듈 레벨 — 프로세스 재시작(콜드런치) 시에만 false로 리셋됨
// 백그라운드 복귀 시에는 이미 true이므로 팝업 미실행
// ─────────────────────────────────────────────────────────────────────────────
let _coldLaunchProcessed = false;

const P = "#7C3AED";

// API 공지 타입
interface ApiNotice {
  id: string;
  title: string;
  content: string;
  notice_type: string;
  audience_scope: "global" | "pool";
  swimming_pool_id: string | null;
  status: string;
  is_pinned: boolean;
  created_at: string;
}

// 공지 scope 뱃지 설정
const SCOPE_CFG = {
  global: { label: "전체 공지",    color: "#2EC4B6", bg: "#E6FFFA" },
  pool:   { label: "수영장 공지",  color: P,         bg: "#EEDDF5" },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// API 공지 정렬: global 먼저 → pool, 각 그룹 내 pinned 먼저 → 최신순
// ─────────────────────────────────────────────────────────────────────────────
function sortNoticesForPopup(notices: ApiNotice[]): ApiNotice[] {
  return [...notices].sort((a, b) => {
    // 1. global 먼저
    if (a.audience_scope === "global" && b.audience_scope !== "global") return -1;
    if (a.audience_scope !== "global" && b.audience_scope === "global") return 1;
    // 2. pinned 먼저
    if (a.is_pinned && !b.is_pinned) return -1;
    if (!a.is_pinned && b.is_pinned) return 1;
    // 3. 최신순
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// NoticePopup 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────
export function NoticePopup() {
  const { kind, token } = useAuth();
  const dismissForever   = useNoticeStore(s => s.dismissForever);
  const hydrateDismissed = useNoticeStore(s => s.hydrateDismissed);
  const hydrated         = useNoticeStore(s => s._hydrated);

  const [queue, setQueue]     = useState<ApiNotice[]>([]);
  const [index, setIndex]     = useState(0);
  const [visible, setVisible] = useState(false);

  // 중복 실행 방지
  const fetchingRef = useRef(false);

  // Step 1: 앱 마운트 시 AsyncStorage에서 dismissed 목록 복원
  useEffect(() => { hydrateDismissed(); }, []);

  // Step 2: hydrated + 로그인 확인 후 콜드런치 여부 판단 → 공지 조회
  const fetchAndShow = useCallback(async () => {
    if (!token || !kind || !hydrated) return;
    if (_coldLaunchProcessed) return;       // 이미 이번 프로세스에서 처리함 (백그라운드 복귀 등)
    if (fetchingRef.current) return;

    // 콜드런치로 확정 — 이후 백그라운드 복귀 시 재실행 방지
    _coldLaunchProcessed = true;
    fetchingRef.current = true;

    try {
      // 역할에 따라 적절한 엔드포인트 사용
      const endpoint = kind === "parent" ? "/parent/notices" : "/notices";
      const res = await apiRequest(token, endpoint);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const data: ApiNotice[] = Array.isArray(json) ? json : (json?.notices ?? []);

      // 현재 dismissedIds 스냅샷 (fetchAndShow 실행 시점)
      const currentDismissed = useNoticeStore.getState().dismissedIds;

      // 필터: published 상태만 + dismissed 제외
      const eligible = data.filter(
        n => n.status === "published" && !currentDismissed.includes(n.id),
      );

      // 정렬: global 먼저 → pool
      const sorted = sortNoticesForPopup(eligible);

      if (sorted.length > 0) {
        setQueue(sorted);
        setIndex(0);
        setVisible(true);
      }
    } catch (e) {
      // 공지 조회 실패는 무시 (팝업 미표시)
      console.warn("[NoticePopup] 공지 조회 실패:", e);
    } finally {
      fetchingRef.current = false;
    }
  }, [token, kind, hydrated]);

  useEffect(() => {
    fetchAndShow();
  }, [fetchAndShow]);

  // ── 현재 공지 ────────────────────────────────────────────────────────────
  const notice = queue[index] ?? null;

  // ── 다음으로 이동 or 팝업 닫기 ───────────────────────────────────────────
  function advance() {
    const next = index + 1;
    if (next < queue.length) {
      // 다음 공지가 dismissed 된 경우 건너뜀
      const nextDismissed = useNoticeStore.getState().dismissedIds;
      const remaining = queue.slice(next).filter(n => !nextDismissed.includes(n.id));
      if (remaining.length > 0) {
        const nextIdx = queue.findIndex((n, i) => i >= next && !nextDismissed.includes(n.id));
        setIndex(nextIdx);
      } else {
        setVisible(false);
      }
    } else {
      setVisible(false);
    }
  }

  function handleClose() {
    // 닫기: 이번 세션만 닫기. 다음 콜드런치 시 다시 표시.
    advance();
  }

  function handleDismiss() {
    // 다시보지않기: AsyncStorage에 영구 저장 → 이후 팝업 미노출
    if (notice) dismissForever(notice.id);
    advance();
  }

  // ── 표시할 공지 없음 ─────────────────────────────────────────────────────
  if (!notice) return null;

  const scopeCfg = SCOPE_CFG[notice.audience_scope] ?? SCOPE_CFG.pool;
  const ntCfg    = NOTICE_TYPE_CFG[notice.notice_type as NoticeType];
  const totalVisible = queue.length;
  const showCounter  = totalVisible > 1;

  return (
    <Modal visible={visible} transparent animationType="fade">
      {/* 배경 터치 불가 (강제 확인 구조) */}
      <View style={s.overlay}>
        <View style={s.card}>

          {/* 상단: 카운터 + scope 뱃지 */}
          <View style={s.headerRow}>
            <View style={[s.scopeBadge, { backgroundColor: scopeCfg.bg }]}>
              <Feather name="bell" size={12} color={scopeCfg.color} />
              <Text style={[s.scopeTxt, { color: scopeCfg.color }]}>{scopeCfg.label}</Text>
            </View>
            {showCounter && (
              <Text style={s.counter}>{index + 1} / {totalVisible}</Text>
            )}
          </View>

          {/* 공지 유형 뱃지 */}
          {ntCfg && (
            <View style={[s.typeBadge, { backgroundColor: ntCfg.bg }]}>
              <Feather name={ntCfg.icon as any} size={11} color={ntCfg.color} />
              <Text style={[s.typeTxt, { color: ntCfg.color }]}>{ntCfg.label}</Text>
            </View>
          )}

          {/* 제목 */}
          <Text style={s.title}>{notice.title}</Text>

          {/* 내용 (길면 팝업 내부 스크롤) */}
          <ScrollView style={s.contentScroll} showsVerticalScrollIndicator={false}>
            <Text style={s.content}>{notice.content}</Text>
          </ScrollView>

          {/* 날짜 */}
          <Text style={s.date}>
            {new Date(notice.created_at).toLocaleDateString("ko-KR", {
              year: "numeric", month: "long", day: "numeric",
            })}
          </Text>

          {/* 버튼 */}
          <View style={s.btnRow}>
            <Pressable style={s.dismissBtn} onPress={handleDismiss}>
              <Text style={s.dismissTxt}>다시 보지 않기</Text>
            </Pressable>
            <Pressable style={s.confirmBtn} onPress={handleClose}>
              <Text style={s.confirmTxt}>
                {showCounter && index < totalVisible - 1 ? "다음 공지" : "닫기"}
              </Text>
            </Pressable>
          </View>

          {/* 안내 텍스트 */}
          <Text style={s.hint}>
            닫기: 이번만 닫기 · 다시보지않기: 이 기기에서 자동팝업 숨김
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay:      { flex: 1, backgroundColor: "rgba(0,0,0,0.65)",
                  alignItems: "center", justifyContent: "center", padding: 24 },
  card:         { backgroundColor: "#fff", borderRadius: 20, padding: 24,
                  width: "100%", maxWidth: 400, maxHeight: "80%" },
  headerRow:    { flexDirection: "row", alignItems: "center",
                  justifyContent: "space-between", marginBottom: 12 },
  scopeBadge:   { flexDirection: "row", alignItems: "center", gap: 5,
                  paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  scopeTxt:     { fontSize: 12, fontFamily: "Pretendard-SemiBold" },
  counter:      { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#9CA3AF" },
  typeBadge:    { flexDirection: "row", alignItems: "center", gap: 5,
                  alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4,
                  borderRadius: 8, marginBottom: 12 },
  typeTxt:      { fontSize: 11, fontFamily: "Pretendard-SemiBold" },
  title:        { fontSize: 18, fontFamily: "Pretendard-Bold",
                  color: "#111827", marginBottom: 12 },
  contentScroll:{ maxHeight: 200, marginBottom: 12 },
  content:      { fontSize: 14, fontFamily: "Pretendard-Regular",
                  color: "#111827", lineHeight: 22 },
  date:         { fontSize: 11, fontFamily: "Pretendard-Regular",
                  color: "#9CA3AF", marginBottom: 14 },
  btnRow:       { flexDirection: "row", gap: 8 },
  dismissBtn:   { flex: 1, padding: 13, borderRadius: 12,
                  backgroundColor: "#F8FAFC", alignItems: "center" },
  dismissTxt:   { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: "#6B7280" },
  confirmBtn:   { flex: 1, padding: 13, borderRadius: 12,
                  backgroundColor: P, alignItems: "center" },
  confirmTxt:   { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: "#fff" },
  hint:         { fontSize: 10, fontFamily: "Pretendard-Regular",
                  color: "#C4B5FD", textAlign: "center", marginTop: 10 },
});
