/**
 * (teacher)/photos.tsx — 사진 & 영상 탭
 *
 * 4버튼 그리드:
 *  [사진-반전체]  [사진-개인]
 *  [영상-반전체]  [영상-개인]
 *
 * 각 버튼 클릭 → 시간표 → 반 선택 → (개인: 학생 선택) → 업로드
 */
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Image, Platform,
  Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, safeJson, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { PoolHeader } from "@/components/PoolHeader";
import { WeeklySchedule, TeacherClassGroup, SlotStatus } from "@/components/teacher/WeeklySchedule";

const C = Colors.light;

type MediaType = "photo" | "video";
type AlbumScope = "group" | "private";
type Step = "home" | "schedule" | "student" | "upload";

interface Student { id: string; name: string; assigned_class_ids?: string[]; class_group_id?: string | null; }
interface MediaUsage {
  photo_bytes: number; photo_count: number;
  video_bytes: number; video_count: number;
  total_bytes: number; month_bytes: number;
}

function fmtBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const MEDIA_CONFIG: Record<`${MediaType}_${AlbumScope}`, {
  icon: React.ComponentProps<typeof Feather>["name"];
  title: string; sub: string; color: string; bg: string;
}> = {
  photo_group:   { icon: "image",   title: "사진", sub: "반 전체 앨범", color: "#F59E0B", bg: "#FEF3C7" },
  photo_private: { icon: "user",    title: "사진", sub: "개인 앨범",   color: "#1A5CFF", bg: "#EFF6FF" },
  video_group:   { icon: "video",   title: "영상", sub: "반 전체 앨범", color: "#059669", bg: "#D1FAE5" },
  video_private: { icon: "film",    title: "영상", sub: "개인 앨범",   color: "#7C3AED", bg: "#EDE9FE" },
};

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "/api";

