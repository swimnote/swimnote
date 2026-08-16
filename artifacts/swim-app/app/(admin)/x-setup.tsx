/**
 * (admin)/x-setup.tsx — WP-X03 SWIMNOTE X 세팅 자료 제출 화면
 *
 * Pool admin이 X Setup 자료(커리큘럼/홈페이지/로고/사진)를 제출하는 화면.
 * 기존 curriculum-request 플로우 대체.
 *
 * 섹션:
 *   ① 커리큘럼 자료 — DOCX 양식 다운로드 + 업로드
 *   ② 홈페이지 제작자료 — DOCX 양식 다운로드 + 업로드
 *   ③ 로고 / 홍보사진 — 로고 이미지 + 사진 최대 10장
 *
 * 파일 권한: pool_admin만 업로드; 조회는 pool_admin.
 * 원본 보관: X 구독 해지/만료 후에도 데이터 유지.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LucideIcon } from "@/components/common/LucideIcon";
import { useAuth, API_BASE } from "@/context/AuthContext";
import Colors from "@/constants/colors";

const C = Colors.light;
const NAVY        = "#23415C";
const MINT        = "#355C7D";
const MINT_LIGHT  = "#E9EEF3";
const AMBER       = "#F59E0B";
const AMBER_LIGHT = "#FEF3C7";
const GREEN       = "#16A34A";
const GREEN_LIGHT = "#F0FDF4";
const RED         = "#EF4444";
const RED_LIGHT   = "#FEF2F2";
const BORDER      = C.border;
const BG          = C.background;

// ── Types ───────────────────────────────────────────────────────────────────
type SetupStatus =
  | "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "UNDER_REVIEW"
  | "REVISION_REQUESTED" | "APPROVED" | "PROCESSING" | "READY";
type SectionStatus = "NOT_SUBMITTED" | "SUBMITTED" | "REVISION_REQUESTED" | "APPROVED";

interface XSetupFile {
  id: string;
  file_type: "curriculum" | "website" | "logo" | "photo";
  original_filename: string;
  mime_type: string;
  file_size_bytes: number | null;
  submission_version: number;
  photo_order: number | null;
  photo_title: string | null;
  uploaded_at: string;
}

interface PendingRevision {
  id: string;
  section: string;
  message: string;
  requested_at: string;
}

interface XSetupSubmission {
  setup_status: SetupStatus;
  curriculum_status: SectionStatus;
  website_status:    SectionStatus;
  logo_status:       SectionStatus;
  photos_status:     SectionStatus;
  submitted_at: string | null;
}

interface XSetupStatusResponse {
  submission: XSetupSubmission | null;
  files: XSetupFile[];
  pending_revisions: PendingRevision[];
  template_versions: { curriculum: string; website: string };
}

// ── Label/Color Helpers ──────────────────────────────────────────────────────
const SETUP_LABELS: Record<SetupStatus, string> = {
  NOT_STARTED:        "자료 미제출",
  IN_PROGRESS:        "작성 중",
  SUBMITTED:          "검토 요청됨",
  UNDER_REVIEW:       "검토 중",
  REVISION_REQUESTED: "수정 요청됨",
  APPROVED:           "승인 완료",
  PROCESSING:         "처리 중",
  READY:              "설정 완료",
};
const SECTION_LABELS: Record<SectionStatus, string> = {
  NOT_SUBMITTED:      "미제출",
  SUBMITTED:          "제출됨",
  REVISION_REQUESTED: "수정 요청",
  APPROVED:           "승인",
};
function sectionColor(status: SectionStatus): string {
  switch (status) {
    case "APPROVED":           return GREEN;
    case "SUBMITTED":          return MINT;
    case "REVISION_REQUESTED": return "#D97706";
    default:                   return C.textTertiary;
  }
}
function sectionBg(status: SectionStatus): string {
  switch (status) {
    case "APPROVED":           return GREEN_LIGHT;
    case "SUBMITTED":          return MINT_LIGHT;
    case "REVISION_REQUESTED": return AMBER_LIGHT;
    default:                   return C.backgroundSoft;
  }
}
function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

// ── Component ────────────────────────────────────────────────────────────────
export default function AdminXSetupScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();

  const [data, setData] = useState<XSetupStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // 업로드 진행 상태 per section
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);

  // ── Fetch Status ───────────────────────────────────────────────────────────
  const fetchStatus = useCallback(async (quiet = false) => {
    if (!token) return;
    if (!quiet) setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/x-setup/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setData(await res.json());
      }
    } catch {
      // 조용히 처리
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const onRefresh = () => { setRefreshing(true); fetchStatus(true); };

  // ── Template Download ──────────────────────────────────────────────────────
  const handleTemplateDownload = async (type: "curriculum" | "website") => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/x-setup/templates/${type}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) { Alert.alert("오류", json.error ?? "다운로드 실패"); return; }
      await Linking.openURL(json.url);
    } catch {
      Alert.alert("오류", "템플릿을 불러올 수 없습니다.");
    }
  };

  // ── DOCX Upload ────────────────────────────────────────────────────────────
  const handleDocxUpload = async (type: "curriculum" | "website") => {
    if (!token || uploading[type]) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];

      // 확장자 검증
      const filename = asset.name ?? "document.docx";
      if (!filename.toLowerCase().endsWith(".docx")) {
        Alert.alert("파일 형식 오류", "DOCX 파일(.docx)만 업로드할 수 있습니다.");
        return;
      }

      setUploading(prev => ({ ...prev, [type]: true }));
      const form = new FormData();
      form.append("file", { uri: asset.uri, type: asset.mimeType ?? "application/vnd.openxmlformats-officedocument.wordprocessingml.document", name: filename } as any);

      const uploadRes = await fetch(`${API_BASE}/x-setup/upload/${type}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const uploadJson = await uploadRes.json();
      if (!uploadRes.ok) {
        Alert.alert("업로드 실패", uploadJson.error ?? "다시 시도해 주세요.");
      } else {
        await fetchStatus(true);
      }
    } catch (err: any) {
      if (err?.code !== "DOCUMENT_PICKER_CANCELED") {
        Alert.alert("오류", "파일을 업로드하는 중 오류가 발생했습니다.");
      }
    } finally {
      setUploading(prev => ({ ...prev, [type]: false }));
    }
  };

  // ── Logo Upload ────────────────────────────────────────────────────────────
  const handleLogoUpload = async () => {
    if (!token || uploading["logo"]) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("권한 필요", "사진 라이브러리 접근 권한이 필요합니다.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];

    setUploading(prev => ({ ...prev, logo: true }));
    try {
      const filename = asset.fileName ?? `logo_${Date.now()}.jpg`;
      const form = new FormData();
      form.append("file", { uri: asset.uri, type: asset.mimeType ?? "image/jpeg", name: filename } as any);

      const uploadRes = await fetch(`${API_BASE}/x-setup/upload/logo`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const uploadJson = await uploadRes.json();
      if (!uploadRes.ok) {
        Alert.alert("업로드 실패", uploadJson.error ?? "다시 시도해 주세요.");
      } else {
        await fetchStatus(true);
      }
    } catch {
      Alert.alert("오류", "로고를 업로드하는 중 오류가 발생했습니다.");
    } finally {
      setUploading(prev => ({ ...prev, logo: false }));
    }
  };

  // ── Photo Upload ───────────────────────────────────────────────────────────
  const handlePhotoUpload = async () => {
    if (!token || uploading["photo"]) return;
    const photos = data?.files.filter(f => f.file_type === "photo") ?? [];
    if (photos.length >= 10) {
      Alert.alert("사진 한도", "홍보사진은 최대 10장까지 업로드할 수 있습니다.");
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("권한 필요", "사진 라이브러리 접근 권한이 필요합니다.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];

    setUploading(prev => ({ ...prev, photo: true }));
    try {
      const filename = asset.fileName ?? `photo_${Date.now()}.jpg`;
      const form = new FormData();
      form.append("file", { uri: asset.uri, type: asset.mimeType ?? "image/jpeg", name: filename } as any);

      const uploadRes = await fetch(`${API_BASE}/x-setup/upload/photo`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const uploadJson = await uploadRes.json();
      if (!uploadRes.ok) {
        Alert.alert("업로드 실패", uploadJson.error ?? "다시 시도해 주세요.");
      } else {
        await fetchStatus(true);
      }
    } catch {
      Alert.alert("오류", "사진을 업로드하는 중 오류가 발생했습니다.");
    } finally {
      setUploading(prev => ({ ...prev, photo: false }));
    }
  };

  // ── Photo Delete ───────────────────────────────────────────────────────────
  const handlePhotoDelete = async (fileId: string) => {
    if (!token) return;
    Alert.alert("사진 삭제", "이 사진을 삭제하시겠습니까?", [
      { text: "취소", style: "cancel" },
      {
        text: "삭제", style: "destructive",
        onPress: async () => {
          try {
            const res = await fetch(`${API_BASE}/x-setup/photos/${fileId}`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
              await fetchStatus(true);
            } else {
              const json = await res.json();
              Alert.alert("삭제 실패", json.error ?? "다시 시도해 주세요.");
            }
          } catch {
            Alert.alert("오류", "삭제 중 오류가 발생했습니다.");
          }
        },
      },
    ]);
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!token || submitting) return;
    // 최소 curriculum 또는 website 중 하나라도 제출된 경우에만 허용
    const sub = data?.submission;
    const hasAnyFile = sub && (
      sub.curriculum_status !== "NOT_SUBMITTED" ||
      sub.website_status    !== "NOT_SUBMITTED"
    );
    if (!hasAnyFile) {
      Alert.alert("제출 불가", "커리큘럼 자료 또는 홈페이지 제작자료 중 최소 하나를 업로드한 후 제출해 주세요.");
      return;
    }
    Alert.alert("자료 제출", "업로드한 자료를 SWIMNOTE 팀에 검토 요청하시겠습니까?", [
      { text: "취소", style: "cancel" },
      {
        text: "제출하기",
        onPress: async () => {
          setSubmitting(true);
          try {
            const res = await fetch(`${API_BASE}/x-setup/submit`, {
              method: "POST",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            });
            const json = await res.json();
            if (res.ok) {
              Alert.alert("제출 완료", "자료 검토 요청이 완료되었습니다.\nSWIMNOTE 팀이 검토 후 연락드립니다.");
              await fetchStatus(true);
            } else {
              Alert.alert("제출 실패", json.error ?? "다시 시도해 주세요.");
            }
          } catch {
            Alert.alert("오류", "제출 중 오류가 발생했습니다.");
          } finally {
            setSubmitting(false);
          }
        },
      },
    ]);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const sub = data?.submission;
  const files = data?.files ?? [];
  const revisions = data?.pending_revisions ?? [];

  const curriculumFile = files.find(f => f.file_type === "curriculum");
  const websiteFile    = files.find(f => f.file_type === "website");
  const logoFile       = files.find(f => f.file_type === "logo");
  const photoFiles     = files.filter(f => f.file_type === "photo");

  const setupStatus: SetupStatus = sub?.setup_status ?? "NOT_STARTED";
  const isSubmitted = ["SUBMITTED","UNDER_REVIEW","REVISION_REQUESTED","APPROVED","PROCESSING","READY"].includes(setupStatus);

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      {/* 헤더 */}
      <View style={[s.header, { paddingTop: insets.top + 14 }]}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={s.backBtn}>
          <LucideIcon name="arrow-left" size={20} color={NAVY} />
        </Pressable>
        <Text style={s.headerTitle}>X 홈페이지 세팅</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {loading ? (
          <View style={{ alignItems: "center", paddingVertical: 60 }}>
            <ActivityIndicator size="large" color={MINT} />
          </View>
        ) : (
          <>
            {/* 전체 상태 헤더 카드 */}
            <View style={s.statusCard}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={s.xBadge}>
                  <LucideIcon name="trending-up" size={11} color={NAVY} />
                  <Text style={s.xBadgeText}>SWIMNOTE X</Text>
                </View>
                <View style={[s.statusBadge, { backgroundColor: setupStatus === "APPROVED" || setupStatus === "READY" ? GREEN_LIGHT : MINT_LIGHT }]}>
                  <Text style={[s.statusBadgeText, { color: setupStatus === "APPROVED" || setupStatus === "READY" ? GREEN : NAVY }]}>
                    {SETUP_LABELS[setupStatus]}
                  </Text>
                </View>
              </View>
              <Text style={s.statusTitle}>홈페이지 제작자료 제출</Text>
              <Text style={s.statusDesc}>
                SWIMNOTE가 수영장 홈페이지를 제작하기 위한 자료를 제출해 주세요.{"\n"}
                양식을 다운로드하고 작성한 뒤 업로드하면 됩니다.
              </Text>
              {sub?.submitted_at && (
                <Text style={s.submittedAt}>최초 제출: {formatDate(sub.submitted_at)}</Text>
              )}
            </View>

            {/* 수정 요청 알림 (있는 경우) */}
            {revisions.length > 0 && (
              <View style={s.revisionBanner}>
                <LucideIcon name="message-circle" size={16} color="#92400E" />
                <View style={{ flex: 1 }}>
                  <Text style={s.revisionBannerTitle}>SWIMNOTE 팀 수정 요청</Text>
                  {revisions.map(r => (
                    <View key={r.id} style={s.revisionItem}>
                      <Text style={s.revisionSection}>{sectionKoName(r.section)}</Text>
                      <Text style={s.revisionMsg}>{r.message}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Word 표준 안내 */}
            <View style={s.wordNotice}>
              <LucideIcon name="file-text" size={14} color={NAVY} />
              <Text style={s.wordNoticeText}>
                {"글로벌 AI 표준 문서는 Microsoft Word(.docx)입니다.\nSWIMNOTE AI ENGINE은 Word(.docx) 형식만 지원합니다."}
              </Text>
            </View>

            {/* ── 섹션 1: 커리큘럼 자료 ───────────────────────────────── */}
            <SectionCard
              icon="book-open"
              title="① 커리큘럼 자료"
              subtitle="수영장 교육과정을 양식에 작성해 제출해 주세요."
              status={sub?.curriculum_status ?? "NOT_SUBMITTED"}
              required
            >
              <TemplateDownloadRow
                label="커리큘럼 양식 다운로드"
                version={data?.template_versions.curriculum}
                onDownload={() => handleTemplateDownload("curriculum")}
              />
              {curriculumFile ? (
                <FileRow
                  file={curriculumFile}
                  onReupload={() => handleDocxUpload("curriculum")}
                  uploading={uploading["curriculum"]}
                />
              ) : (
                <UploadButton
                  label="커리큘럼 자료 업로드"
                  hint=".docx 파일만 가능 (최대 20MB)"
                  icon="upload"
                  onPress={() => handleDocxUpload("curriculum")}
                  loading={uploading["curriculum"]}
                />
              )}
            </SectionCard>

            {/* ── 섹션 2: 홈페이지 제작자료 ───────────────────────────── */}
            <SectionCard
              icon="globe"
              title="② 홈페이지 제작자료"
              subtitle="수영장 소개와 특장점 등을 양식에 작성해 제출해 주세요."
              status={sub?.website_status ?? "NOT_SUBMITTED"}
              required
            >
              <TemplateDownloadRow
                label="홈페이지 자료 양식 다운로드"
                version={data?.template_versions.website}
                onDownload={() => handleTemplateDownload("website")}
              />
              {websiteFile ? (
                <FileRow
                  file={websiteFile}
                  onReupload={() => handleDocxUpload("website")}
                  uploading={uploading["website"]}
                />
              ) : (
                <UploadButton
                  label="홈페이지 자료 업로드"
                  hint=".docx 파일만 가능 (최대 20MB)"
                  icon="upload"
                  onPress={() => handleDocxUpload("website")}
                  loading={uploading["website"]}
                />
              )}
            </SectionCard>

            {/* ── 섹션 3: 로고 / 홍보사진 ──────────────────────────────── */}
            <SectionCard
              icon="image"
              title="③ 로고 / 홍보사진"
              subtitle="수영장 로고와 홈페이지에 사용할 사진을 제출해 주세요."
              status={sub?.logo_status === "NOT_SUBMITTED" && sub?.photos_status === "NOT_SUBMITTED"
                ? "NOT_SUBMITTED"
                : sub?.logo_status === "APPROVED" && sub?.photos_status === "APPROVED"
                  ? "APPROVED"
                  : sub?.logo_status === "REVISION_REQUESTED" || sub?.photos_status === "REVISION_REQUESTED"
                    ? "REVISION_REQUESTED"
                    : "SUBMITTED"
              }
              optional
            >
              {/* 로고 */}
              <View style={s.subsectionHeader}>
                <Text style={s.subsectionTitle}>수영장 로고</Text>
                <Text style={s.subsectionHint}>PNG, JPG, WEBP (최대 10MB)</Text>
              </View>
              {logoFile ? (
                <FileRow
                  file={logoFile}
                  onReupload={handleLogoUpload}
                  uploading={uploading["logo"]}
                  isImage
                />
              ) : (
                <UploadButton
                  label="로고 업로드"
                  hint="PNG, JPG, WEBP (최대 10MB)"
                  icon="image"
                  onPress={handleLogoUpload}
                  loading={uploading["logo"]}
                />
              )}

              {/* 사진 */}
              <View style={[s.subsectionHeader, { marginTop: 16 }]}>
                <Text style={s.subsectionTitle}>홍보사진</Text>
                <Text style={s.subsectionHint}>{photoFiles.length}/10장 · JPG, PNG, WEBP (최대 30MB)</Text>
              </View>
              {photoFiles.length > 0 && (
                <View style={s.photoGrid}>
                  {photoFiles.map((f, i) => (
                    <PhotoThumb key={f.id} file={f} index={i} onDelete={() => handlePhotoDelete(f.id)} />
                  ))}
                </View>
              )}
              {photoFiles.length < 10 && (
                <UploadButton
                  label="사진 추가"
                  hint={`${10 - photoFiles.length}장 더 추가 가능`}
                  icon="camera"
                  onPress={handlePhotoUpload}
                  loading={uploading["photo"]}
                />
              )}
            </SectionCard>

            {/* ── 작성 안내 ─────────────────────────────────────────────── */}
            <View style={s.guideBox}>
              <LucideIcon name="info" size={14} color={MINT} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={s.guideTitle}>자료 제출 안내</Text>
                <Text style={s.guideText}>• 양식을 다운로드하여 작성 후 업로드해 주세요.</Text>
                <Text style={s.guideText}>• 재업로드 시 기존 파일은 이전 버전으로 보관됩니다.</Text>
                <Text style={s.guideText}>• 로고와 홍보사진은 선택사항이나 제출 시 홈페이지 품질이 높아집니다.</Text>
                <Text style={s.guideText}>• 사진은 원본 해상도로 업로드해 주세요 (압축 금지).</Text>
                <Text style={s.guideText}>• 자료 제출 후 SWIMNOTE 팀이 검토하여 연락드립니다.</Text>
              </View>
            </View>

            {/* ── 제출 버튼 ─────────────────────────────────────────────── */}
            {!isSubmitted ? (
              <Pressable
                style={({ pressed }) => [s.submitBtn, pressed && { opacity: 0.78 }, submitting && { opacity: 0.5 }]}
                onPress={handleSubmit}
                disabled={submitting}
              >
                {submitting
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={s.submitBtnText}>검토 요청하기</Text>
                }
              </Pressable>
            ) : (
              <View style={s.resubmitRow}>
                <Text style={s.resubmitHint}>이미 제출된 상태입니다. 파일 재업로드 후 검토 요청이 자동 업데이트됩니다.</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ── Sub Components ─────────────────────────────────────────────────────────

function sectionKoName(section: string): string {
  const map: Record<string, string> = {
    curriculum: "커리큘럼 자료",
    website:    "홈페이지 제작자료",
    logo:       "로고",
    photos:     "홍보사진",
    general:    "전체",
  };
  return map[section] ?? section;
}

function SectionCard({
  icon, title, subtitle, status, required, optional, children,
}: {
  icon: string; title: string; subtitle: string;
  status: SectionStatus; required?: boolean; optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={s.sectionCard}>
      <View style={s.sectionHeader}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
          <LucideIcon name={icon as any} size={18} color={NAVY} />
          <Text style={s.sectionTitle}>{title}</Text>
          {required && <View style={s.reqBadge}><Text style={s.reqBadgeText}>필수</Text></View>}
          {optional && <View style={[s.reqBadge, { backgroundColor: C.backgroundSoft }]}><Text style={[s.reqBadgeText, { color: C.textSecondary }]}>선택</Text></View>}
        </View>
        <View style={[s.sectionStatusBadge, { backgroundColor: sectionBg(status) }]}>
          <Text style={[s.sectionStatusText, { color: sectionColor(status) }]}>{SECTION_LABELS[status]}</Text>
        </View>
      </View>
      <Text style={s.sectionSubtitle}>{subtitle}</Text>
      <View style={{ gap: 10, marginTop: 12 }}>
        {children}
      </View>
    </View>
  );
}

function TemplateDownloadRow({ label, version, onDownload }: { label: string; version?: string; onDownload: () => void }) {
  return (
    <Pressable style={({ pressed }) => [s.templateRow, pressed && { opacity: 0.7 }]} onPress={onDownload}>
      <LucideIcon name="file-text" size={16} color={MINT} />
      <View style={{ flex: 1 }}>
        <Text style={s.templateLabel}>{label}</Text>
        {version && <Text style={s.templateVersion}>양식 v{version}</Text>}
      </View>
      <LucideIcon name="download" size={16} color={MINT} />
    </Pressable>
  );
}

function FileRow({ file, onReupload, uploading, isImage }: {
  file: XSetupFile; onReupload: () => void; uploading?: boolean; isImage?: boolean;
}) {
  return (
    <View style={s.fileRow}>
      <View style={s.fileIconWrap}>
        <LucideIcon name={isImage ? "image" : "file-text"} size={18} color={MINT} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.fileName} numberOfLines={1}>{file.original_filename}</Text>
        <Text style={s.fileMeta}>
          v{file.submission_version} · {formatDate(file.uploaded_at)}
          {file.file_size_bytes ? ` · ${formatBytes(file.file_size_bytes)}` : ""}
        </Text>
      </View>
      <Pressable
        style={({ pressed }) => [s.reuploadBtn, pressed && { opacity: 0.7 }, uploading && { opacity: 0.5 }]}
        onPress={onReupload}
        disabled={uploading}
      >
        {uploading
          ? <ActivityIndicator size="small" color={MINT} />
          : <Text style={s.reuploadBtnText}>재업로드</Text>
        }
      </Pressable>
    </View>
  );
}

function UploadButton({ label, hint, icon, onPress, loading }: {
  label: string; hint?: string; icon: string; onPress: () => void; loading?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [s.uploadBtn, pressed && { opacity: 0.75 }, loading && { opacity: 0.5 }]}
      onPress={onPress}
      disabled={loading}
    >
      {loading ? (
        <ActivityIndicator size="small" color={MINT} />
      ) : (
        <>
          <LucideIcon name={icon as any} size={16} color={MINT} />
          <Text style={s.uploadBtnText}>{label}</Text>
        </>
      )}
      {hint && !loading && <Text style={s.uploadBtnHint}>{hint}</Text>}
    </Pressable>
  );
}

function PhotoThumb({ file, index, onDelete }: { file: XSetupFile; index: number; onDelete: () => void }) {
  // photo는 R2 presigned URL이 없으므로 파일명과 순서만 표시
  return (
    <View style={s.photoThumb}>
      <View style={s.photoThumbInner}>
        <LucideIcon name="image" size={22} color={C.textTertiary} />
        <Text style={s.photoThumbNum}>{(file.photo_order ?? index + 1)}</Text>
      </View>
      <Pressable hitSlop={8} style={s.photoDeleteBtn} onPress={onDelete}>
        <LucideIcon name="x" size={12} color="#fff" />
      </Pressable>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 12,
    backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  backBtn: { width: 32, alignItems: "flex-start" },
  headerTitle: { fontSize: 16, fontFamily: "Pretendard-SemiBold", color: NAVY },
  scroll: { padding: 20, gap: 16 },

  statusCard: {
    backgroundColor: "#fff", borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: BORDER, gap: 8,
  },
  xBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: MINT_LIGHT, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: MINT,
  },
  xBadgeText: { fontSize: 10, fontFamily: "Pretendard-SemiBold", color: NAVY },
  statusBadge: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  statusBadgeText: { fontSize: 11, fontFamily: "Pretendard-SemiBold" },
  statusTitle: { fontSize: 17, fontFamily: "Pretendard-Bold", color: NAVY, marginTop: 4 },
  statusDesc: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 20 },
  submittedAt: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textTertiary, marginTop: 2 },

  wordNotice: {
    flexDirection: "row", gap: 8, alignItems: "flex-start",
    backgroundColor: "#EFF6FF", borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: "#BFDBFE",
  },
  wordNoticeText: {
    flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular",
    color: "#1E40AF", lineHeight: 18,
  },

  revisionBanner: {
    flexDirection: "row", gap: 10, alignItems: "flex-start",
    backgroundColor: AMBER_LIGHT, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: "#FCD34D",
  },
  revisionBannerTitle: { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: "#92400E", marginBottom: 6 },
  revisionItem: { gap: 2, marginBottom: 8 },
  revisionSection: { fontSize: 11, fontFamily: "Pretendard-SemiBold", color: "#78350F" },
  revisionMsg: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#92400E", lineHeight: 19 },

  sectionCard: {
    backgroundColor: "#fff", borderRadius: 16, padding: 18,
    borderWidth: 1, borderColor: BORDER,
  },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  sectionTitle: { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: NAVY },
  sectionSubtitle: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 18 },
  sectionStatusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  sectionStatusText: { fontSize: 10, fontFamily: "Pretendard-SemiBold" },
  reqBadge: { backgroundColor: "#FEF2F2", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  reqBadgeText: { fontSize: 9, fontFamily: "Pretendard-SemiBold", color: "#DC2626" },

  subsectionHeader: { flexDirection: "row", alignItems: "baseline", gap: 8, marginBottom: 6 },
  subsectionTitle: { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: NAVY },
  subsectionHint: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textTertiary },

  templateRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: MINT_LIGHT, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: "#C6D5E3",
  },
  templateLabel: { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: NAVY },
  templateVersion: { fontSize: 10, fontFamily: "Pretendard-Regular", color: C.textTertiary, marginTop: 2 },

  fileRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: GREEN_LIGHT, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: "#BBF7D0",
  },
  fileIconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#D1FAE5", alignItems: "center", justifyContent: "center" },
  fileName: { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: NAVY },
  fileMeta: { fontSize: 10, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 },
  reuploadBtn: { borderRadius: 8, borderWidth: 1, borderColor: MINT, paddingHorizontal: 10, paddingVertical: 5 },
  reuploadBtnText: { fontSize: 11, fontFamily: "Pretendard-SemiBold", color: MINT },

  uploadBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1.5, borderColor: MINT, borderStyle: "dashed",
    borderRadius: 10, padding: 12, justifyContent: "center",
  },
  uploadBtnText: { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: MINT },
  uploadBtnHint: { fontSize: 10, fontFamily: "Pretendard-Regular", color: C.textTertiary, marginLeft: "auto" },

  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  photoThumb: { width: 72, height: 72, borderRadius: 10, overflow: "visible" },
  photoThumbInner: {
    width: 72, height: 72, borderRadius: 10,
    backgroundColor: C.backgroundSoft, borderWidth: 1, borderColor: BORDER,
    alignItems: "center", justifyContent: "center", gap: 4,
  },
  photoThumbNum: { fontSize: 10, fontFamily: "Pretendard-SemiBold", color: C.textSecondary },
  photoDeleteBtn: {
    position: "absolute", top: -6, right: -6,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: RED, alignItems: "center", justifyContent: "center",
    zIndex: 1,
  },

  guideBox: {
    flexDirection: "row", gap: 10, alignItems: "flex-start",
    backgroundColor: MINT_LIGHT, borderRadius: 12, padding: 14,
  },
  guideTitle: { fontSize: 12, fontFamily: "Pretendard-SemiBold", color: NAVY, marginBottom: 4 },
  guideText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: MINT, lineHeight: 18 },

  submitBtn: {
    backgroundColor: NAVY, borderRadius: 14, paddingVertical: 16,
    alignItems: "center", marginTop: 4,
  },
  submitBtnText: { fontSize: 16, fontFamily: "Pretendard-SemiBold", color: "#fff" },

  resubmitRow: { alignItems: "center", paddingVertical: 8 },
  resubmitHint: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, textAlign: "center", lineHeight: 18 },
});
