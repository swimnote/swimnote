/**
 * components/common/NoticePopupCard.tsx
 *
 * 순수 presentation 컴포넌트 — API 호출/상태 부작용 없음.
 * NoticePopup(실제 공지)과 (super)/notices.tsx 미리보기 양쪽에서 재사용.
 *
 * Props:
 *  - title, content: 공지 텍스트
 *  - imageUri: 로컬 URI 또는 원격 URL, null이면 미표시
 *  - deepLink: CTA 링크 URL, null이면 버튼 미표시
 *  - linkLabel: CTA 버튼 문구, 없으면 "자세히 보기"
 *  - onClose: 닫기/X 콜백
 *  - onLinkPress: 링크 탭 콜백 (default: Linking.openURL)
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useState } from "react";
import {
  Image, Linking, Pressable, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;
const P = "#7C3AED";

export interface NoticePopupCardProps {
  title: string;
  content: string;
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
  imageUri,
  deepLink,
  linkLabel,
  onClose,
  onLinkPress,
}: NoticePopupCardProps) {
  const [imgError, setImgError] = useState(false);

  const showImage = !imgError && !!imageUri;
  const hasLink   = isSafeUrl(deepLink);
  const ctaLabel  = linkLabel?.trim() || "자세히 보기";

  function handleLink() {
    if (!deepLink) return;
    if (onLinkPress) {
      onLinkPress(deepLink);
    } else {
      defaultOpenLink(deepLink);
    }
  }

  return (
    <View style={s.card}>

      {/* ── 헤더: 로고 + X ──────────────────────────────────── */}
      <View style={s.header}>
        <Image
          source={require("@/assets/images/swimnote-logo.png")}
          style={s.logo}
          resizeMode="contain"
        />
        <Pressable style={s.closeBtn} onPress={onClose} hitSlop={16}>
          <LucideIcon name="x" size={18} color={C.textSecondary} />
        </Pressable>
      </View>

      {/* ── 대표 이미지 (16:9) ──────────────────────────────── */}
      {showImage && (
        <Image
          source={{ uri: imageUri! }}
          style={s.image}
          resizeMode="cover"
          onError={() => setImgError(true)}
        />
      )}

      {/* ── 본문 스크롤 영역 ─────────────────────────────────── */}
      <ScrollView
        style={s.scrollArea}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scrollContent}
      >
        <Text style={s.title}>{title}</Text>
        <Text style={s.content}>{content}</Text>
      </ScrollView>

      {/* ── CTA 링크 버튼 ────────────────────────────────────── */}
      {hasLink && (
        <Pressable style={s.ctaBtn} onPress={handleLink}>
          <LucideIcon name="external-link" size={14} color={P} />
          <Text style={s.ctaTxt}>{ctaLabel}</Text>
        </Pressable>
      )}

      {/* ── 닫기 버튼 ─────────────────────────────────────────── */}
      <Pressable style={s.confirmBtn} onPress={onClose}>
        <Text style={s.confirmTxt}>닫기</Text>
      </Pressable>

    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderRadius: 20,
    width: "100%",
    overflow: "hidden",
  },
  /* ── 헤더 ── */
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  logo: {
    height: 20,
    width: 110,
  },
  closeBtn: {
    backgroundColor: "rgba(0,0,0,0.06)",
    borderRadius: 20,
    padding: 6,
  },
  /* ── 이미지 ── */
  image: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#F3F4F6",
  },
  /* ── 본문 ── */
  scrollArea: {
    maxHeight: 260,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 8,
  },
  title: {
    fontSize: 16,
    fontFamily: "Pretendard-SemiBold",
    color: C.textPrimary,
    marginBottom: 10,
    lineHeight: 24,
  },
  content: {
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
    color: C.textPrimary,
    lineHeight: 22,
  },
  /* ── CTA ── */
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
  /* ── 닫기 ── */
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
