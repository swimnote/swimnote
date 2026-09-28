/**
 * components/common/NoticePopup.tsx — V2 운영형 공지 팝업
 *
 * ─ 정책 ────────────────────────────────────────────────────────────────────
 * 1. 콜드런치(프로세스 재시작) 1회만 실행
 * 2. 서버 기준 사용자별 1회 노출 (notice_dismissals 테이블)
 * 3. 팝업 표시 즉시 POST /notices/:id/seen (fire & forget, 실패 무시)
 * 4. 미노출 공지 중 최신 1개만 표시 (서버에서 LIMIT 1 반환)
 * 5. "다시 보지 않기" 없음 — X / 닫기 버튼만
 * 6. 이미지, CTA 링크 선택 표시
 * 7. 모든 오류 fail-safe — 앱 진입 차단 금지
 *
 * ─ 대상 역할 ────────────────────────────────────────────────────────────────
 * GET /notices/pending — 모든 역할 (pool_admin, teacher, parent_account 등)
 * 서버에서 role 필터링 + seen 필터링 + starts_at 필터링 처리
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Image, Linking, Modal, Pressable, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { useAuth, apiRequest, API_BASE } from "@/context/AuthContext";
import Colors from "@/constants/colors";

const C = Colors.light;
const P = "#7C3AED";

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

// ─── URL 안전 검사 ────────────────────────────────────────────────────────────
function isSafeUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

async function openLink(url: string) {
  try {
    if (!isSafeUrl(url)) return;
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) await Linking.openURL(url);
  } catch {
    // crash 방지 — 오류 무시
  }
}

// ─── NoticePopup ──────────────────────────────────────────────────────────────
export function NoticePopup() {
  const { kind, token } = useAuth();

  const [notice,  setNotice]  = useState<PendingNotice | null>(null);
  const [visible, setVisible] = useState(false);
  const [imgError, setImgError] = useState(false);

  const fetchingRef = useRef(false);

  // 콜드런치 여부 판단 → 미노출 공지 조회 → 표시
  const fetchAndShow = useCallback(async () => {
    if (!token || !kind) return;
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
        setNotice(item);
        setImgError(false);
        setVisible(true);

        // ── seen 기록 (fire & forget) ────────────────────────────────────
        apiRequest(token, `/notices/${item.id}/seen`, { method: "POST" }).catch(() => {});
      }
    } catch (e) {
      // 공지 조회 실패 — 무시, 앱 정상 진입
      console.warn("[NoticePopup] 공지 조회 실패:", e);
    } finally {
      fetchingRef.current = false;
    }
  }, [token, kind]);

  useEffect(() => { fetchAndShow(); }, [fetchAndShow]);

  // ─── 닫기 ────────────────────────────────────────────────────────────────
  function handleClose() {
    setVisible(false);
  }

  if (!notice) return null;

  const imageUrl =
    !imgError &&
    Array.isArray(notice.image_urls) &&
    notice.image_urls.length > 0 &&
    notice.image_urls[0]
      ? `${API_BASE.replace(/\/api$/, "")}/uploads/${notice.image_urls[0]}`
      : null;

  const hasLink = isSafeUrl(notice.deep_link);
  const ctaLabel = notice.link_label?.trim() || "자세히 보기";

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={s.overlay}>
        <View style={s.card}>

          {/* X 버튼 — 우측 상단 */}
          <Pressable style={s.closeBtn} onPress={handleClose} hitSlop={16}>
            <LucideIcon name="x" size={18} color={C.textSecondary} />
          </Pressable>

          {/* 대표 이미지 */}
          {imageUrl && (
            <Image
              source={{ uri: imageUrl }}
              style={s.image}
              resizeMode="cover"
              onError={() => setImgError(true)}
            />
          )}

          {/* 본문 스크롤 영역 */}
          <ScrollView
            style={s.scrollArea}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={s.scrollContent}
          >
            <Text style={s.title}>{notice.title}</Text>
            <Text style={s.content}>{notice.content}</Text>
          </ScrollView>

          {/* CTA 링크 버튼 */}
          {hasLink && (
            <Pressable
              style={s.ctaBtn}
              onPress={() => openLink(notice.deep_link!)}
            >
              <LucideIcon name="external-link" size={14} color={P} />
              <Text style={s.ctaTxt}>{ctaLabel}</Text>
            </Pressable>
          )}

          {/* 닫기 버튼 */}
          <Pressable style={s.confirmBtn} onPress={handleClose}>
            <Text style={s.confirmTxt}>닫기</Text>
          </Pressable>

        </View>
      </View>
    </Modal>
  );
}

// ─── 스타일 ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: C.surface,
    borderRadius: 20,
    width: "100%",
    maxWidth: 400,
    maxHeight: "85%",
    overflow: "hidden",
  },
  closeBtn: {
    position: "absolute",
    top: 14,
    right: 14,
    zIndex: 10,
    backgroundColor: "rgba(0,0,0,0.06)",
    borderRadius: 20,
    padding: 6,
  },
  image: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#F3F4F6",
  },
  scrollArea: {
    maxHeight: 280,
  },
  scrollContent: {
    padding: 24,
    paddingTop: 28, // X 버튼과 겹치지 않게
    paddingBottom: 8,
  },
  title: {
    fontSize: 18,
    fontFamily: "Pretendard-SemiBold",
    color: C.textPrimary,
    marginBottom: 12,
    lineHeight: 26,
  },
  content: {
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
    color: C.textPrimary,
    lineHeight: 22,
  },
  ctaBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 10,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: P,
    backgroundColor: "#F5F0FF",
  },
  ctaTxt: {
    fontSize: 14,
    fontFamily: "Pretendard-SemiBold",
    color: P,
  },
  confirmBtn: {
    marginHorizontal: 16,
    marginBottom: 16,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: P,
    alignItems: "center",
  },
  confirmTxt: {
    fontSize: 14,
    fontFamily: "Pretendard-SemiBold",
    color: "#fff",
  },
});