export default function TeacherPhotosScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();

  const [groups,     setGroups]     = useState<TeacherClassGroup[]>([]);
  const [students,   setStudents]   = useState<Student[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [uploading,  setUploading]  = useState(false);
  const [usage,      setUsage]      = useState<MediaUsage | null>(null);

  const [mediaType, setMediaType] = useState<MediaType>("photo");
  const [scope,     setScope]     = useState<AlbumScope>("group");
  const [step,      setStep]      = useState<Step>("home");
  const [selGroup,  setSelGroup]  = useState<TeacherClassGroup | null>(null);
  const [selStudent,setSelStudent]= useState<Student | null>(null);

  useEffect(() => {
    (async () => {
      const [cgRes, stRes, usageRes] = await Promise.all([
        apiRequest(token, "/class-groups"),
        apiRequest(token, "/students"),
        apiRequest(token, "/teacher/me/media-usage"),
      ]);
      const [cls, sts] = await Promise.all([safeJson(cgRes), safeJson(stRes)]);
      setGroups(Array.isArray(cls) ? cls : []);
      setStudents(Array.isArray(sts) ? sts : []);
      if (usageRes.ok) setUsage(await usageRes.json());
      setLoading(false);
    })();
  }, []);

  function startFlow(mt: MediaType, sc: AlbumScope) {
    setMediaType(mt);
    setScope(sc);
    setSelGroup(null);
    setSelStudent(null);
    setStep("schedule");
  }

  function selectGroup(g: TeacherClassGroup) {
    setSelGroup(g);
    if (scope === "private") setStep("student");
    else setStep("upload");
  }

  function selectStudent(st: Student) {
    setSelStudent(st);
    setStep("upload");
  }

  const cfg = MEDIA_CONFIG[`${mediaType}_${scope}`];
  const groupStudents = selGroup
    ? students.filter(st =>
        (Array.isArray(st.assigned_class_ids) && st.assigned_class_ids.includes(selGroup.id))
        || st.class_group_id === selGroup.id
      ).sort((a, b) => a.name.localeCompare(b.name))
    : [];

  async function pickAndUpload() {
    const isVideo = mediaType === "video";
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("권한 필요", "미디어 접근 권한이 필요합니다."); return; }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: isVideo ? ["videos"] : ["images"],
      allowsMultipleSelection: !isVideo,
      quality: isVideo ? 1 : 0.85,
    });
    if (result.canceled || !result.assets?.length) return;

    setUploading(true);
    try {
      const form = new FormData();
      for (const asset of result.assets) {
        const fieldName = isVideo ? "video" : "photos";
        form.append(fieldName, {
          uri: asset.uri,
          name: asset.fileName || (isVideo ? "video.mp4" : "photo.jpg"),
          type: asset.mimeType || (isVideo ? "video/mp4" : "image/jpeg"),
        } as any);
      }
      form.append("class_id", selGroup!.id);
      if (scope === "private") form.append("student_id", selStudent!.id);

      const endpoint = isVideo
        ? (scope === "group" ? "/videos/group" : "/videos/private")
        : (scope === "group" ? "/photos/group" : "/photos/private");

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((resData as any).error || "업로드 실패");

      Alert.alert(
        "업로드 완료",
        scope === "group"
          ? `${isVideo ? "영상" : `${result.assets.length}장`}이 ${selGroup!.name} ${isVideo ? "영상" : "사진"} 앨범에 추가됐습니다.`
          : `${isVideo ? "영상" : `${result.assets.length}장`}이 ${selStudent!.name} 개인 ${isVideo ? "영상" : "사진"} 앨범에 추가됐습니다.`,
        [{ text: "확인", onPress: () => setStep("home") }]
      );
    } catch (e: any) { Alert.alert("오류", e.message || "업로드 실패"); }
    finally { setUploading(false); }
  }

  // statusMap (photos 화면은 상태 표시 불필요지만 컴포넌트 요구사항)
  const statusMap: Record<string, SlotStatus> = {};
  groups.forEach(g => { statusMap[g.id] = { attChecked: 0, diaryDone: true, hasPhotos: false }; });

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <PoolHeader />
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  // ── 홈: 4버튼 그리드 + 사용량 ────────────────────────────────────────
  if (step === "home") {
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <PoolHeader />
        <View style={s.subHeader}>
          <Pressable style={s.backBtn} onPress={() => router.back()}>
            <Feather name="arrow-left" size={20} color={C.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={s.subTitle}>{"사진 & 영상"}</Text>
          </View>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          <View style={s.titleRow}><Text style={s.title}>{"사진 & 영상"}</Text></View>
          <View style={s.grid}>
            {(["photo_group", "photo_private", "video_group", "video_private"] as const).map(key => {
              const [mt, sc] = key.split("_") as [MediaType, AlbumScope];
              const c = MEDIA_CONFIG[key];
              return (
                <Pressable
                  key={key}
                  style={[s.gridBtn, { backgroundColor: c.bg, borderColor: c.color + "40" }]}
                  onPress={() => startFlow(mt, sc)}
                >
                  <View style={[s.gridIcon, { backgroundColor: c.color + "25" }]}>
                    <Feather name={c.icon} size={28} color={c.color} />
                  </View>
                  <Text style={[s.gridTitle, { color: c.color }]}>{c.title}</Text>
                  <Text style={[s.gridSub, { color: c.color + "CC" }]}>{c.sub}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* 사용량 카드 */}
          <View style={s.usageCard}>
            <View style={s.usageCardHeader}>
              <Feather name="hard-drive" size={15} color={themeColor} />
              <Text style={[s.usageCardTitle, { color: themeColor }]}>내 업로드 사용량</Text>
            </View>
            <View style={s.usageCardBody}>
              <View style={s.usageItem}>
                <Feather name="image" size={14} color="#F59E0B" />
                <Text style={s.usageItemLabel}>사진 {usage?.photo_count || 0}개</Text>
                <Text style={s.usageItemBytes}>{fmtBytes(usage?.photo_bytes || 0)}</Text>
              </View>
              <View style={s.usageDivider} />
              <View style={s.usageItem}>
                <Feather name="video" size={14} color="#7C3AED" />
                <Text style={s.usageItemLabel}>영상 {usage?.video_count || 0}개</Text>
                <Text style={s.usageItemBytes}>{fmtBytes(usage?.video_bytes || 0)}</Text>
              </View>
              <View style={s.usageDivider} />
              <View style={[s.usageItem, { backgroundColor: themeColor + "08" }]}>
                <Feather name="database" size={14} color={themeColor} />
                <Text style={[s.usageItemLabel, { color: themeColor, fontFamily: "Inter_700Bold" }]}>총 사용량</Text>
                <Text style={[s.usageItemBytes, { color: themeColor, fontFamily: "Inter_700Bold" }]}>{fmtBytes(usage?.total_bytes || 0)}</Text>
              </View>
              <Text style={s.usageMonthText}>이번 달: {fmtBytes(usage?.month_bytes || 0)}</Text>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── 시간표 단계 ──────────────────────────────────────────────
  if (step === "schedule") {
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <PoolHeader />
        <View style={s.subHeader}>
          <Pressable style={s.backBtn} onPress={() => setStep("home")}>
            <Feather name="arrow-left" size={20} color={C.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={s.subTitle}>{cfg.title} {cfg.sub}</Text>
            <Text style={s.subSub}>수업 반을 선택하세요</Text>
          </View>
          <View style={[s.cfgBadge, { backgroundColor: cfg.bg }]}>
            <Feather name={cfg.icon} size={14} color={cfg.color} />
            <Text style={[s.cfgBadgeText, { color: cfg.color }]}>{cfg.sub}</Text>
          </View>
        </View>
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
          <WeeklySchedule
            classGroups={groups}
            statusMap={statusMap}
            onSelectClass={selectGroup}
            themeColor={cfg.color}
          />
          <View style={{ height: 100 }} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── 학생 선택 단계 (개인 앨범) ──────────────────────────────
  if (step === "student") {
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <PoolHeader />
        <View style={s.subHeader}>
          <Pressable style={s.backBtn} onPress={() => setStep("schedule")}>
            <Feather name="arrow-left" size={20} color={C.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={s.subTitle}>{selGroup?.name} · 학생 선택</Text>
            <Text style={s.subSub}>개인 {cfg.title} 앨범에 업로드할 학생을 선택하세요</Text>
          </View>
        </View>
        <ScrollView contentContainerStyle={s.studentList} showsVerticalScrollIndicator={false}>
          {groupStudents.length === 0 ? (
            <View style={s.emptyBox}>
              <Feather name="users" size={32} color={C.textMuted} />
              <Text style={s.emptyText}>이 반에 배정된 학생이 없습니다</Text>
            </View>
          ) : groupStudents.map(st => (
            <Pressable key={st.id} style={[s.studentRow, { backgroundColor: C.card }]} onPress={() => selectStudent(st)}>
              <View style={[s.avatar, { backgroundColor: cfg.color + "20" }]}>
                <Text style={[s.avatarText, { color: cfg.color }]}>{st.name[0]}</Text>
              </View>
              <Text style={s.studentName}>{st.name}</Text>
              <Feather name="chevron-right" size={18} color={C.textMuted} />
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── 업로드 단계 ──────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <PoolHeader />
      <View style={s.subHeader}>
        <Pressable style={s.backBtn} onPress={() => setStep(scope === "private" ? "student" : "schedule")}>
          <Feather name="arrow-left" size={20} color={C.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.subTitle}>
            {scope === "group" ? selGroup?.name : selStudent?.name} · {cfg.sub}
          </Text>
          <Text style={s.subSub}>{cfg.title} 업로드</Text>
        </View>
      </View>

      <View style={s.uploadCenter}>
        <View style={[s.uploadIcon, { backgroundColor: cfg.bg }]}>
          <Feather name={cfg.icon} size={48} color={cfg.color} />
        </View>
        <Text style={s.uploadTitle}>
          {scope === "group"
            ? `${selGroup?.name}에 ${cfg.title} 업로드`
            : `${selStudent?.name}의 개인 ${cfg.title} 업로드`}
        </Text>
        <Text style={s.uploadSub}>
          {mediaType === "video"
            ? "영상 파일 1개를 선택하세요\n(mp4, mov 등)"
            : "사진 파일을 다중 선택할 수 있습니다"}
        </Text>
        <Pressable
          style={[s.uploadBtn, { backgroundColor: cfg.color, opacity: uploading ? 0.7 : 1 }]}
          onPress={pickAndUpload}
          disabled={uploading}
        >
          {uploading
            ? <ActivityIndicator color="#fff" />
            : <><Feather name="upload-cloud" size={20} color="#fff" />
                <Text style={s.uploadBtnText}>{cfg.title} 선택 및 업로드</Text></>
          }
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: "#F3F4F6" },
  titleRow:   { paddingHorizontal: 16, paddingVertical: 10 },
  title:      { fontSize: 20, fontFamily: "Inter_700Bold", color: "#111827" },

  grid:       { flex: 1, flexDirection: "row", flexWrap: "wrap", padding: 12, gap: 12 },
  gridBtn:    { width: "47%", aspectRatio: 1, borderRadius: 20, borderWidth: 1.5, alignItems: "center", justifyContent: "center", gap: 10 },
  gridIcon:   { width: 60, height: 60, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  gridTitle:  { fontSize: 18, fontFamily: "Inter_700Bold" },
  gridSub:    { fontSize: 13, fontFamily: "Inter_500Medium" },

  subHeader:  { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  backBtn:    { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  subTitle:   { fontSize: 16, fontFamily: "Inter_700Bold", color: "#111827" },
  subSub:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 1 },
  cfgBadge:   { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  cfgBadgeText:{ fontSize: 12, fontFamily: "Inter_600SemiBold" },

  studentList: { padding: 12, gap: 8, paddingBottom: 100 },
  studentRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14 },
  avatar:     { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  studentName:{ flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#111827" },

  uploadCenter: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 40 },
  uploadIcon:   { width: 100, height: 100, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  uploadTitle:  { fontSize: 18, fontFamily: "Inter_700Bold", color: "#111827", textAlign: "center" },
  uploadSub:    { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6B7280", textAlign: "center", lineHeight: 20 },
  uploadBtn:    { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 28, paddingVertical: 16, borderRadius: 16 },
  uploadBtnText:{ color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },

  emptyBox:   { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyText:  { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF" },

  usageCard:        { marginHorizontal: 12, marginTop: 4, backgroundColor: "#fff", borderRadius: 16, overflow: "hidden" },
  usageCardHeader:  { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  usageCardTitle:   { fontSize: 14, fontFamily: "Inter_700Bold" },
  usageCardBody:    { padding: 12, gap: 2 },
  usageItem:        { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8, paddingVertical: 10, borderRadius: 10 },
  usageItemLabel:   { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#374151" },
  usageItemBytes:   { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#374151" },
  usageDivider:     { height: 1, backgroundColor: "#F3F4F6", marginHorizontal: 8 },
  usageMonthText:   { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", textAlign: "center", paddingTop: 6 },
});
