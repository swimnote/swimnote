/**
 * (admin)/invite-sms.tsx — 초대방식 설정
 * SMS 과금/크레딧 구조 완전 제거.
 * 기기 기본 문자앱 호출 + 수신번호·본문 자동완성 방식.
 * 탭: 초대 설정 | 초대 기록
 */
import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  FlatList, Linking, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import {
  useInviteRecordStore,
  resolveTemplate,
  TEACHER_TEMPLATE_FIXED,
  DEFAULT_PARENT_TEMPLATE,
  InviteRecord,
  InviteTargetType,
} from "@/store/inviteRecordStore";

const GREEN = "#1F8F86";

const PARENT_VARS = [
  { label: "{수영장이름}", value: "{수영장이름}" },
  { label: "{학생이름}",   value: "{학생이름}" },
  { label: "{iOS링크}",    value: "{iOS링크}" },
  { label: "{Android링크}", value: "{Android링크}" },
];

type Tab = "settings" | "records";

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("ko-KR", {
    month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

const TYPE_CFG: Record<InviteTargetType, { label: string; icon: string; color: string; bg: string }> = {
  guardian: { label: "학부모", icon: "users",      color: GREEN,     bg: "#DDF2EF" },
  teacher:  { label: "선생님", icon: "user-check",  color: "#7C3AED", bg: "#EEDDF5" },
};

export default function InviteSmsScreen() {
  const { pool } = useAuth();
  const insets   = useSafeAreaInsets();
  const poolName = pool?.name ?? "우리 수영장";

  const {
    parentTemplateBody, iosLink, androidLink,
    setParentTemplate, resetParentTemplate, setAppLinks,
    records, reNotify,
  } = useInviteRecordStore();

  const [tab, setTab]             = useState<Tab>("settings");
  const [editBody, setEditBody]   = useState(parentTemplateBody);
  const [dirty, setDirty]         = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [editIos, setEditIos]         = useState(iosLink);
  const [editAndroid, setEditAndroid] = useState(androidLink);
  const [linkDirty, setLinkDirty]     = useState(false);
  const [showReset, setShowReset]     = useState(false);
  const [filterType, setFilterType]   = useState<"all" | InviteTargetType>("all");

  const teacherPreview = resolveTemplate(TEACHER_TEMPLATE_FIXED, {
    poolName, iosLink, androidLink,
  });

  const parentPreview = resolveTemplate(editBody, {
    poolName, studentName: "홍길동", iosLink, androidLink,
  });

  function insertVar(v: string) {
    setEditBody(prev => prev + v);
    setDirty(true);
  }

  function saveTemplate() {
    setParentTemplate(editBody);
    setDirty(false);
  }

  function saveLinks() {
    setAppLinks(editIos.trim(), editAndroid.trim());
    setLinkDirty(false);
  }

  function doReset() {
    resetParentTemplate();
    setEditBody(DEFAULT_PARENT_TEMPLATE);
    setDirty(false);
    setShowReset(false);
  }

  async function openTeacherSms() {
    const body = teacherPreview;
    const url  = Platform.OS === "ios"
      ? `sms:&body=${encodeURIComponent(body)}`
      : `sms:?body=${encodeURIComponent(body)}`;
    const can = await Linking.canOpenURL(url);
    if (can) await Linking.openURL(url);
  }

  async function doReNotify(rec: InviteRecord) {
    reNotify(rec.id);
    const rawPhone = rec.targetPhone.replace(/\D/g, "");
    const url      = Platform.OS === "ios"
      ? `sms:${rawPhone}&body=${encodeURIComponent(rec.messageBody)}`
      : `sms:${rawPhone}?body=${encodeURIComponent(rec.messageBody)}`;
    const can = await Linking.canOpenURL(url);
    if (can) await Linking.openURL(url);
  }

  const filteredRecs = useMemo(() =>
    filterType === "all" ? records : records.filter(r => r.targetType === filterType),
    [records, filterType]
  );

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="초대방식 설정" homePath="/(admin)/dashboard" />

      {/* 탭 바 */}
      <View style={s.tabRow}>
        {([
          { key: "settings", label: "초대 설정" },
          { key: "records",  label: "초대 기록" },
        ] as const).map(t => (
          <Pressable
            key={t.key}
            style={[s.tab, tab === t.key && s.tabActive]}
            onPress={() => setTab(t.key)}
          >
            <Text style={[s.tabTxt, tab === t.key && { color: GREEN, fontFamily: "Inter_700Bold" }]}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* ═══════════════ 초대 설정 탭 ═══════════════ */}
      {tab === "settings" && (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 80 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* A. 안내 배너 */}
          <View style={s.infoBanner}>
            <Feather name="info" size={18} color={GREEN} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={s.infoTitle}>스윔노트 초대 방식 안내</Text>
              <Text style={s.infoBody}>
                스윔노트는 문자 발송 서비스를 판매하지 않습니다.{"\n"}
                기기의 기본 문자앱을 열어 초대 메시지를 발송합니다.{"\n"}
                수신번호와 본문은 자동으로 입력됩니다.
              </Text>
            </View>
          </View>

          {/* B. 선생님 초대 문구 (고정) */}
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <View style={[s.iconBox, { backgroundColor: "#EEDDF5" }]}>
                <Feather name="user-check" size={18} color="#7C3AED" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.sectionTitle}>선생님 초대 문구</Text>
                <View style={s.fixedBadge}>
                  <Text style={s.fixedBadgeTxt}>수정 불가 고정 문구</Text>
                </View>
              </View>
            </View>

            <View style={s.previewBox}>
              <Text style={s.previewTxt}>{teacherPreview}</Text>
            </View>

            <View style={s.btnRow}>
              <Pressable
                style={s.outlineBtn}
                onPress={async () => { await Clipboard.setStringAsync(teacherPreview); }}
              >
                <Feather name="copy" size={14} color="#6F6B68" />
                <Text style={s.outlineBtnTxt}>복사</Text>
              </Pressable>
              <Pressable style={[s.colorBtn, { backgroundColor: "#EEDDF5" }]} onPress={openTeacherSms}>
                <Feather name="message-square" size={14} color="#7C3AED" />
                <Text style={[s.colorBtnTxt, { color: "#7C3AED" }]}>문자앱 테스트 열기</Text>
              </Pressable>
            </View>
          </View>

          {/* C. 학부모 초대 문구 (수정 가능) */}
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <View style={[s.iconBox, { backgroundColor: "#DDF2EF" }]}>
                <Feather name="users" size={18} color={GREEN} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.sectionTitle}>학부모 초대 문구</Text>
                <Text style={s.sectionSub}>변수를 포함해 자유롭게 수정할 수 있습니다</Text>
              </View>
            </View>

            <View>
              <Text style={s.label}>변수 삽입</Text>
              <View style={s.varRow}>
                {PARENT_VARS.map(v => (
                  <Pressable key={v.value} style={s.varBtn} onPress={() => insertVar(v.value)}>
                    <Text style={s.varBtnTxt}>{v.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View>
              <Text style={s.label}>문구 편집</Text>
              <TextInput
                style={s.templateInput}
                value={editBody}
                onChangeText={v => { setEditBody(v); setDirty(true); }}
                multiline
                textAlignVertical="top"
                placeholder="학부모 초대 문구를 입력하세요"
              />
            </View>

            <Pressable style={s.previewToggle} onPress={() => setShowPreview(p => !p)}>
              <Feather name={showPreview ? "eye-off" : "eye"} size={14} color={GREEN} />
              <Text style={[s.previewToggleTxt, { color: GREEN }]}>
                {showPreview ? "미리보기 닫기" : "미리보기 (홍길동 기준)"}
              </Text>
            </Pressable>
            {showPreview && (
              <View style={s.previewBox}>
                <Text style={s.previewTxt}>{parentPreview}</Text>
              </View>
            )}

            <View style={s.btnRow}>
              <Pressable style={s.outlineBtn} onPress={() => setShowReset(true)}>
                <Feather name="rotate-ccw" size={14} color="#9A948F" />
                <Text style={s.outlineBtnTxt}>초기화</Text>
              </Pressable>
              <Pressable
                style={[s.colorBtn, dirty ? { backgroundColor: GREEN } : s.disabledBtn]}
                onPress={saveTemplate}
                disabled={!dirty}
              >
                <Feather name="check" size={14} color={dirty ? "#fff" : "#B0AAA6"} />
                <Text style={[s.colorBtnTxt, { color: dirty ? "#fff" : "#B0AAA6" }]}>
                  {dirty ? "저장" : "저장됨"}
                </Text>
              </Pressable>
            </View>
          </View>

          {/* D. 다운로드 링크 설정 */}
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <View style={[s.iconBox, { backgroundColor: "#E0F2FE" }]}>
                <Feather name="link" size={18} color="#0284C7" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.sectionTitle}>다운로드 링크 설정</Text>
                <Text style={s.sectionSub}>초대 문자에 삽입되는 앱 링크</Text>
              </View>
            </View>

            <View>
              <Text style={s.label}>앱스토어 링크 (iOS)</Text>
              <TextInput
                style={s.linkInput}
                value={editIos}
                onChangeText={v => { setEditIos(v); setLinkDirty(true); }}
                placeholder="https://apps.apple.com/..."
                autoCapitalize="none"
                keyboardType="url"
              />
            </View>
            <View>
              <Text style={s.label}>플레이스토어 링크 (Android)</Text>
              <TextInput
                style={s.linkInput}
                value={editAndroid}
                onChangeText={v => { setEditAndroid(v); setLinkDirty(true); }}
                placeholder="https://play.google.com/..."
                autoCapitalize="none"
                keyboardType="url"
              />
            </View>

            <View style={s.btnRow}>
              <Pressable
                style={s.outlineBtn}
                onPress={async () => {
                  await Clipboard.setStringAsync(`iOS: ${editIos}\nAndroid: ${editAndroid}`);
                }}
              >
                <Feather name="copy" size={14} color="#6F6B68" />
                <Text style={s.outlineBtnTxt}>링크 복사</Text>
              </Pressable>
              <Pressable
                style={[s.colorBtn, linkDirty ? { backgroundColor: GREEN } : s.disabledBtn]}
                onPress={saveLinks}
                disabled={!linkDirty}
              >
                <Feather name="check" size={14} color={linkDirty ? "#fff" : "#B0AAA6"} />
                <Text style={[s.colorBtnTxt, { color: linkDirty ? "#fff" : "#B0AAA6" }]}>
                  {linkDirty ? "저장" : "저장됨"}
                </Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      )}

      {/* ═══════════════ 초대 기록 탭 ═══════════════ */}
      {tab === "records" && (
        <View style={{ flex: 1 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.filterRow}>
            {(["all", "guardian", "teacher"] as const).map(k => {
              const labels = { all: "전체", guardian: "학부모", teacher: "선생님" };
              const active = filterType === k;
              return (
                <Pressable
                  key={k}
                  style={[s.filterChip, active && { backgroundColor: GREEN + "22", borderColor: GREEN }]}
                  onPress={() => setFilterType(k)}
                >
                  <Text style={[s.filterChipTxt, active && { color: GREEN, fontFamily: "Inter_700Bold" }]}>
                    {labels[k]}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <FlatList
            data={filteredRecs}
            keyExtractor={r => r.id}
            contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 80 }}
            ListEmptyComponent={
              <View style={s.empty}>
                <Feather name="inbox" size={32} color="#D1CBC6" />
                <Text style={s.emptyTxt}>초대 기록이 없습니다</Text>
              </View>
            }
            renderItem={({ item: r }) => {
              const cfg = TYPE_CFG[r.targetType];
              return (
                <View style={s.recCard}>
                  <View style={[s.recIcon, { backgroundColor: cfg.bg }]}>
                    <Feather name={cfg.icon as any} size={18} color={cfg.color} />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={s.recNameRow}>
                      <Text style={s.recName}>{r.targetName}</Text>
                      <View style={[s.badge, { backgroundColor: cfg.bg }]}>
                        <Text style={[s.badgeTxt, { color: cfg.color }]}>{cfg.label}</Text>
                      </View>
                      {r.callCount > 1 && (
                        <View style={[s.badge, { backgroundColor: "#FFF1BF" }]}>
                          <Text style={[s.badgeTxt, { color: "#D97706" }]}>{r.callCount}회</Text>
                        </View>
                      )}
                    </View>
                    <Text style={s.recMeta}>{r.targetPhone}</Text>
                    {r.studentName ? <Text style={s.recMeta}>자녀: {r.studentName}</Text> : null}
                    <Text style={s.recMeta}>
                      최초: {fmtDate(r.createdAt)}
                      {r.lastReSentAt ? `  ·  재발송: ${fmtDate(r.lastReSentAt)}` : ""}
                    </Text>
                  </View>
                  <Pressable style={s.reBtn} onPress={() => doReNotify(r)}>
                    <Feather name="send" size={13} color={GREEN} />
                    <Text style={s.reBtnTxt}>재발송</Text>
                  </Pressable>
                </View>
              );
            }}
          />
        </View>
      )}

      <ConfirmModal
        visible={showReset}
        title="학부모 문구 초기화"
        message="저장된 학부모 초대 문구를 기본값으로 되돌립니다. 계속하시겠습니까?"
        confirmText="초기화"
        destructive
        onConfirm={doReset}
        onCancel={() => setShowReset(false)}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: "#F6F3F1" },
  tabRow:        { flexDirection: "row", backgroundColor: "#fff",
                   borderBottomWidth: 1, borderBottomColor: "#E9E2DD" },
  tab:           { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabActive:     { borderBottomWidth: 2, borderBottomColor: GREEN },
  tabTxt:        { fontSize: 14, fontFamily: "Inter_500Medium", color: "#6F6B68" },

  infoBanner:    { flexDirection: "row", gap: 10, backgroundColor: "#E8F7F5",
                   borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#A7D4CF" },
  infoTitle:     { fontSize: 13, fontFamily: "Inter_700Bold", color: "#1F1F1F", marginBottom: 2 },
  infoBody:      { fontSize: 12, fontFamily: "Inter_400Regular", color: "#4B6F6C", lineHeight: 19 },

  section:       { backgroundColor: "#fff", borderRadius: 14, padding: 16,
                   gap: 12, borderWidth: 1, borderColor: "#E9E2DD" },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconBox:       { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sectionTitle:  { fontSize: 15, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  sectionSub:    { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9A948F", marginTop: 2 },

  fixedBadge:    { marginTop: 4, alignSelf: "flex-start", backgroundColor: "#F1F5F9",
                   borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  fixedBadgeTxt: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#64748B" },

  previewBox:    { backgroundColor: "#F6F3F1", borderRadius: 10, padding: 12,
                   borderWidth: 1, borderColor: "#E9E2DD" },
  previewTxt:    { fontSize: 12, fontFamily: "Inter_400Regular", color: "#1F1F1F", lineHeight: 20 },
  previewToggle: { flexDirection: "row", alignItems: "center", gap: 6 },
  previewToggleTxt: { fontSize: 13, fontFamily: "Inter_500Medium" },

  label:         { fontSize: 12, fontFamily: "Inter_500Medium", color: "#6F6B68", marginBottom: 6 },

  varRow:        { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  varBtn:        { backgroundColor: "#EEF2FF", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  varBtnTxt:     { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#4F46E5" },

  templateInput: { borderWidth: 1.5, borderColor: "#E9E2DD", borderRadius: 10,
                   padding: 12, minHeight: 140, fontSize: 13,
                   fontFamily: "Inter_400Regular", color: "#1F1F1F", lineHeight: 20 },
  linkInput:     { borderWidth: 1.5, borderColor: "#E9E2DD", borderRadius: 10,
                   paddingHorizontal: 12, paddingVertical: 10, fontSize: 13,
                   fontFamily: "Inter_400Regular", color: "#1F1F1F" },

  btnRow:        { flexDirection: "row", gap: 10 },
  outlineBtn:    { flexDirection: "row", alignItems: "center", gap: 5, flex: 1, height: 40,
                   borderRadius: 10, justifyContent: "center",
                   backgroundColor: "#F6F3F1", borderWidth: 1, borderColor: "#E9E2DD" },
  outlineBtnTxt: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#6F6B68" },
  colorBtn:      { flexDirection: "row", alignItems: "center", gap: 5, flex: 1, height: 40,
                   borderRadius: 10, justifyContent: "center" },
  colorBtnTxt:   { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  disabledBtn:   { backgroundColor: "#F6F3F1", borderWidth: 1, borderColor: "#E9E2DD" },

  filterRow:     { paddingHorizontal: 16, paddingVertical: 10, gap: 8,
                   borderBottomWidth: 1, borderBottomColor: "#E9E2DD", backgroundColor: "#fff" },
  filterChip:    { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
                   borderWidth: 1, borderColor: "#E9E2DD", backgroundColor: "#fff" },
  filterChipTxt: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#6F6B68" },

  recCard:       { flexDirection: "row", alignItems: "flex-start", gap: 10,
                   backgroundColor: "#fff", borderRadius: 14, padding: 14,
                   borderWidth: 1, borderColor: "#E9E2DD" },
  recIcon:       { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  recNameRow:    { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  recName:       { fontSize: 14, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  badge:         { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  badgeTxt:      { fontSize: 10, fontFamily: "Inter_700Bold" },
  recMeta:       { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9A948F" },
  reBtn:         { flexDirection: "row", alignItems: "center", gap: 4,
                   paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8,
                   backgroundColor: "#DDF2EF" },
  reBtnTxt:      { fontSize: 11, fontFamily: "Inter_600SemiBold", color: GREEN },

  empty:         { alignItems: "center", paddingVertical: 60, gap: 10 },
  emptyTxt:      { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9A948F" },
});
