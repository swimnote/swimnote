/**
 * branding.tsx — 수영장 브랜드 설정
 * 테마 색상, 로고 이모지, 로고 URL을 변경한다.
 * 저장 즉시 BrandContext가 업데이트되어 앱 전체에 반영된다.
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Platform,
} from "react-native";
import { useAuth, apiRequest } from "@/context/AuthContext";
import { useBrand, APP_PLATFORM_NAME, DEFAULT_THEME_COLOR } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

// ── 프리셋 색상 팔레트 ────────────────────────────────────────────────
const PALETTE = [
  { label: "스윔노트 기본", color: "#1A5CFF" },
  { label: "인디고",         color: "#4F46E5" },
  { label: "퍼플",           color: "#7C3AED" },
  { label: "핑크",           color: "#EC4899" },
  { label: "레드",           color: "#EF4444" },
  { label: "오렌지",         color: "#F97316" },
  { label: "골드",           color: "#D97706" },
  { label: "그린",           color: "#059669" },
  { label: "틸",             color: "#0D9488" },
  { label: "사이언",         color: "#0284C7" },
  { label: "슬레이트",       color: "#475569" },
  { label: "다크",           color: "#1F2937" },
];

// ── 수영장 테마 이모지 ───────────────────────────────────────────────
const EMOJI_LIST = [
  "🏊", "🌊", "💧", "🌀", "⭐", "🔵", "🐠",
  "🐬", "🐋", "🦈", "🌟", "💎", "🏅", "🎽",
  "🥇", "🌈", "🏆", "✨", "🎯", "🔷",
];

function isValidHex(v: string) {
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(v);
}

export default function BrandingScreen() {
  const { token, pool, refreshPool } = useAuth();
  const { themeColor: currentTheme, setBrand, poolName, logoEmoji: currentEmoji, logoUrl: currentLogoUrl } = useBrand();

  const [selectedColor, setSelectedColor] = useState(currentTheme ?? DEFAULT_THEME_COLOR);
  const [hexInput, setHexInput] = useState(currentTheme ?? DEFAULT_THEME_COLOR);
  const [selectedEmoji, setSelectedEmoji] = useState<string | null>(currentEmoji);
  const [logoUrl, setLogoUrl] = useState(currentLogoUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [hexError, setHexError] = useState("");

  // 화면 진입 시 최신 서버값 로드
  useEffect(() => {
    setSelectedColor(currentTheme ?? DEFAULT_THEME_COLOR);
    setHexInput(currentTheme ?? DEFAULT_THEME_COLOR);
    setSelectedEmoji(currentEmoji);
    setLogoUrl(currentLogoUrl ?? "");
  }, [currentTheme, currentEmoji, currentLogoUrl]);

  const handleHexChange = useCallback((v: string) => {
    const val = v.startsWith("#") ? v : `#${v}`;
    setHexInput(val);
    if (isValidHex(val)) {
      setSelectedColor(val);
      setHexError("");
    } else {
      setHexError("올바른 hex 코드를 입력하세요 (예: #1A5CFF)");
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!isValidHex(selectedColor)) {
      Alert.alert("입력 오류", "올바른 색상 코드를 선택해주세요."); return;
    }
    setSaving(true);
    try {
      const res = await apiRequest(token, "/pools/branding", {
        method: "PUT",
        body: JSON.stringify({
          theme_color: selectedColor,
          logo_emoji:  selectedEmoji ?? "",
          logo_url:    logoUrl.trim() || "",
        }),
      });
      const data = await res.json();
      if (!res.ok) { Alert.alert("오류", data.error ?? "저장 실패"); return; }

      // BrandContext 즉시 업데이트
      setBrand({
        themeColor: data.theme_color ?? selectedColor,
        logoEmoji:  data.logo_emoji  || null,
        logoUrl:    data.logo_url    || null,
      });
      // AuthContext pool 정보도 갱신
      await refreshPool();

      Alert.alert("저장 완료", "브랜드 설정이 적용되었습니다.");
    } catch (err) {
      Alert.alert("오류", "저장 중 문제가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }, [token, selectedColor, selectedEmoji, logoUrl, setBrand, refreshPool]);

  const handleReset = () => {
    Alert.alert("기본값으로 초기화", "스윔노트 기본 색상으로 되돌리시겠습니까?", [
      { text: "취소", style: "cancel" },
      {
        text: "초기화",
        onPress: () => {
          setSelectedColor(DEFAULT_THEME_COLOR);
          setHexInput(DEFAULT_THEME_COLOR);
          setSelectedEmoji(null);
          setLogoUrl("");
        },
      },
    ]);
  };

  return (
    <View style={styles.safe}>
      <SubScreenHeader
        title="브랜드 설정"
        onBack={undefined}
        rightSlot={
          <TouchableOpacity onPress={handleReset} hitSlop={8}>
            <Text style={[styles.resetBtn, { color: selectedColor }]}>초기화</Text>
          </TouchableOpacity>
        }
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── 실시간 미리보기 ─────────────────────────────────── */}
        <Section title="미리보기">
          <View style={styles.previewCard}>
            {/* 모의 헤더 */}
            <View style={styles.previewHeader}>
              <View style={[styles.previewBadge, { backgroundColor: selectedColor }]}>
                <Text style={styles.previewBadgeText}>
                  {selectedEmoji ?? (poolName?.slice(0, 1) ?? "S")}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.previewPoolName} numberOfLines={1}>
                  {pool?.name ?? "수영장 이름"}
                </Text>
                <Text style={[styles.previewPowered, { color: selectedColor }]}>
                  Powered by {APP_PLATFORM_NAME}
                </Text>
              </View>
            </View>
            {/* 모의 탭바 */}
            <View style={styles.previewTabBar}>
              {["대시보드", "회원", "출결"].map((tab, i) => (
                <View key={tab} style={styles.previewTab}>
                  <Feather
                    name={i === 0 ? "grid" : i === 1 ? "users" : "check-square"}
                    size={18}
                    color={i === 0 ? selectedColor : "#9CA3AF"}
                  />
                  <Text style={[styles.previewTabLabel, i === 0 && { color: selectedColor }]}>{tab}</Text>
                </View>
              ))}
            </View>
          </View>
          <Text style={styles.previewNote}>
            앱스토어·구글플레이 표시명: <Text style={{ fontFamily: "Inter_700Bold" }}>스윔노트</Text>
          </Text>
        </Section>

        {/* ── 테마 색상 팔레트 ────────────────────────────────── */}
        <Section title="테마 색상">
          <View style={styles.palette}>
            {PALETTE.map(({ color, label }) => (
              <TouchableOpacity
                key={color}
                onPress={() => {
                  setSelectedColor(color);
                  setHexInput(color);
                  setHexError("");
                }}
                style={[
                  styles.swatchWrap,
                  selectedColor === color && styles.swatchSelected,
                  selectedColor === color && { borderColor: color },
                ]}
                accessibilityLabel={label}
              >
                <View style={[styles.swatch, { backgroundColor: color }]} />
              </TouchableOpacity>
            ))}
          </View>

          {/* Hex 직접 입력 */}
          <View style={styles.hexRow}>
            <View style={[styles.hexPreview, { backgroundColor: isValidHex(hexInput) ? hexInput : "#eee" }]} />
            <TextInput
              style={[styles.hexInput, hexError ? { borderColor: "#EF4444" } : {}]}
              value={hexInput}
              onChangeText={handleHexChange}
              placeholder="#1A5CFF"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={7}
            />
          </View>
          {hexError ? <Text style={styles.hexError}>{hexError}</Text> : null}
          <Text style={styles.hint}>
            직접 브랜드 색상 코드(HEX)를 입력할 수 있습니다.
          </Text>
        </Section>

        {/* ── 로고 이모지 ─────────────────────────────────────── */}
        <Section title="로고 이모지">
          <Text style={styles.sectionDesc}>
            로고 이미지가 없을 때 이모지를 대신 표시합니다.
          </Text>
          <View style={styles.emojiGrid}>
            {/* 없음 선택 */}
            <TouchableOpacity
              onPress={() => setSelectedEmoji(null)}
              style={[
                styles.emojiCell,
                !selectedEmoji && { borderColor: selectedColor, borderWidth: 2 },
              ]}
            >
              <Text style={styles.emojiNone}>없음</Text>
            </TouchableOpacity>
            {EMOJI_LIST.map((em) => (
              <TouchableOpacity
                key={em}
                onPress={() => setSelectedEmoji(em === selectedEmoji ? null : em)}
                style={[
                  styles.emojiCell,
                  selectedEmoji === em && { borderColor: selectedColor, borderWidth: 2, backgroundColor: selectedColor + "18" },
                ]}
              >
                <Text style={styles.emoji}>{em}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Section>

        {/* ── 로고 URL ─────────────────────────────────────────── */}
        <Section title="로고 이미지 URL (선택)">
          <Text style={styles.sectionDesc}>
            외부 이미지 URL을 입력하면 이모지 대신 로고 이미지를 표시합니다.
          </Text>
          <TextInput
            style={styles.urlInput}
            value={logoUrl}
            onChangeText={setLogoUrl}
            placeholder="https://example.com/logo.png"
            placeholderTextColor="#9CA3AF"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={styles.hint}>
            정사각형 PNG/JPG 권장 (최소 128×128px)
          </Text>
        </Section>

        {/* ── 앱 아이콘 안내 ─────────────────────────────────── */}
        <Section title="앱 아이콘 커스터마이징">
          <View style={styles.infoBox}>
            <Feather name="info" size={16} color="#4F46E5" style={{ marginTop: 2 }} />
            <Text style={styles.infoText}>
              앱스토어·구글플레이에서 다운로드되는 앱 아이콘은 항상 스윔노트 기본 아이콘으로 표시됩니다.{"\n\n"}
              수영장별 아이콘 변경은 별도의 화이트라벨 빌드가 필요하며, 엔터프라이즈 플랜에서 지원됩니다. 문의: support@swimnote.kr
            </Text>
          </View>
        </Section>

        {/* ── 저장 버튼 ─────────────────────────────────────── */}
        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: selectedColor }, saving && { opacity: 0.7 }]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.saveBtnText}>변경사항 저장</Text>
          }
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ── 섹션 래퍼 ─────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: "#F8FAFF" },
  header:          { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  headerTitle:     { flex: 1, textAlign: "center", fontSize: 16, fontFamily: "Inter_700Bold", color: "#111827" },
  resetBtn:        { fontSize: 14, fontFamily: "Inter_500Medium" },
  content:         { padding: 16, gap: 8, paddingBottom: 100 },

  section:         { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 12, gap: 12 },
  sectionTitle:    { fontSize: 13, fontFamily: "Inter_700Bold", color: "#6B7280", letterSpacing: 0.5, textTransform: "uppercase" },
  sectionDesc:     { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6B7280", lineHeight: 18 },

  // 미리보기
  previewCard:     { borderRadius: 12, borderWidth: 1, borderColor: "#E5E7EB", overflow: "hidden", backgroundColor: "#fff" },
  previewHeader:   { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  previewBadge:    { width: 32, height: 32, borderRadius: 8, justifyContent: "center", alignItems: "center" },
  previewBadgeText:{ color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  previewPoolName: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#111827" },
  previewPowered:  { fontSize: 10, fontFamily: "Inter_500Medium", marginTop: 1 },
  previewTabBar:   { flexDirection: "row", backgroundColor: "#fff" },
  previewTab:      { flex: 1, alignItems: "center", paddingVertical: 10, gap: 3 },
  previewTabLabel: { fontSize: 10, fontFamily: "Inter_500Medium", color: "#9CA3AF" },
  previewNote:     { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", textAlign: "center" },

  // 팔레트
  palette:         { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  swatchWrap:      { width: 40, height: 40, borderRadius: 12, padding: 3, borderWidth: 2, borderColor: "transparent" },
  swatchSelected:  { borderWidth: 2 },
  swatch:          { flex: 1, borderRadius: 9 },

  // Hex 입력
  hexRow:          { flexDirection: "row", alignItems: "center", gap: 10 },
  hexPreview:      { width: 36, height: 36, borderRadius: 8, borderWidth: 1, borderColor: "#E5E7EB" },
  hexInput:        { flex: 1, height: 40, borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 8, paddingHorizontal: 12, fontFamily: "Inter_500Medium", fontSize: 14, color: "#111827" },
  hexError:        { fontSize: 12, color: "#EF4444", fontFamily: "Inter_400Regular" },
  hint:            { fontSize: 12, color: "#9CA3AF", fontFamily: "Inter_400Regular" },

  // 이모지
  emojiGrid:       { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  emojiCell:       { width: 48, height: 48, borderRadius: 10, justifyContent: "center", alignItems: "center", backgroundColor: "#F3F4F6", borderWidth: 2, borderColor: "transparent" },
  emoji:           { fontSize: 24 },
  emojiNone:       { fontSize: 11, color: "#9CA3AF", fontFamily: "Inter_500Medium" },

  // URL 입력
  urlInput:        { height: 44, borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 8, paddingHorizontal: 12, fontFamily: "Inter_400Regular", fontSize: 14, color: "#111827" },

  // 안내 박스
  infoBox:         { flexDirection: "row", gap: 10, backgroundColor: "#EDE9FE", borderRadius: 10, padding: 12 },
  infoText:        { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#4C1D95", lineHeight: 20 },

  // 저장 버튼
  saveBtn:         { height: 52, borderRadius: 14, justifyContent: "center", alignItems: "center", marginTop: 4 },
  saveBtnText:     { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },
});
