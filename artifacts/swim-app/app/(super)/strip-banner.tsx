/**
 * (super)/strip-banner.tsx — 가로 프로모션 배너 관리 V2
 *
 * - 1 row = 1 slide (기존 platform_banners 구조 그대로)
 * - 최대 4개 슬라이드 (active + scheduled 기준)
 * - 실제 16:5 비율 미리보기
 * - TEXT / IMAGE 타입 선택
 * - IMAGE: expo-image-picker aspect:[16,5] allowsEditing:true
 * - sort_order로 순서 관리 (← → 버튼)
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Dimensions, FlatList, Image,
  Modal, Pressable, StyleSheet, Text, TextInput, View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { compressImageIfNeeded } from "../../utils/compressImage";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { LucideIcon } from "@/components/common/LucideIcon";
import { useAdsStore, type Ad, type AdStatus } from "@/store/adsStore";
import { useAuth, API_BASE } from "@/context/AuthContext";
import Colors from "@/constants/colors";
import {
  parseBannerTheme, autoTextColor, isValidHex, contrastRatio,
  serializeCustomTheme, BANNER_PRESET_ACCENTS, BANNER_PRESET_KEYS,
} from "@/lib/bannerTheme";

const C = Colors.light;
const P = "#7C3AED";

const SCREEN_W = Dimensions.get("window").width;
// 모달 내부 패딩 40 (양쪽 20씩)
const MODAL_INNER_W = SCREEN_W - 40;
const PREVIEW_H = Math.round(MODAL_INNER_W / (16 / 5));

const MAX_SLIDES = 4;
const TITLE_MAX = 30;
const DESC_MAX  = 60;

const STATUS_CFG: Record<AdStatus, { label: string; dot: string; badge: string }> = {
  active:    { label: "노출 중", dot: "#22C55E", badge: "#DCFCE7" },
  scheduled: { label: "예약됨", dot: "#D97706", badge: "#FEF9C3" },
  inactive:  { label: "비활성", dot: C.textMuted, badge: C.backgroundSoft },
};

// 프리셋 칩 accent (Super Admin UI 전용, banner 렌더링에는 parseBannerTheme 사용)
const THEME_COLORS = BANNER_PRESET_ACCENTS;
const THEME_BG: Record<string, string> = {
  teal: "#EEF9FB", purple: "#EDE9FE", orange: "#FFF7ED",
  blue: "#DBEAFE", green: "#D1FAE5", red: "#FEE2E2", pink: "#FCE7F3",
};

type BannerType = "text" | "image";

type ColorMode = "preset" | "custom";

interface FormState {
  bannerType: BannerType;
  title: string;
  description: string;
  linkUrl: string;
  displayStart: string;
  displayEnd: string;
  status: AdStatus;
  colorTheme: string;   // preset name 또는 "custom:#BG:#TEXT" (저장 형식)
  colorMode: ColorMode; // UI 선택 상태 (저장 전 임시)
  customBg: string;     // custom 배경 HEX (#RRGGBB)
  customText: string;   // custom 글자 HEX (#RRGGBB)
  // image
  imageUri: string;   // 로컬 선택된 uri (업로드 전)
  imageKey: string;   // 업로드 완료된 R2 key
  imageUrl: string;   // 기존 image_url
  displayUrl: string; // 서버에서 내려온 display_url
}

function blankForm(): FormState {
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  return {
    bannerType: "text",
    title: "", description: "", linkUrl: "",
    displayStart: today, displayEnd: future,
    status: "inactive", colorTheme: "teal",
    colorMode: "preset", customBg: "#1B3A5C", customText: "#FFFFFF",
    imageUri: "", imageKey: "", imageUrl: "", displayUrl: "",
  };
}

function adToForm(ad: Ad): FormState {
  const hasImage = !!(ad.imageKey || ad.imageUrl);
  const isCustom = ad.colorTheme?.startsWith("custom:");
  let customBg = "#1B3A5C";
  let customText = "#FFFFFF";
  if (isCustom) {
    const parts = ad.colorTheme.split(":");
    customBg   = parts[1] ?? "#1B3A5C";
    customText = parts[2] ?? "#FFFFFF";
  }
  return {
    bannerType: hasImage ? "image" : "text",
    title: ad.title,
    description: ad.description,
    linkUrl: ad.linkUrl,
    displayStart: ad.displayStart.slice(0, 10),
    displayEnd: ad.displayEnd.slice(0, 10),
    status: ad.status,
    colorTheme: isCustom ? ad.colorTheme : ad.colorTheme,
    colorMode: isCustom ? "custom" : "preset",
    customBg,
    customText,
    imageUri: "",
    imageKey: ad.imageKey,
    imageUrl: ad.imageUrl,
    displayUrl: (ad as any).displayUrl ?? "",
  };
}

// 미리보기: 실제 ParentPromoStrip과 동일한 렌더러
function BannerPreview({ form }: { form: FormState }) {
  const imgUri = form.imageUri
    ? form.imageUri
    : (form.displayUrl || (form.imageKey ? `${API_BASE}/uploads/${form.imageKey}` : form.imageUrl) || "");

  // 색상 해석 — colorMode="custom"이면 현재 입력값 직접 사용 (저장 전 실시간 반영)
  const effectiveTheme = form.colorMode === "custom"
    ? serializeCustomTheme(
        isValidHex(form.customBg)   ? form.customBg   : "#1B3A5C",
        isValidHex(form.customText) ? form.customText : "#FFFFFF",
      )
    : form.colorTheme;
  const th = parseBannerTheme(effectiveTheme);

  if (form.bannerType === "image" && imgUri) {
    return (
      <Image
        source={{ uri: imgUri }}
        style={[pv.box, { height: PREVIEW_H }]}
        resizeMode="cover"
      />
    );
  }
  if (form.bannerType === "image" && !imgUri) {
    return (
      <View style={[pv.box, pv.placeholder, { height: PREVIEW_H }]}>
        <LucideIcon name="image" size={28} color="#CBD5E1" />
        <Text style={pv.placeholderTxt}>이미지를 선택하세요</Text>
      </View>
    );
  }
  return (
    <View style={[pv.box, pv.textBox, { height: PREVIEW_H, backgroundColor: th.backgroundColor }]}>
      <Text style={[pv.title, { color: th.textColor }]} numberOfLines={2}>
        {form.title || "제목을 입력하세요"}
      </Text>
      {!!form.description && (
        <Text style={[pv.desc, { color: th.textColor }]} numberOfLines={2}>
          {form.description}
        </Text>
      )}
    </View>
  );
}

const pv = StyleSheet.create({
  box:          { width: "100%", borderRadius: 10, overflow: "hidden" },
  placeholder:  { backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: "#E2E8F0" },
  placeholderTxt:{ fontSize: 12, color: "#94A3B8", fontFamily: "Pretendard-Regular" },
  textBox:      { alignItems: "center", justifyContent: "center", paddingHorizontal: 18, paddingVertical: 14, gap: 6, borderWidth: 1, borderColor: "#CBD5E1" },
  title:        { fontSize: 13, fontFamily: "Pretendard-SemiBold", lineHeight: 19, textAlign: "center" },
  desc:         { fontSize: 12, fontFamily: "Pretendard-Regular", lineHeight: 17, textAlign: "center", opacity: 0.8 },
});

// 슬라이드 탭 컴포넌트
function SlideTab({ index, ad, selected, onPress }: {
  index: number; ad: Ad | null; selected: boolean; onPress: () => void;
}) {
  const hasImg = !!(ad?.imageKey || ad?.imageUrl || (ad as any)?.displayUrl);
  const cfg = ad ? STATUS_CFG[ad.status] : null;
  return (
    <Pressable onPress={onPress} style={[st.tab, selected && st.tabSelected]}>
      {ad ? (
        <>
          <View style={[st.statusDot, { backgroundColor: cfg?.dot ?? "#CBD5E1" }]} />
          <Text style={[st.tabNum, selected && st.tabNumSelected]}>
            {index + 1}
          </Text>
          <LucideIcon name={hasImg ? "image" : "type"} size={10} color={selected ? "#fff" : C.textMuted} />
        </>
      ) : (
        <Text style={[st.tabNum, { color: C.textMuted }]}>+</Text>
      )}
    </Pressable>
  );
}

const st = StyleSheet.create({
  tab:          { width: 44, height: 44, borderRadius: 10, backgroundColor: C.backgroundSoft, alignItems: "center", justifyContent: "center", gap: 2 },
  tabSelected:  { backgroundColor: P },
  tabNum:       { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  tabNumSelected:{ color: "#fff" },
  statusDot:    { width: 5, height: 5, borderRadius: 3 },
});

export default function StripBannerScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();

  const stripAds     = useAdsStore(s => s.stripAds);
  const loading      = useAdsStore(s => s.loading);
  const fetchBanners = useAdsStore(s => s.fetchBanners);
  const uploadImage  = useAdsStore(s => s.uploadImage);
  const createAd     = useAdsStore(s => s.createAd);
  const updateAd     = useAdsStore(s => s.updateAd);
  const setStatus    = useAdsStore(s => s.setStatus);
  const deleteAd     = useAdsStore(s => s.deleteAd);

  useEffect(() => { if (token) fetchBanners(token, "strip"); }, [token]);

  // sort_order 기준 정렬
  const sortedAds = useMemo(
    () => [...stripAds].sort((a, b) => a.sortOrder - b.sortOrder),
    [stripAds],
  );

  // 활성/예약 중인 슬라이드 수 (최대 4개 기준)
  const activeCount = useMemo(
    () => sortedAds.filter(a => a.status === "active" || a.status === "scheduled").length,
    [sortedAds],
  );

  const [showModal, setShowModal] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);      // 편집 중인 슬라이드 index
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(blankForm());
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [titleErr, setTitleErr] = useState<string | null>(null);

  // 현재 선택된 슬라이드 (미리보기용)
  const selectedAd = sortedAds[selectedIdx] ?? null;

  function openEdit(ad: Ad, idx: number) {
    setEditId(ad.id);
    setSelectedIdx(idx);
    setForm(adToForm(ad));
    setTitleErr(null);
    setShowModal(true);
  }

  function openCreate() {
    if (activeCount >= MAX_SLIDES) {
      Alert.alert("슬라이드 최대", `가로 배너는 최대 ${MAX_SLIDES}개까지 등록할 수 있습니다.`);
      return;
    }
    setEditId(null);
    setForm(blankForm());
    setTitleErr(null);
    setShowModal(true);
  }

  async function handlePickImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("권한 필요", "사진 라이브러리 접근 권한이 필요합니다.");
      return;
    }
    // expo-image-picker v55+: aspect [16,5] + allowsEditing → iOS에서 crop 지원
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [16, 5],
      quality: 0.9,
    });
    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      const uri = await compressImageIfNeeded(asset.uri, asset.fileSize ?? undefined);
      setForm(f => ({ ...f, imageUri: uri, imageKey: "", imageUrl: "", displayUrl: "" }));
    }
  }

  async function handleSave() {
    if (!token) return;

    // IMAGE 타입 검증
    if (form.bannerType === "image") {
      const hasImage = form.imageUri || form.imageKey || form.imageUrl || form.displayUrl;
      if (!hasImage) {
        Alert.alert("이미지 필요", "이미지를 선택해주세요.");
        return;
      }
    } else {
      // TEXT 타입 검증
      if (!form.title.trim()) { setTitleErr("제목을 입력해주세요."); return; }
      if (form.title.length > TITLE_MAX) { setTitleErr(`제목은 최대 ${TITLE_MAX}자입니다.`); return; }
    }
    setTitleErr(null);
    setSaving(true);

    try {
      let finalKey = form.imageKey;
      let finalUrl = form.imageUrl;

      if (form.bannerType === "image" && form.imageUri) {
        setUploading(true);
        const uploaded = await uploadImage(token, form.imageUri, `strip_${Date.now()}.jpg`, "image/jpeg");
        setUploading(false);
        if (!uploaded) {
          Alert.alert("업로드 실패", "이미지 업로드에 실패했습니다. 다시 시도해주세요.");
          setSaving(false);
          return;
        }
        finalKey = uploaded.key;
        finalUrl = uploaded.url;
      }

      // custom 색상 검증 (TEXT 배너 + custom 모드일 때)
      const isImage = form.bannerType === "image";
      if (!isImage && form.colorMode === "custom") {
        if (!isValidHex(form.customBg)) {
          Alert.alert("색상 오류", "배경색을 올바른 HEX 형식으로 입력해주세요.\n예: #163A5F");
          setSaving(false);
          return;
        }
        if (!isValidHex(form.customText)) {
          Alert.alert("색상 오류", "글자색을 올바른 HEX 형식으로 입력해주세요.\n예: #FFFFFF");
          setSaving(false);
          return;
        }
      }

      // colorTheme 최종값 — custom 모드면 직렬화
      const finalColorTheme = (!isImage && form.colorMode === "custom")
        ? serializeCustomTheme(form.customBg, form.customText)
        : form.colorTheme;

      // IMAGE 타입이면 텍스트 필드 비움, TEXT 타입이면 이미지 필드 비움
      const params = {
        bannerType:   "strip" as const,
        title:        isImage ? (form.title.trim() || "배너") : form.title.trim(),
        description:  isImage ? "" : form.description.trim(),
        imageKey:     isImage ? finalKey : "",
        imageUrl:     isImage ? finalUrl : "",
        colorTheme:   finalColorTheme,
        linkUrl:      form.linkUrl.trim(),
        linkLabel:    "",
        status:       form.status,
        target:       "all" as const,
        displayStart: new Date(form.displayStart).toISOString(),
        displayEnd:   new Date(form.displayEnd).toISOString(),
        sortOrder:    editId
          ? (sortedAds.find(a => a.id === editId)?.sortOrder ?? 0)
          : sortedAds.length,
      };

      if (editId) {
        await updateAd(token, editId, params);
      } else {
        await createAd(token, params);
      }
      setShowModal(false);
      await fetchBanners(token, "strip");
    } finally {
      setSaving(false);
      setUploading(false);
    }
  }

  // 순서 이동: sort_order swap
  async function moveSlide(idx: number, dir: -1 | 1) {
    if (!token) return;
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= sortedAds.length) return;
    const a = sortedAds[idx];
    const b = sortedAds[targetIdx];
    await Promise.all([
      updateAd(token, a.id, { sortOrder: b.sortOrder }),
      updateAd(token, b.id, { sortOrder: a.sortOrder }),
    ]);
    await fetchBanners(token, "strip");
    setSelectedIdx(targetIdx);
  }

  async function handleDelete(id: string) {
    if (!token) return;
    await deleteAd(token, id);
    setDeleteConfirm(null);
    await fetchBanners(token, "strip");
    setSelectedIdx(0);
  }

  const selectedForm = selectedAd ? adToForm(selectedAd) : blankForm();

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="가로 배너 관리" homePath="/(super)/dashboard" />

      <KeyboardAwareScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      >
        {/* ── 실시간 미리보기 ─────────────────────────────────── */}
        <View style={s.previewSection}>
          <Text style={s.sectionLabel}>현재 선택된 슬라이드 미리보기</Text>
          <BannerPreview form={selectedAd ? adToForm(selectedAd) : blankForm()} />
        </View>

        {/* ── 슬라이드 탭 ─────────────────────────────────────── */}
        <View style={s.tabSection}>
          <View style={s.tabRow}>
            {[0, 1, 2, 3].map(i => {
              const ad = sortedAds[i] ?? null;
              return (
                <SlideTab
                  key={i}
                  index={i}
                  ad={ad}
                  selected={selectedIdx === i && !!ad}
                  onPress={() => {
                    if (ad) setSelectedIdx(i);
                    else openCreate();
                  }}
                />
              );
            })}
          </View>
          <Text style={s.tabHint}>
            {sortedAds.length}/{MAX_SLIDES}개 등록됨 · 탭을 눌러 선택, + 눌러 추가
          </Text>
        </View>

        {/* ── 선택된 슬라이드 액션 ────────────────────────────── */}
        {selectedAd ? (
          <View style={s.actionSection}>
            {/* 상태 배지 */}
            <View style={[s.statusBadge, { backgroundColor: STATUS_CFG[selectedAd.status].badge }]}>
              <View style={[s.statusDot, { backgroundColor: STATUS_CFG[selectedAd.status].dot }]} />
              <Text style={[s.statusLabel, { color: STATUS_CFG[selectedAd.status].dot }]}>
                {STATUS_CFG[selectedAd.status].label}
              </Text>
            </View>

            {/* 순서 + 편집/삭제 */}
            <View style={s.actionRow}>
              <Pressable
                style={[s.orderBtn, selectedIdx === 0 && s.btnDisabled]}
                onPress={() => moveSlide(selectedIdx, -1)}
                disabled={selectedIdx === 0}
              >
                <LucideIcon name="chevron-left" size={16} color={selectedIdx === 0 ? C.textMuted : C.textPrimary} />
              </Pressable>
              <Pressable
                style={[s.orderBtn, selectedIdx >= sortedAds.length - 1 && s.btnDisabled]}
                onPress={() => moveSlide(selectedIdx, 1)}
                disabled={selectedIdx >= sortedAds.length - 1}
              >
                <LucideIcon name="chevron-right" size={16} color={selectedIdx >= sortedAds.length - 1 ? C.textMuted : C.textPrimary} />
              </Pressable>

              <Pressable style={s.editBtn} onPress={() => openEdit(selectedAd, selectedIdx)}>
                <LucideIcon name="pencil" size={14} color={P} />
                <Text style={s.editBtnTxt}>수정</Text>
              </Pressable>

              {selectedAd.status !== "active" ? (
                <Pressable style={s.activateBtn}
                  onPress={() => token && setStatus(token, selectedAd.id, "active")}>
                  <Text style={s.activateTxt}>노출 시작</Text>
                </Pressable>
              ) : (
                <Pressable style={s.pauseBtn}
                  onPress={() => token && setStatus(token, selectedAd.id, "inactive")}>
                  <Text style={s.pauseTxt}>중지</Text>
                </Pressable>
              )}

              <Pressable style={s.deleteBtn} onPress={() => setDeleteConfirm(selectedAd.id)}>
                <LucideIcon name="trash-2" size={14} color="#DC2626" />
              </Pressable>
            </View>

            {/* 날짜 */}
            <Text style={s.dateTxt}>
              {selectedAd.displayStart.slice(0, 10)} ~ {selectedAd.displayEnd.slice(0, 10)}
            </Text>
          </View>
        ) : (
          <View style={s.emptySection}>
            <LucideIcon name="image-plus" size={36} color="#CBD5E1" />
            <Text style={s.emptyTxt}>슬라이드를 추가해 학부모 홈에 배너를 노출하세요</Text>
            <Pressable style={s.addBtnLarge} onPress={openCreate}>
              <LucideIcon name="plus" size={16} color="#fff" />
              <Text style={s.addBtnTxt}>첫 슬라이드 추가</Text>
            </Pressable>
          </View>
        )}

        {/* ── 전체 목록 요약 ───────────────────────────────────── */}
        {sortedAds.length > 0 && (
          <View style={s.listSection}>
            <Text style={s.sectionLabel}>전체 슬라이드 목록</Text>
            {sortedAds.map((ad, i) => (
              <Pressable key={ad.id} style={[s.listRow, selectedIdx === i && s.listRowSelected]}
                onPress={() => setSelectedIdx(i)}>
                <View style={[s.listDot, { backgroundColor: STATUS_CFG[ad.status].dot }]} />
                <Text style={s.listNum}>{i + 1}</Text>
                <Text style={s.listTitle} numberOfLines={1}>{ad.title || "(이미지 배너)"}</Text>
                <Text style={s.listStatus}>{STATUS_CFG[ad.status].label}</Text>
              </Pressable>
            ))}
            {activeCount < MAX_SLIDES && (
              <Pressable style={s.addRowBtn} onPress={openCreate}>
                <LucideIcon name="plus" size={14} color={P} />
                <Text style={s.addRowTxt}>슬라이드 추가</Text>
              </Pressable>
            )}
          </View>
        )}
      </KeyboardAwareScrollView>

      {/* ── 등록/수정 모달 ──────────────────────────────────────── */}
      <Modal visible={showModal} transparent animationType="slide">
        <View style={m.overlay}>
          <View style={m.sheet}>
            <View style={m.header}>
              <Text style={m.headerTitle}>{editId ? "슬라이드 수정" : "슬라이드 추가"}</Text>
              <Pressable onPress={() => setShowModal(false)}>
                <LucideIcon name="x" size={20} color={C.textSecondary} />
              </Pressable>
            </View>

            <KeyboardAwareScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* 미리보기 (1:1 실제 비율) */}
              <Text style={m.label}>미리보기</Text>
              <BannerPreview form={form} />

              {/* 타입 선택 */}
              <Text style={m.label}>배너 타입</Text>
              <View style={m.typeRow}>
                <Pressable
                  style={[m.typeBtn, form.bannerType === "text" && m.typeBtnActive]}
                  onPress={() => setForm(f => ({ ...f, bannerType: "text" }))}
                >
                  <LucideIcon name="type" size={14} color={form.bannerType === "text" ? "#fff" : C.textSecondary} />
                  <Text style={[m.typeTxt, form.bannerType === "text" && m.typeTxtActive]}>텍스트</Text>
                </Pressable>
                <Pressable
                  style={[m.typeBtn, form.bannerType === "image" && m.typeBtnActive]}
                  onPress={() => setForm(f => ({ ...f, bannerType: "image" }))}
                >
                  <LucideIcon name="image" size={14} color={form.bannerType === "image" ? "#fff" : C.textSecondary} />
                  <Text style={[m.typeTxt, form.bannerType === "image" && m.typeTxtActive]}>이미지</Text>
                </Pressable>
              </View>

              {/* ── TEXT 타입 입력 ── */}
              {form.bannerType === "text" && (
                <>
                  <View style={m.labelRow}>
                    <Text style={m.label}>제목 *</Text>
                    <Text style={[m.charCount, form.title.length > TITLE_MAX && m.charOver]}>
                      {form.title.length}/{TITLE_MAX}
                    </Text>
                  </View>
                  <TextInput
                    style={[m.input, titleErr ? m.inputErr : null]}
                    value={form.title}
                    onChangeText={v => { setForm(f => ({ ...f, title: v.replace(/\n/g, "") })); setTitleErr(null); }}
                    placeholder="배너 제목"
                    maxLength={TITLE_MAX}
                  />
                  {titleErr ? <Text style={m.errTxt}>{titleErr}</Text> : null}

                  <View style={m.labelRow}>
                    <Text style={m.label}>설명 (선택)</Text>
                    <Text style={[m.charCount, form.description.length > DESC_MAX && m.charOver]}>
                      {form.description.length}/{DESC_MAX}
                    </Text>
                  </View>
                  <TextInput
                    style={[m.input, { height: 60, textAlignVertical: "top" }]}
                    value={form.description}
                    onChangeText={v => setForm(f => ({ ...f, description: v }))}
                    placeholder="부가 설명 (선택)"
                    multiline
                    maxLength={DESC_MAX}
                  />

                  {/* ── 색상 테마 ── */}
                  <Text style={m.label}>색상 테마</Text>

                  {/* [빠른 색상] 프리셋 칩 */}
                  <Text style={m.colorSectionHint}>빠른 색상</Text>
                  <View style={m.themeRow}>
                    {BANNER_PRESET_KEYS.map(th => (
                      <Pressable key={th}
                        onPress={() => setForm(f => ({ ...f, colorTheme: th, colorMode: "preset" }))}
                        style={[m.themeChip,
                          { backgroundColor: THEME_BG[th] ?? "#EEF9FB" },
                          form.colorMode === "preset" && form.colorTheme === th
                            && { borderWidth: 2, borderColor: THEME_COLORS[th] ?? "#1683A3" }]}>
                        <View style={[m.themeDot, { backgroundColor: THEME_COLORS[th] ?? "#1683A3" }]} />
                      </Pressable>
                    ))}
                  </View>

                  {/* [직접 색상] custom HEX 입력 */}
                  <Text style={[m.colorSectionHint, { marginTop: 10 }]}>직접 색상</Text>
                  <View style={m.customColorRow}>
                    {/* 배경색 */}
                    <View style={m.customColorItem}>
                      <Text style={m.customColorLabel}>배경색</Text>
                      <View style={m.hexInputRow}>
                        <View style={[m.colorSwatch, { backgroundColor: isValidHex(form.customBg) ? form.customBg : "#1B3A5C" }]} />
                        <TextInput
                          style={[m.hexInput, form.colorMode === "custom" && { borderColor: "#7C3AED" }]}
                          value={form.customBg}
                          onChangeText={v => {
                            const hex = v.startsWith("#") ? v : "#" + v;
                            setForm(f => ({
                              ...f,
                              customBg: hex,
                              colorMode: "custom",
                              // 배경색 변경 시 글자색 자동 추천 (사용자가 글자색을 직접 안 바꾼 경우만)
                              customText: isValidHex(hex) ? autoTextColor(hex) : f.customText,
                            }));
                          }}
                          placeholder="#1B3A5C"
                          autoCapitalize="characters"
                          maxLength={7}
                          onFocus={() => setForm(f => ({ ...f, colorMode: "custom" }))}
                        />
                      </View>
                    </View>

                    {/* 글자색 */}
                    <View style={m.customColorItem}>
                      <Text style={m.customColorLabel}>글자색</Text>
                      <View style={m.hexInputRow}>
                        <View style={[m.colorSwatch, { backgroundColor: isValidHex(form.customText) ? form.customText : "#FFFFFF", borderWidth: 1, borderColor: "#E2E8F0" }]} />
                        <TextInput
                          style={[m.hexInput, form.colorMode === "custom" && { borderColor: "#7C3AED" }]}
                          value={form.customText}
                          onChangeText={v => {
                            const hex = v.startsWith("#") ? v : "#" + v;
                            setForm(f => ({ ...f, customText: hex, colorMode: "custom" }));
                          }}
                          placeholder="#FFFFFF"
                          autoCapitalize="characters"
                          maxLength={7}
                          onFocus={() => setForm(f => ({ ...f, colorMode: "custom" }))}
                        />
                      </View>
                    </View>
                  </View>

                  {/* 대비 경고 */}
                  {form.colorMode === "custom"
                    && isValidHex(form.customBg)
                    && isValidHex(form.customText)
                    && contrastRatio(form.customBg, form.customText) < 3.0
                    && (
                      <Text style={m.contrastWarn}>⚠ 글자가 잘 보이지 않을 수 있습니다.</Text>
                    )
                  }
                </>
              )}

              {/* ── IMAGE 타입 입력 ── */}
              {form.bannerType === "image" && (
                <>
                  <Pressable style={m.imgBtn} onPress={handlePickImage}>
                    <LucideIcon name="camera" size={16} color={P} />
                    <Text style={m.imgBtnTxt}>
                      {(form.imageUri || form.imageKey || form.displayUrl)
                        ? "이미지 변경 (16:5 비율 crop)"
                        : "이미지 선택 (16:5 비율 crop)"}
                    </Text>
                  </Pressable>
                  {(form.imageUri || form.imageKey || form.displayUrl) && (
                    <Pressable style={m.removeImg}
                      onPress={() => setForm(f => ({ ...f, imageUri: "", imageKey: "", imageUrl: "", displayUrl: "" }))}>
                      <LucideIcon name="x" size={12} color="#DC2626" />
                      <Text style={m.removeImgTxt}>이미지 제거</Text>
                    </Pressable>
                  )}
                  <Text style={m.imgHint}>
                    * iOS에서 16:5 비율로 자르기가 지원됩니다{"\n"}
                    * 사진 앱에서 직접 크롭 후 사용하면 더 정확합니다
                  </Text>
                </>
              )}

              {/* 공통: 링크 URL */}
              <Text style={m.label}>링크 URL (선택)</Text>
              <TextInput
                style={m.input}
                value={form.linkUrl}
                onChangeText={v => setForm(f => ({ ...f, linkUrl: v }))}
                placeholder="https://..."
                autoCapitalize="none"
                keyboardType="url"
              />

              {/* 공통: 노출 기간 */}
              <View style={m.dateRow}>
                <View style={{ flex: 1 }}>
                  <Text style={m.label}>시작일</Text>
                  <TextInput style={m.input} value={form.displayStart}
                    onChangeText={v => setForm(f => ({ ...f, displayStart: v }))}
                    placeholder="YYYY-MM-DD" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={m.label}>종료일</Text>
                  <TextInput style={m.input} value={form.displayEnd}
                    onChangeText={v => setForm(f => ({ ...f, displayEnd: v }))}
                    placeholder="YYYY-MM-DD" />
                </View>
              </View>

              {/* 공통: 상태 */}
              <Text style={m.label}>상태</Text>
              <View style={m.segRow}>
                {(["scheduled","active","inactive"] as const).map(st => (
                  <Pressable key={st}
                    style={[m.segBtn, form.status === st && m.segBtnActive]}
                    onPress={() => setForm(f => ({ ...f, status: st }))}>
                    <Text style={[m.segTxt, form.status === st && m.segTxtActive]}>
                      {STATUS_CFG[st].label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Pressable
                style={[m.saveBtn, (saving || uploading) && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving || uploading}
              >
                {saving || uploading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={m.saveTxt}>{editId ? "수정 완료" : "등록하기"}</Text>
                }
              </Pressable>
            </KeyboardAwareScrollView>
          </View>
        </View>
      </Modal>

      {/* ── 삭제 확인 모달 ──────────────────────────────────────── */}
      <Modal visible={!!deleteConfirm} transparent animationType="fade">
        <View style={m.overlay}>
          <View style={[m.sheet, { gap: 14 }]}>
            <Text style={[m.headerTitle, { textAlign: "center" }]}>슬라이드를 삭제할까요?</Text>
            <Text style={m.deleteSub}>삭제 후 복구가 불가합니다.</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable style={[m.saveBtn, { flex: 1, backgroundColor: C.backgroundSoft }]}
                onPress={() => setDeleteConfirm(null)}>
                <Text style={[m.saveTxt, { color: C.textSecondary }]}>취소</Text>
              </Pressable>
              <Pressable style={[m.saveBtn, { flex: 1, backgroundColor: "#DC2626" }]}
                onPress={() => deleteConfirm && handleDelete(deleteConfirm)}>
                <Text style={m.saveTxt}>삭제</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── 스타일 ──────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: C.backgroundSoft },
  sectionLabel:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, marginBottom: 8 },
  previewSection:  { backgroundColor: "#fff", padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  tabSection:      { backgroundColor: "#fff", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  tabRow:          { flexDirection: "row", gap: 8, marginBottom: 6 },
  tabHint:         { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },
  actionSection:   { backgroundColor: "#fff", padding: 16, borderBottomWidth: 1, borderBottomColor: C.border, gap: 10 },
  statusBadge:     { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, alignSelf: "flex-start" },
  statusDot:       { width: 6, height: 6, borderRadius: 3 },
  statusLabel:     { fontSize: 12, fontFamily: "Pretendard-Regular" },
  actionRow:       { flexDirection: "row", alignItems: "center", gap: 8 },
  orderBtn:        { width: 34, height: 34, borderRadius: 8, backgroundColor: C.backgroundSoft, alignItems: "center", justifyContent: "center" },
  btnDisabled:     { opacity: 0.4 },
  editBtn:         { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: "#EDE9FE" },
  editBtnTxt:      { fontSize: 13, fontFamily: "Pretendard-Regular", color: P },
  activateBtn:     { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: "#DCFCE7" },
  activateTxt:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#16A34A" },
  pauseBtn:        { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: C.backgroundSoft },
  pauseTxt:        { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  deleteBtn:       { width: 34, height: 34, borderRadius: 8, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center", marginLeft: "auto" },
  dateTxt:         { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },
  emptySection:    { alignItems: "center", paddingVertical: 50, gap: 12, paddingHorizontal: 24 },
  emptyTxt:        { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textMuted, textAlign: "center" },
  addBtnLarge:     { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: P, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
  addBtnTxt:       { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
  listSection:     { backgroundColor: "#fff", padding: 16, margin: 16, borderRadius: 14, gap: 8, borderWidth: 1, borderColor: C.border },
  listRow:         { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8 },
  listRowSelected: { backgroundColor: "#EDE9FE" },
  listDot:         { width: 6, height: 6, borderRadius: 3 },
  listNum:         { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, width: 16 },
  listTitle:       { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  listStatus:      { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },
  addRowBtn:       { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 10 },
  addRowTxt:       { fontSize: 13, fontFamily: "Pretendard-Regular", color: P },
});

const m = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:      { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: "93%", gap: 0 },
  header:     { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  headerTitle:{ fontSize: 17, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  label:      { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textPrimary, marginBottom: 4, marginTop: 10 },
  labelRow:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10, marginBottom: 4 },
  charCount:  { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },
  charOver:   { color: "#DC2626" },
  input:      { borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, fontSize: 14, fontFamily: "Pretendard-Regular", color: "#111" },
  inputErr:   { borderColor: "#DC2626" },
  errTxt:     { fontSize: 11, color: "#DC2626", fontFamily: "Pretendard-Regular", marginTop: 2 },
  typeRow:    { flexDirection: "row", gap: 10 },
  typeBtn:    { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10, backgroundColor: C.backgroundSoft },
  typeBtnActive:{ backgroundColor: P },
  typeTxt:    { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  typeTxtActive:{ color: "#fff" },
  themeRow:        { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  themeChip:       { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 0 },
  themeDot:        { width: 14, height: 14, borderRadius: 7 },
  colorSectionHint:{ fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, marginBottom: 4 },
  customColorRow:  { flexDirection: "row", gap: 10 },
  customColorItem: { flex: 1 },
  customColorLabel:{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginBottom: 4 },
  hexInputRow:     { flexDirection: "row", alignItems: "center", gap: 6 },
  colorSwatch:     { width: 28, height: 28, borderRadius: 6 },
  hexInput:        { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, fontSize: 13, fontFamily: "Pretendard-Regular", color: "#111" },
  contrastWarn:    { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#D97706", marginTop: 4 },
  imgBtn:     { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderColor: P, borderRadius: 10, padding: 12, borderStyle: "dashed", marginTop: 10 },
  imgBtnTxt:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: P, flex: 1 },
  removeImg:  { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  removeImgTxt:{ fontSize: 12, color: "#DC2626", fontFamily: "Pretendard-Regular" },
  imgHint:    { fontSize: 11, color: C.textMuted, fontFamily: "Pretendard-Regular", marginTop: 6, lineHeight: 16 },
  dateRow:    { flexDirection: "row", gap: 10 },
  segRow:     { flexDirection: "row", gap: 8 },
  segBtn:     { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: C.backgroundSoft },
  segBtnActive:{ backgroundColor: P },
  segTxt:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  segTxtActive:{ color: "#fff" },
  saveBtn:    { backgroundColor: P, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 16, marginBottom: 8 },
  saveTxt:    { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" },
  deleteSub:  { fontSize: 13, color: C.textSecondary, textAlign: "center", fontFamily: "Pretendard-Regular" },
});
