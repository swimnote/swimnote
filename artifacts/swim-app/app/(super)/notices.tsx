import Colors from "@/constants/colors";
const C = Colors.light;
/**
 * (super)/notices.tsx — 공지 관리 V2
 *
 * ─ 변경 내용 (V2) ───────────────────────────────────────────────────────────
 * - 대상 그룹: "학부모만 / 관리자+선생님 / 전체" 3가지 → target_roles 전송
 * - 이미지 1장 첨부 (presigned R2 업로드) — 최종 등록 시점에만 수행
 * - 링크 URL + 버튼 문구 필드 추가 (deep_link, link_label)
 * - 노출 시작일시(starts_at) 실제로 API에 전송
 * - forcedAck(강제 확인) UI 제거 — dead UI 정리
 * - 공지 카드에 이미지/링크 요약 표시
 * - 작성 → 미리보기 → 수정 → 최종 등록 workflow (GATE 1)
 *   · 미리보기는 NoticePopupCard 재사용 — 두 벌 복제 없음
 *   · 이미지: 미리보기는 local URI 표시, R2 업로드는 최종 등록 시 수행
 *   · 미리보기 중 DB/seen 기록 없음
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import { NoticePopupCard } from "@/components/common/NoticePopupCard";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, Image, Modal, Pressable, StyleSheet, Text,
  TextInput, View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { compressPhotoAsset } from "../../utils/compressImage";
import * as FileSystemLegacy from "expo-file-system/legacy";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { type NoticeType, NOTICE_TYPE_CFG } from "@/store/noticeStore";
import { useAuth, apiRequest, API_BASE } from "@/context/AuthContext";
import { OtpGateModal } from "@/components/common/OtpGateModal";

const P = "#7C3AED";

// ─── 대상 그룹 ────────────────────────────────────────────────────────────────
type AudienceGroup = "parent" | "staff" | "all";

const AUDIENCE_CFG: Record<AudienceGroup, { label: string; desc: string; roles: string[] }> = {
  parent: {
    label: "학부모",
    desc: "학부모 계정에만 표시",
    roles: ["PARENT"],
  },
  staff: {
    label: "관리자 + 선생님",
    desc: "관리자·선생님 계정에만 표시",
    roles: ["ADMIN", "TEACHER"],
  },
  all: {
    label: "전체",
    desc: "모든 사용자에게 표시",
    roles: ["ADMIN", "TEACHER", "PARENT"],
  },
};

// ─── API 공지 타입 ───────────────────────────────────────────────────────────
interface ApiNotice {
  id: string;
  title: string;
  content: string;
  notice_type: string;
  target_roles: string[] | null;
  image_urls: string[] | null;
  deep_link: string | null;
  link_label: string | null;
  starts_at: string | null;
  author_name: string;
  created_at: string;
  status: string;
}

function targetRolesToGroup(roles: string[] | null): AudienceGroup {
  if (!roles || roles.length === 0) return "all";
  const has = (r: string) => roles.includes(r);
  if (has("PARENT") && has("ADMIN") && has("TEACHER")) return "all";
  if (has("PARENT") && !has("ADMIN") && !has("TEACHER")) return "parent";
  if (!has("PARENT") && (has("ADMIN") || has("TEACHER"))) return "staff";
  return "all";
}

function NoticeCard({ notice, onEdit, onDelete, isLatest }: {
  notice: ApiNotice;
  onEdit: (n: ApiNotice) => void;
  onDelete: (id: string) => void;
  isLatest?: boolean;
}) {
  const ntCfg = NOTICE_TYPE_CFG[(notice.notice_type as NoticeType)] ?? NOTICE_TYPE_CFG.general;
  const group = targetRolesToGroup(notice.target_roles);
  const aCfg  = AUDIENCE_CFG[group];
  const d     = new Date(notice.created_at);
  const dateStr = isNaN(d.getTime()) ? "—" : d.toLocaleDateString("ko-KR");
  const hasImage = Array.isArray(notice.image_urls) && notice.image_urls.length > 0;
  const hasLink  = !!notice.deep_link;

  return (
    <View style={[nc.card, isLatest && nc.cardLatest]}>
      {isLatest && (
        <View style={nc.latestBadge}>
          <LucideIcon name="radio" size={9} color={C.brandStrong} />
          <Text style={nc.latestTxt}>현재 노출 중</Text>
        </View>
      )}
      <View style={nc.top}>
        <View style={[nc.typeBadge, { backgroundColor: ntCfg.bg }]}>
          <LucideIcon name={ntCfg.icon as any} size={9} color={ntCfg.color} />
          <Text style={[nc.typeTxt, { color: ntCfg.color }]}>{ntCfg.label}</Text>
        </View>
        <View style={[nc.targetBadge, { backgroundColor: "#EEDDF5" }]}>
          <Text style={[nc.targetTxt, { color: P }]}>{aCfg.label}</Text>
        </View>
        {hasImage && (
          <View style={nc.iconBadge}>
            <LucideIcon name="image" size={9} color={C.textSecondary} />
          </View>
        )}
        {hasLink && (
          <View style={nc.iconBadge}>
            <LucideIcon name="link" size={9} color={C.textSecondary} />
          </View>
        )}
        <Text style={nc.date}>{dateStr}</Text>
      </View>
      <Text style={nc.title} numberOfLines={1}>{notice.title}</Text>
      <Text style={nc.content} numberOfLines={2}>{notice.content}</Text>
      <Text style={nc.by}>등록: {notice.author_name} · 노출시작: {notice.starts_at ? new Date(notice.starts_at).toLocaleDateString("ko-KR") : "즉시"}</Text>
      <View style={nc.actions}>
        <Pressable style={[nc.btn, { backgroundColor: "#EEDDF5" }]} onPress={() => onEdit(notice)}>
          <Text style={[nc.btnTxt, { color: P }]}>수정</Text>
        </Pressable>
        <Pressable style={[nc.btn, { backgroundColor: "#F9DEDA" }]} onPress={() => onDelete(notice.id)}>
          <Text style={[nc.btnTxt, { color: "#D96C6C" }]}>삭제</Text>
        </Pressable>
      </View>
    </View>
  );
}

const nc = StyleSheet.create({
  card:        { backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border },
  cardLatest:  { borderColor: C.brandStrong, borderWidth: 1.5 },
  latestBadge: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start",
                 backgroundColor: C.brandSoft, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7, marginBottom: 6 },
  latestTxt:   { fontSize: 10, fontFamily: "Pretendard-Regular", color: C.brandStrong },
  typeBadge:   { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7 },
  typeTxt:     { fontSize: 10, fontFamily: "Pretendard-Regular" },
  iconBadge:   { backgroundColor: "#F3F4F6", paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  top:         { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 8, flexWrap: "wrap" },
  targetBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7 },
  targetTxt:   { fontSize: 11, fontFamily: "Pretendard-Regular" },
  date:        { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginLeft: "auto" },
  title:       { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.textPrimary, marginBottom: 4 },
  content:     { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 18, marginBottom: 6 },
  by:          { fontSize: 10, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginBottom: 8 },
  actions:     { flexDirection: "row", gap: 6 },
  btn:         { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  btnTxt:      { fontSize: 12, fontFamily: "Pretendard-Regular" },
});

// ─── Form ────────────────────────────────────────────────────────────────────
interface FormState {
  title: string;
  content: string;
  audience: AudienceGroup;
  noticeType: NoticeType;
  showFrom: string;        // "YYYY-MM-DDTHH:mm" or ""
  linkUrl: string;
  linkLabel: string;
}

const BLANK: FormState = {
  title: "", content: "", audience: "all",
  noticeType: "general",
  showFrom: new Date().toISOString().slice(0, 16),
  linkUrl: "", linkLabel: "",
};

// ─── 이미지 업로드 helper ──────────────────────────────────────────────────
type PickedImage = {
  uri: string;
  mimeType?: string;
  fileSize?: number;
};

async function uploadOneImage(img: PickedImage, token: string): Promise<string> {
  // 1. 압축
  const { uri, mimeType, fileSize } = await compressPhotoAsset({
    uri: img.uri, mimeType: img.mimeType, fileSize: img.fileSize,
  });

  // 2. presigned URL 발급
  const sessionRes = await fetch(`${API_BASE}/uploads/presigned`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      files: [{ client_id: "ni_0", file_type: mimeType, file_size: fileSize }],
    }),
  });
  if (!sessionRes.ok) throw new Error("이미지 업로드 준비 실패");
  const { items } = await sessionRes.json() as {
    items: Array<{ client_id: string; object_key: string; upload_url: string; headers: Record<string, string> }>;
  };
  const slot = items[0];
  if (!slot) throw new Error("presigned 슬롯 없음");

  // 3. R2에 PUT
  const task = FileSystemLegacy.createUploadTask(
    slot.upload_url, uri,
    {
      httpMethod: "PUT",
      uploadType: FileSystemLegacy.FileSystemUploadType.BINARY_CONTENT,
      headers: slot.headers,
      sessionType: FileSystemLegacy.FileSystemSessionType.FOREGROUND,
    }
  );
  const result = await task.uploadAsync();
  if (!result || result.status < 200 || result.status >= 300) {
    throw new Error(`이미지 PUT 실패 (${result?.status})`);
  }
  return slot.object_key;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function NoticesScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();

  const [notices,       setNotices]       = useState<ApiNotice[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [showModal,     setShowModal]     = useState(false);

  // ── 작성/미리보기 step ───────────────────────────────────────────────────
  // "form" → 작성 화면, "preview" → 미리보기 화면
  const [step,          setStep]          = useState<"form" | "preview">("form");

  const [editId,        setEditId]        = useState<string | null>(null);
  const [form,          setForm]          = useState<FormState>(BLANK);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [filterType,    setFilterType]    = useState<"all" | NoticeType>("all");
  const [otpVisible,    setOtpVisible]    = useState(false);

  // 이미지 상태
  const [pickedImage,  setPickedImage]  = useState<PickedImage | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null); // 기존 공지 or local URI
  const [uploading,    setUploading]    = useState(false);

  // 중복 등록 방지용 ref
  const submittingRef = useRef(false);

  const fetchNotices = useCallback(async () => {
    try {
      const res  = await apiRequest(token, "/notices?scope=global");
      const data = await res.json();
      if (Array.isArray(data)) setNotices(data as ApiNotice[]);
    } catch (e) {
      console.error("fetchNotices error:", e);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchNotices(); }, [fetchNotices]);

  const filtered = useMemo(() => {
    if (filterType === "all") return notices;
    return notices.filter(n => n.notice_type === filterType);
  }, [notices, filterType]);

  function openCreate() {
    setEditId(null);
    setForm(BLANK);
    setPickedImage(null);
    setImagePreview(null);
    setStep("form");
    setShowModal(true);
  }

  function openEdit(n: ApiNotice) {
    setEditId(n.id);
    setForm({
      title:      n.title,
      content:    n.content,
      audience:   targetRolesToGroup(n.target_roles),
      noticeType: (n.notice_type as NoticeType) ?? "general",
      showFrom:   n.starts_at ? new Date(n.starts_at).toISOString().slice(0, 16) : "",
      linkUrl:    n.deep_link ?? "",
      linkLabel:  n.link_label ?? "",
    });
    setPickedImage(null);
    const existingKey = Array.isArray(n.image_urls) && n.image_urls.length > 0 ? n.image_urls[0] : null;
    setImagePreview(existingKey ? `${API_BASE.replace(/\/api$/, "")}/uploads/${existingKey}` : null);
    setStep("form");
    setShowModal(true);
  }

  async function pickImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("권한 필요", "사진 접근 권한이 필요합니다.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.9,
      allowsMultipleSelection: false,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setPickedImage({ uri: asset.uri, mimeType: asset.mimeType ?? "image/jpeg", fileSize: asset.fileSize });
      setImagePreview(asset.uri);
    }
  }

  function removeImage() {
    setPickedImage(null);
    setImagePreview(null);
  }

  // ── 미리보기로 이동 ───────────────────────────────────────────────────────
  function goPreview() {
    if (!form.title.trim() || !form.content.trim()) return;
    setStep("preview");
  }

  // ── 수정하기 — 미리보기에서 폼으로 복귀 (모든 상태 유지) ──────────────
  function goBackToForm() {
    setStep("form");
  }

  // ── 최종 등록/수정 ───────────────────────────────────────────────────────
  async function handleSave() {
    if (!form.title.trim() || !form.content.trim()) return;
    if (submittingRef.current) return; // 중복 탭 방지
    submittingRef.current = true;
    setSaving(true);
    try {
      // 이미지 R2 업로드 — 최종 등록 시점에만 수행
      let imageUrls: string[] | undefined;
      if (pickedImage) {
        setUploading(true);
        try {
          const key = await uploadOneImage(pickedImage, token!);
          imageUrls = [key];
        } finally {
          setUploading(false);
        }
      }

      const targetRoles = AUDIENCE_CFG[form.audience].roles;
      const startsAt    = form.showFrom.trim() ? new Date(form.showFrom).toISOString() : null;
      const linkUrl     = form.linkUrl.trim() || null;
      const linkLabel   = form.linkLabel.trim() || null;

      if (editId) {
        const body: any = {
          title: form.title, content: form.content,
          notice_type: form.noticeType,
          target_roles: targetRoles,
          starts_at: startsAt,
          deep_link: linkUrl,
          link_label: linkLabel,
        };
        if (imageUrls) body.image_urls = imageUrls;
        const pRes = await apiRequest(token, `/notices/${editId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        if (!pRes.ok) throw new Error(`HTTP ${pRes.status}`);
      } else {
        const pRes = await apiRequest(token, "/notices", {
          method: "POST",
          body: JSON.stringify({
            title: form.title,
            content: form.content,
            notice_type: form.noticeType,
            audience_scope: "global",
            target_roles: targetRoles,
            starts_at: startsAt,
            deep_link: linkUrl,
            link_label: linkLabel,
            image_urls: imageUrls ?? [],
            send_push: true,
          }),
        });
        if (!pRes.ok) throw new Error(`HTTP ${pRes.status}`);
      }
      await fetchNotices();
      setShowModal(false);
      setStep("form");
    } catch (e) {
      console.error("handleSave error:", e);
      // 실패 시 작성 데이터 유지 — form 상태 보존, 미리보기로 복귀
      Alert.alert("오류", "공지 저장에 실패했습니다. 다시 시도해주세요.");
      setStep("preview"); // 미리보기 유지 (데이터 손실 없음)
    } finally {
      setSaving(false);
      submittingRef.current = false;
    }
  }

  async function handleDelete(id: string) {
    try {
      const dRes = await apiRequest(token, `/notices/${id}`, { method: "DELETE" });
      if (!dRes.ok) throw new Error(`HTTP ${dRes.status}`);
      setNotices(prev => prev.filter(x => x.id !== id));
    } catch (e) {
      console.error("handleDelete error:", e);
    } finally {
      setDeleteConfirm(null);
    }
  }

  const FILTER_ITEMS: { key: "all" | NoticeType; label: string }[] = [
    { key: "all",         label: "전체" },
    { key: "general",     label: "일반" },
    { key: "update",      label: "업데이트" },
    { key: "maintenance", label: "점검/장애" },
    { key: "special",     label: "특별" },
  ];

  const canPreview = form.title.trim().length > 0 && form.content.trim().length > 0;
  const canSave    = canPreview && !saving && !uploading;

  // ── 미리보기에서 사용할 이미지 URI ───────────────────────────────────────
  // pickedImage가 있으면 local URI 사용 (R2 업로드 없이 표시)
  // 없으면 기존 공지 이미지 URL 사용
  const previewImageUri = pickedImage ? pickedImage.uri : imagePreview;

  // 미리보기 메타 정보
  const previewAudienceLabel = AUDIENCE_CFG[form.audience].label;
  const previewStartsLabel   = form.showFrom.trim()
    ? (() => {
        const d = new Date(form.showFrom);
        return isNaN(d.getTime()) ? form.showFrom : d.toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
      })()
    : "즉시";

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="공지 관리" homePath="/(super)/dashboard" />

      {/* 안내 */}
      <View style={s.infoBanner}>
        <LucideIcon name="bell" size={12} color={C.brandStrong} />
        <Text style={s.infoTxt}>
          최신 공지 1개가 대상 역할에 맞게 앱 실행 시 팝업으로 노출됩니다. 사용자별 1회만 표시.
        </Text>
      </View>

      {/* 필터 + 등록 */}
      <View style={s.filterRow}>
        <KeyboardAwareScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {FILTER_ITEMS.map(f => (
              <Pressable key={f.key}
                style={[s.filterBtn, filterType === f.key && s.filterActive]}
                onPress={() => setFilterType(f.key as any)}>
                <Text style={[s.filterTxt, filterType === f.key && s.filterActiveTxt]}>{f.label}</Text>
              </Pressable>
            ))}
          </View>
        </KeyboardAwareScrollView>
        <Pressable style={s.addBtn} onPress={openCreate}>
          <LucideIcon name="plus" size={16} color="#fff" />
          <Text style={s.addTxt}>공지 등록</Text>
        </Pressable>
      </View>

      {/* 목록 */}
      <KeyboardAwareScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 16, gap: 10 }}>
        {loading ? (
          <View style={s.empty}><Text style={s.emptyTxt}>불러오는 중...</Text></View>
        ) : filtered.length === 0 ? (
          <View style={s.empty}>
            <LucideIcon name="bell-off" size={36} color="#D1D5DB" />
            <Text style={s.emptyTxt}>등록된 공지가 없습니다</Text>
          </View>
        ) : (
          filtered.map((n, idx) => (
            <NoticeCard key={n.id} notice={n} onEdit={openEdit}
              onDelete={(id) => setDeleteConfirm(id)}
              isLatest={idx === 0 && filterType === "all"} />
          ))
        )}
      </KeyboardAwareScrollView>

      {/* ── 작성/미리보기 Modal ────────────────────────────────────────────── */}
      <Modal visible={showModal} transparent animationType="slide"
        statusBarTranslucent onRequestClose={() => { setShowModal(false); setStep("form"); }}>
        <View style={m.overlay}>
          <View style={m.sheet}>

            {/* ── STEP: FORM ── */}
            {step === "form" && (
              <>
                <View style={m.header}>
                  <Text style={m.title}>{editId ? "공지 수정" : "공지 등록"}</Text>
                  <Pressable onPress={() => { setShowModal(false); setStep("form"); }}>
                    <LucideIcon name="x" size={20} color={C.textSecondary} />
                  </Pressable>
                </View>

                <KeyboardAwareScrollView showsVerticalScrollIndicator={false}>
                  {/* 제목 */}
                  <Text style={m.label}>제목 *</Text>
                  <TextInput style={m.input} value={form.title}
                    onChangeText={v => setForm(f => ({ ...f, title: v }))}
                    placeholder="공지 제목을 입력하세요" />

                  {/* 내용 */}
                  <Text style={m.label}>내용 *</Text>
                  <TextInput style={[m.input, { height: 120, textAlignVertical: "top" }]}
                    value={form.content} onChangeText={v => setForm(f => ({ ...f, content: v }))}
                    placeholder="공지 내용을 입력하세요" multiline />

                  {/* 공지 유형 */}
                  <Text style={m.label}>공지 유형</Text>
                  <View style={m.segRow}>
                    {(Object.keys(NOTICE_TYPE_CFG) as NoticeType[]).map(t => (
                      <Pressable key={t}
                        style={[m.segBtn, form.noticeType === t && {
                          backgroundColor: NOTICE_TYPE_CFG[t].bg,
                          borderColor: NOTICE_TYPE_CFG[t].color,
                        }]}
                        onPress={() => setForm(f => ({ ...f, noticeType: t }))}>
                        <Text style={[m.segTxt, form.noticeType === t && { color: NOTICE_TYPE_CFG[t].color }]}>
                          {NOTICE_TYPE_CFG[t].label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  {/* 대상 그룹 */}
                  <Text style={m.label}>대상</Text>
                  <View style={m.segRow}>
                    {(Object.keys(AUDIENCE_CFG) as AudienceGroup[]).map(g => (
                      <Pressable key={g}
                        style={[m.segBtn, form.audience === g && m.segActive]}
                        onPress={() => setForm(f => ({ ...f, audience: g }))}>
                        <Text style={[m.segTxt, form.audience === g && m.segActiveTxt]}>
                          {AUDIENCE_CFG[g].label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={m.hint}>{AUDIENCE_CFG[form.audience].desc}</Text>

                  {/* 노출 시작일시 */}
                  <Text style={m.label}>노출 시작일시 (선택)</Text>
                  <TextInput style={m.input} value={form.showFrom}
                    onChangeText={v => setForm(f => ({ ...f, showFrom: v }))}
                    placeholder="YYYY-MM-DDTHH:mm (예: 2026-04-01T09:00)"
                    autoCapitalize="none" />
                  <Text style={m.hint}>빈값이면 즉시 노출</Text>

                  {/* 대표 이미지 */}
                  <Text style={m.label}>대표 이미지 (선택, 1장)</Text>
                  {imagePreview ? (
                    <View style={m.imageRow}>
                      <Image source={{ uri: imagePreview }} style={m.previewImg} resizeMode="cover" />
                      <Pressable style={m.removeImgBtn} onPress={removeImage}>
                        <LucideIcon name="x" size={14} color="#D96C6C" />
                        <Text style={m.removeImgTxt}>이미지 제거</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable style={m.imgPickBtn} onPress={pickImage}>
                      <LucideIcon name="image" size={18} color={C.textSecondary} />
                      <Text style={m.imgPickTxt}>이미지 선택</Text>
                    </Pressable>
                  )}

                  {/* 링크 URL */}
                  <Text style={m.label}>링크 URL (선택)</Text>
                  <TextInput style={m.input} value={form.linkUrl}
                    onChangeText={v => setForm(f => ({ ...f, linkUrl: v }))}
                    placeholder="https://..."
                    autoCapitalize="none"
                    keyboardType="url" />

                  {/* 링크 버튼 문구 */}
                  {form.linkUrl.trim().length > 0 && (
                    <>
                      <Text style={m.label}>링크 버튼 문구 (선택)</Text>
                      <TextInput style={m.input} value={form.linkLabel}
                        onChangeText={v => setForm(f => ({ ...f, linkLabel: v }))}
                        placeholder="자세히 보기" />
                    </>
                  )}
                </KeyboardAwareScrollView>

                {/* 하단: 취소 + 미리보기 */}
                <View style={m.footer}>
                  <Pressable style={m.cancelBtn} onPress={() => { setShowModal(false); setStep("form"); }}>
                    <Text style={m.cancelTxt}>취소</Text>
                  </Pressable>
                  <Pressable
                    style={[m.saveBtn, !canPreview && { opacity: 0.4 }]}
                    onPress={goPreview}
                    disabled={!canPreview}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <LucideIcon name="eye" size={13} color="#fff" />
                      <Text style={m.saveTxt}>미리보기</Text>
                    </View>
                  </Pressable>
                </View>
              </>
            )}

            {/* ── STEP: PREVIEW ── */}
            {step === "preview" && (
              <>
                <View style={m.header}>
                  <Text style={m.title}>미리보기</Text>
                  <Pressable onPress={() => { setShowModal(false); setStep("form"); }}>
                    <LucideIcon name="x" size={20} color={C.textSecondary} />
                  </Pressable>
                </View>

                <KeyboardAwareScrollView showsVerticalScrollIndicator={false}>
                  {/* 발행 정보 — 슈퍼관리자 전용 메타 */}
                  <View style={pv.metaBox}>
                    <View style={pv.metaRow}>
                      <LucideIcon name="users" size={12} color={P} />
                      <Text style={pv.metaLabel}>발송 대상</Text>
                      <Text style={pv.metaValue}>{previewAudienceLabel}</Text>
                    </View>
                    <View style={pv.metaRow}>
                      <LucideIcon name="clock" size={12} color={P} />
                      <Text style={pv.metaLabel}>노출 시작</Text>
                      <Text style={pv.metaValue}>{previewStartsLabel}</Text>
                    </View>
                  </View>

                  <Text style={pv.sectionLabel}>실제 사용자 화면 미리보기</Text>

                  {/* 실제 NoticePopupCard 재사용 — 이미지는 local URI 표시 */}
                  <View style={pv.cardWrapper}>
                    <NoticePopupCard
                      title={form.title}
                      content={form.content}
                      imageUri={previewImageUri}
                      deepLink={form.linkUrl.trim() || null}
                      linkLabel={form.linkLabel.trim() || null}
                      onClose={goBackToForm}
                    />
                  </View>

                  <Text style={pv.previewNote}>
                    ※ 미리보기 닫기 버튼은 "수정하기"와 동일하게 작동합니다.
                  </Text>
                </KeyboardAwareScrollView>

                {/* 하단: 수정하기 + 공지 등록/OTP */}
                <View style={m.footer}>
                  <Pressable style={m.cancelBtn} onPress={goBackToForm}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <LucideIcon name="pencil" size={13} color={C.textPrimary} />
                      <Text style={m.cancelTxt}>수정하기</Text>
                    </View>
                  </Pressable>
                  <Pressable
                    style={[m.saveBtn, !canSave && { opacity: 0.4 }]}
                    onPress={() => setOtpVisible(true)}
                    disabled={!canSave}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <LucideIcon name="lock" size={13} color="#fff" />
                      <Text style={m.saveTxt}>
                        {uploading ? "업로드 중..." : saving ? "저장 중..." : editId ? "저장" : "공지 등록"}
                      </Text>
                    </View>
                  </Pressable>
                </View>
              </>
            )}

          </View>
        </View>
      </Modal>

      <OtpGateModal
        visible={otpVisible}
        token={token}
        title={editId ? "공지 수정 OTP 인증" : "공지 등록 OTP 인증"}
        desc="공지 등록·수정은 OTP 인증 후에 적용됩니다."
        onSuccess={() => { setOtpVisible(false); handleSave(); }}
        onCancel={() => setOtpVisible(false)}
      />

      {/* 삭제 확인 */}
      <Modal visible={!!deleteConfirm} transparent animationType="fade"
        statusBarTranslucent onRequestClose={() => setDeleteConfirm(null)}>
        <View style={m.overlay}>
          <View style={[m.sheet, { maxHeight: 240 }]}>
            <Text style={[m.title, { marginBottom: 12 }]}>공지 삭제</Text>
            <Text style={{ fontSize: 14, color: C.textPrimary, marginBottom: 8 }}>
              이 공지를 삭제하면 앱에서 더 이상 노출되지 않습니다.
            </Text>
            <Text style={{ fontSize: 13, color: "#D96C6C", marginBottom: 20 }}>
              삭제된 공지는 복구되지 않습니다.
            </Text>
            <View style={m.footer}>
              <Pressable style={m.cancelBtn} onPress={() => setDeleteConfirm(null)}>
                <Text style={m.cancelTxt}>취소</Text>
              </Pressable>
              <Pressable style={[m.saveBtn, { backgroundColor: "#D96C6C" }]}
                onPress={() => handleDelete(deleteConfirm!)}>
                <Text style={m.saveTxt}>삭제</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── 스타일 ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: C.backgroundSoft },
  infoBanner:    { flexDirection: "row", gap: 6, alignItems: "flex-start",
                   backgroundColor: C.brandSoft, padding: 10, paddingHorizontal: 16 },
  infoTxt:       { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.brandStrong, flex: 1 },
  filterRow:     { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  filterBtn:     { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: "#FFFFFF" },
  filterActive:  { backgroundColor: P },
  filterTxt:     { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  filterActiveTxt: { color: "#fff" },
  addBtn:        { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: P,
                   paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  addTxt:        { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#fff" },
  empty:         { alignItems: "center", paddingVertical: 48, gap: 10 },
  emptyTxt:      { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
});

const m = StyleSheet.create({
  overlay:       { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:         { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
                   padding: 20, maxHeight: "92%" },
  header:        { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title:         { fontSize: 17, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  label:         { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textPrimary, marginBottom: 4, marginTop: 14 },
  hint:          { fontSize: 10, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 3, marginBottom: 4 },
  input:         { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 10, padding: 10, fontSize: 14,
                   fontFamily: "Pretendard-Regular", color: C.textPrimary, backgroundColor: C.backgroundSoft },
  segRow:        { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  segBtn:        { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
                   backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E5E7EB" },
  segActive:     { backgroundColor: P, borderColor: P },
  segTxt:        { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  segActiveTxt:  { color: "#fff" },
  imageRow:      { gap: 8, marginBottom: 4 },
  previewImg:    { width: "100%", height: 160, borderRadius: 10, backgroundColor: "#F3F4F6" },
  removeImgBtn:  { flexDirection: "row", alignItems: "center", gap: 4,
                   alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 6,
                   borderRadius: 8, backgroundColor: "#FEE2E2" },
  removeImgTxt:  { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#D96C6C" },
  imgPickBtn:    { flexDirection: "row", alignItems: "center", gap: 8,
                   borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 10,
                   borderStyle: "dashed", padding: 16, justifyContent: "center",
                   backgroundColor: C.backgroundSoft },
  imgPickTxt:    { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  footer:        { flexDirection: "row", gap: 8, marginTop: 20 },
  cancelBtn:     { flex: 1, padding: 13, borderRadius: 10, backgroundColor: "#FFFFFF", alignItems: "center" },
  cancelTxt:     { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  saveBtn:       { flex: 2, padding: 13, borderRadius: 10, backgroundColor: P, alignItems: "center" },
  saveTxt:       { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
});

// 미리보기 전용 스타일
const pv = StyleSheet.create({
  metaBox:      { backgroundColor: "#F5F0FF", borderRadius: 12, padding: 14,
                  marginBottom: 16, gap: 8 },
  metaRow:      { flexDirection: "row", alignItems: "center", gap: 6 },
  metaLabel:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#6D28D9", width: 64 },
  metaValue:    { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: "#3B0764", flex: 1 },
  sectionLabel: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary,
                  marginBottom: 10, textAlign: "center" },
  cardWrapper:  { borderRadius: 20, overflow: "hidden", borderWidth: 1, borderColor: C.border,
                  marginBottom: 8 },
  previewNote:  { fontSize: 10, fontFamily: "Pretendard-Regular", color: C.textSecondary,
                  textAlign: "center", marginBottom: 8 },
});
