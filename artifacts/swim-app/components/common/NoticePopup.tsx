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

  // ── mount / unmount 진단 ──────────────────────────────────────────────────
  useEffect(() => {
    console.log("[NP] NOTICE_POPUP_MOUNT");
    return () => { console.log("[NP] NOTICE_POPUP_UNMOUNT"); };
  }, []);

  // ── token / kind / isLoading 변화 진단 ───────────────────────────────────
  useEffect(() => {
    console.log(
      "[NP] NOTICE_POPUP_READY",
      "role=" + (kind ?? "null"),
      "loading=" + isLoading,
      "token=" + !!token,
      "coldLock=" + _coldLaunchProcessed,
    );
  }, [token, kind, isLoading]);

  // 콜드런치 여부 판단 → 미노출 공지 조회 → 표시
  //
  // ❗ isLoading 체크 필수:
  //   isLoading=true 동안 RootNav는 AppLoadingScreen을 렌더하고 실제 Stack이 없음.
  //   이 시점에 Modal.visible=true를 설정하면 AppLoadingScreen ViewController 위에
  //   Modal이 present되고, isLoading=false 후 AppLoadingScreen이 Stack으로 교체될 때
  //   Modal이 함께 사라진다(iOS UIKit: presenting VC dismiss → presented Modal도 dismiss).
  //   isLoading=false 이후에만 실행하면 Stack이 완전히 마운트된 상태에서 Modal이 열린다.
  const fetchAndShow = useCallback(async () => {
    if (!token || !kind || isLoading) {
      console.log(
        "[NP] NOTICE_PENDING_SKIP",
        "token=" + !!token,
        "kind=" + (kind ?? "null"),
        "isLoading=" + isLoading,
      );
      return;
    }
    if (_coldLaunchProcessed) {
      console.log("[NP] NOTICE_PENDING_SKIP coldLock=true");
      return;
    }
    if (fetchingRef.current) {
      console.log("[NP] NOTICE_PENDING_SKIP fetching=true");
      return;
    }

    _coldLaunchProcessed = true;
    fetchingRef.current  = true;
    console.log("[NP] NOTICE_PENDING_REQUEST role=" + kind);

    try {
      const res = await apiRequest(token, "/notices/pending");
      console.log("[NP] NOTICE_PENDING_STATUS", res.status);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      // 서버가 { notice: {...} } 또는 배열로 올 경우 모두 처리
      const item: PendingNotice | null =
        json?.notice ?? (Array.isArray(json) && json.length > 0 ? json[0] : null);

      console.log("[NP] NOTICE_PENDING_COUNT hasNotice=" + !!item);

      if (item) {
        seenFiredRef.current = false; // 새 공지마다 seen 초기화
        console.log("[NP] NOTICE_PENDING_SELECTED id=" + item.id);
        setNotice(item);
        setVisible(true);
        console.log("[NP] NOTICE_VISIBLE_SET true");
      }
    } catch (e) {
      // 공지 조회 실패 — 무시, 앱 정상 진입
      console.warn("[NP] NOTICE_POPUP_ERROR", String(e));
    } finally {
      fetchingRef.current = false;
    }
  }, [token, kind, isLoading]);

  useEffect(() => { fetchAndShow(); }, [fetchAndShow]);

  // ── Modal onShow — 실제 표시 완료 후 seen 기록 ──────────────────────────
  function handleShow() {
    console.log("[NP] NOTICE_MODAL_ONSHOW");
    if (!token || !notice || seenFiredRef.current) return;
    seenFiredRef.current = true;
    console.log("[NP] NOTICE_SEEN_REQUEST id=" + notice.id);
    apiRequest(token, `/notices/${notice.id}/seen`, { method: "POST" })
      .then(r => { console.log("[NP] NOTICE_SEEN_STATUS", r.status); })
      .catch(e  => { console.warn("[NP] NOTICE_SEEN_ERROR", String(e)); });
  }

  // ─── 닫기 ─────────────────────────────────────────────────────────────────
  // seen과 독립적으로 즉시 실행 — 네트워크 상태 무관.
  // setVisible(false) + setNotice(null): Modal이 render tree에서 완전히 제거돼
  // iOS native overlay가 확실히 해제되도록 notice를 null로 초기화.
  function handleClose() {
    console.log("[NP] NOTICE_CLOSE_PRESS");
    setVisible(false);
    console.log("[NP] NOTICE_VISIBLE_SET_FALSE");
    setNotice(null);
  }

  if (!notice) return null;

  console.log("[NP] NOTICE_MODAL_RENDER visible=" + visible);

  // image_urls[0]을 표시 URL로 변환 — admin/teacher/parent 공지함과 동일한 계약:
  // API_BASE/uploads/${encodeURIComponent(key)}
  const imageUri =
    Array.isArray(notice.image_urls) && notice.image_urls.length > 0 && notice.image_urls[0]
      ? `${API_BASE}/uploads/${encodeURIComponent(notice.image_urls[0])}`
      : null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onShow={handleShow}
      onDismiss={() => { console.log("[NP] NOTICE_MODAL_ONDISMISS"); }}
      onRequestClose={handleClose}
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
