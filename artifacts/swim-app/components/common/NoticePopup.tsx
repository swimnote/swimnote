/**
 * components/common/NoticePopup.tsx — V2 운영형 공지 팝업
 *
 * ─ 정책 ────────────────────────────────────────────────────────────────────
 * 1. 콜드런치(프로세스 재시작) 1회만 실행
 * 2. 서버 기준 사용자별 1회 노출 (notice_dismissals 테이블)
 * 3. Modal onShow 이후 POST /notices/:id/seen (fire & forget, 실패 무시)
 *    — setVisible 시점이 아니라 실제 화면 표시 후 기록
 * 4. 미노출 공지 중 최신 1개만 표시 (서버에서 LIMIT 1 반환)
 * 5. "다시 보지 않기" 없음 — X / 닫기 버튼만
 * 6. 이미지, CTA 링크 선택 표시
 * 7. 모든 오류 fail-safe — 앱 진입 차단 금지
 *
 * ─ 대상 역할 ────────────────────────────────────────────────────────────────
 * GET /notices/pending — 모든 역할 (pool_admin, teacher, parent_account 등)
 * 서버에서 role 필터링 + seen 필터링 + starts_at 필터링 처리
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Modal, StyleSheet, View } from "react-native";
import { useAuth, apiRequest, API_BASE } from "@/context/AuthContext";
import { NoticePopupCard } from "@/components/common/NoticePopupCard";

// ─── 콜드런치 감지 플래그 ────────────────────────────────────────────────────
// 모듈 레벨 — 프로세스 재시작 시만 false로 초기화됨
let _coldLaunchProcessed = false;

// ─── API 공지 타입 ───────────────────────────────────────────────────────────
interface PendingNotice {
  id: string;
  title: string;
  content: string;
  notice_type: string;
  audience_scope: "global" | "pool";
  image_urls?: string[] | null;
  deep_link?: string | null;
  link_label?: string | null;
  starts_at?: string | null;
  created_at: string;
}

// ─── NoticePopup ──────────────────────────────────────────────────────────────
export function NoticePopup() {
  const { kind, token, isLoading } = useAuth();

  const [notice,  setNotice]  = useState<PendingNotice | null>(null);
  const [visible, setVisible] = useState(false);

  const fetchingRef  = useRef(false);
  // seen은 Modal onShow에서 1회만 기록 — re-render 중복 방지
  const seenFiredRef = useRef(false);

  // 콜드런치 여부 판단 → 미노출 공지 조회 → 표시
  //
  // ❗ isLoading 체크 필수:
  //   isLoading=true 동안 RootNav는 AppLoadingScreen을 렌더하고 실제 Stack이 없음.
  //   이 시점에 Modal.visible=true를 설정하면 AppLoadingScreen ViewController 위에
  //   Modal이 present되고, isLoading=false 후 AppLoadingScreen이 Stack으로 교체될 때
  //   Modal이 함께 사라진다(iOS UIKit: presenting VC dismiss → presented Modal도 dismiss).
  //   isLoading=false 이후에만 실행하면 Stack이 완전히 마운트된 상태에서 Modal이 열린다.
  const fetchAndShow = useCallback(async () => {
    if (!token || !kind || isLoading) return;
    if (_coldLaunchProcessed) return;
    if (fetchingRef.current) return;

    _coldLaunchProcessed = true;
    fetchingRef.current  = true;

    try {
      const res = await apiRequest(token, "/notices/pending");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      // 서버가 { notice: {...} } 또는 배열로 올 경우 모두 처리
      const item: PendingNotice | null =
        json?.notice ?? (Array.isArray(json) && json.length > 0 ? json[0] : null);

      if (item) {
        seenFiredRef.current = false; // 새 공지마다 seen 초기화
        setNotice(item);
        setVisible(true);
      }
    } catch (e) {
      // 공지 조회 실패 — 무시, 앱 정상 진입
      console.warn("[NoticePopup] 공지 조회 실패:", e);
    } finally {
      fetchingRef.current = false;
    }
  }, [token, kind, isLoading]);

  useEffect(() => { fetchAndShow(); }, [fetchAndShow]);

  // ── Modal onShow — 실제 표시 완료 후 seen 기록 ──────────────────────────
  function handleShow() {
    if (!token || !notice || seenFiredRef.current) return;
    seenFiredRef.current = true;
    apiRequest(token, `/notices/${notice.id}/seen`, { method: "POST" }).catch(() => {});
  }

  // ─── 닫기 ────────────────────────────────────────────────────────────────
  function handleClose() {
    setVisible(false);
  }

  if (!notice) return null;

  const imageUri =
    Array.isArray(notice.image_urls) && notice.image_urls.length > 0 && notice.image_urls[0]
      ? `${API_BASE.replace(/\/api$/, "")}/uploads/${notice.image_urls[0]}`
      : null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onShow={handleShow}
    >
      <View style={s.overlay}>
        <NoticePopupCard
          title={notice.title}
          content={notice.content}
          imageUri={imageUri}
          deepLink={notice.deep_link}
          linkLabel={notice.link_label}
          onClose={handleClose}
        />
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
});
