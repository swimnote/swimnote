/**
 * components/common/NoticePopupCard.tsx
 *
 * 순수 presentation 컴포넌트 — API 호출/상태 부작용 없음.
 * NoticePopup(실제 공지)과 (super)/notices.tsx 미리보기 양쪽에서 재사용.
 *
 * Props:
 *  - title, content: 공지 텍스트
 *  - noticeType: "general" | "update" | "maintenance" | "special" — badge 표시
 *  - imageUri: 원격 URL, null이면 미표시
 *  - deepLink: CTA 링크 URL, null이면 버튼 미표시
 *  - linkLabel: CTA 버튼 문구, 없으면 "자세히 보기"
 *  - onClose: 닫기/X 콜백
 *  - onLinkPress: 링크 탭 콜백 (default: Linking.openURL)
 */
import React, { useState } from "react";
import {
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { NOTICE_TYPE_CFG } from "@/store/noticeStore";
import type { NoticeType } from "@/store/noticeStore";

// ── 브랜드 primary action 색상 (디자인 시스템 토큰)
const PRIMARY = "#1683A3";
// ── 텍스트 색상
const TEXT_PRIMARY   = "#1A2E35";
const TEXT_SECONDARY = "#526C78";

export interface NoticePopupCardProps {
  title: string;
  content: string;
  noticeType?: string | null;
  imageUri?: string | null;
  deepLink?: string | null;
  linkLabel?: string | null;
  onClose: () => void;
  onLinkPress?: (url: string) => void;
}

function isSafeUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

async function defaultOpenLink(url: string) {
  try {
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) await Linking.openURL(url);
  } catch {
    // crash 방지
  }
}

export function NoticePopupCard({
  title,
  content,
  noticeType,
  imageUri,
  deepLink,
  linkLabel,
  onClose,
  onLinkPress,
}: NoticePopupCardProps) {
  const { height: screenH } = useWindowDimensions();
  const [imgError, setImgError] = useState(false);

  const showImage = !imgError && !!imageUri;
  const hasLink   = isSafeUrl(deepLink);
  const ctaLabel  = linkLabel?.trim() || "자세히 보기";

  // badge 설정 — NOTICE_TYPE_CFG 재사용
  const validType   = (noticeType as NoticeType) ?? "general";
  const badgeCfg    = NOTICE_TYPE_CFG[validType] ?? null;

  // 카드 최대 높이: 화면의 88% — 작은 iPhone에서도 X/닫기 접근 가능
  const cardMaxH = screenH * 0.88;

  function handleLink() {
    if (!deepLink) return;
    if (onLinkPress) {
      onLinkPress(deepLink);
    } else {
      defaultOpenLink(deepLink);
    }
  }

  return (
    <View style={[s.card, { maxHeight: cardMaxH }]}>

      {/* ── 헤더: SWIMNOTE 로고 + X ─────────────────────────── */}
      <View style={s.header}>
        <View style={s.brand}>
          <Image
            source={require("@/assets/images/swimnote-logo.png")}
            style={s.logoIcon}
            resizeMode="contain"
          />
          <Text style={s.brandName}>SWIMNOTE</Text>
        </View>
        <Pressable style={s.closeBtn} onPress={onClose} hitSlop={12}>
          <LucideIcon name="x" size={16} color={TEXT_SECONDARY} />
        </Pressable>
      </View>

      {/* ── 대표 이미지 (16:9, 있을 때만) ──────────────────── */}
      {showImage && (
        <Image
          source={{ uri: imageUri! }}
          style={s.image}
          resizeMode="cover"
          onError={() => setImgError(true)}
        />
      )}

      {/* ── 스크롤 가능한 콘텐츠 영역 ──────────────────────── */}
      <ScrollView
        style={s.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scrollContent}
        bounces={false}
      >
        {/* 공지 유형 Badge */}
        {badgeCfg && (
          <View style={[s.badge, { backgroundColor: badgeCfg.bg }]}>
            <LucideIcon name={badgeCfg.icon as any} size={11} color={badgeCfg.color} />
            <Text style={[s.badgeText, { color: badgeCfg.color }]}>
              {badgeCfg.label}
            </Text>
          </View>
        )}

        {/* 제목 */}
        <Text style={s.title}>{title}</Text>

        {/* 본문 */}
        <Text style={s.body}>{content}</Text>
      </ScrollView>

      {/* ── 액션 영역 (스크롤 밖 — 항상 접근 가능) ─────────── */}
      <View style={s.actions}>
        {hasLink && (
          <Pressable
            style={({ pressed }) => [s.ctaBtn, pressed && s.ctaBtnPressed]}
            onPress={handleLink}
          >
            <LucideIcon name="external-link" size={14} color={PRIMARY} />
            <Text style={s.ctaText}>{ctaLabel}</Text>
          </Pressable>
        )}

        <Pressable
          style={({ pressed }) => [s.closeFullBtn, pressed && s.closeFullBtnPressed]}
          onPress={onClose}
        >
          <Text style={s.closeFullText}>닫기</Text>
        </Pressable>
      </View>

    </View>
  );
}

const s = StyleSheet.create({
  /* ── 카드 ── */
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    width: "100%",
    overflow: "hidden",
  },

  /* ── 헤더 ── */
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 14,
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  logoIcon: {
    width: 28,
    height: 28,
  },
  brandName: {
    fontSize: 14,
    fontFamily: "Pretendard-SemiBold",
    color: TEXT_PRIMARY,
    letterSpacing: 0.4,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(0,0,0,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },

  /* ── 이미지 ── */
  image: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#F3F4F6",
  },

  /* ── 스크롤 콘텐츠 ── */
  scroll: {
    flexShrink: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 4,
  },

  /* ── Badge ── */
  badge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    marginBottom: 12,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: "Pretendard-SemiBold",
    letterSpacing: 0.2,
  },

  /* ── 제목 ── */
  title: {
    fontSize: 18,
    fontFamily: "Pretendard-Bold",
    color: TEXT_PRIMARY,
    lineHeight: 26,
    marginBottom: 10,
  },

  /* ── 본문 ── */
  body: {
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
    color: TEXT_SECONDARY,
    lineHeight: 22,
    marginBottom: 4,
  },

  /* ── 액션 영역 ── */
  actions: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 18,
    gap: 8,
  },

  /* CTA 버튼 */
  ctaBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: PRIMARY,
    backgroundColor: "#EBF6FA",
  },
  ctaBtnPressed: {
    backgroundColor: "#D6EDF4",
  },
  ctaText: {
    fontSize: 14,
    fontFamily: "Pretendard-SemiBold",
    color: PRIMARY,
  },

  /* 닫기 버튼 */
  closeFullBtn: {
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: PRIMARY,
    alignItems: "center",
  },
  closeFullBtnPressed: {
    backgroundColor: "#116285",
  },
  closeFullText: {
    fontSize: 15,
    fontFamily: "Pretendard-SemiBold",
    color: "#FFFFFF",
  },
});
