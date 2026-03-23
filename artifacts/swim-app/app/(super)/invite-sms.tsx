/**
 * (super)/invite-sms.tsx — SMS 템플릿·발송 로그·인증 기록 관리 (슈퍼관리자)
 * 슈퍼관리자 역할: 정책 설정 + 사용량/과금 내역 조회 + 차단 기준 관리
 * 발송 주체는 운영자. 슈퍼관리자는 로그 조회 + 템플릿 편집만 수행.
 */
import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  FlatList, Modal, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useSmsStore } from "@/store/smsStore";
import { useAuditLogStore } from "@/store/auditLogStore";
import type { SmsType, InviteRole, InviteRecord, SmsRecord } from "@/domain/types";

const P = "#7C3AED";
const DANGER = "#D96C6C";
const WARN = "#D97706";
const GREEN = "#1F8F86";

const TABS = [
  { key: "log",     label: "발송 로그" },
  { key: "failed",  label: "실패 로그" },
  { key: "invites", label: "초대 현황" },
  { key: "auth",    label: "인증 기록" },
  { key: "templates",label: "템플릿" },
];

const INVITE_ROLE_CFG: Record<InviteRole, { label: string; color: string; bg: string; icon: string }> = {
  operator: { label: "운영자", color: "#7C3AED", bg: "#EEDDF5", icon: "briefcase" },
  teacher:  { label: "선생님", color: "#1F8F86", bg: "#ECFEFF", icon: "user" },
  parent:   { label: "학부모", color: "#1F8F86", bg: "#DDF2EF", icon: "users" },
};
const INVITE_STATUS_CFG = {
  pending:   { label: "대기", color: WARN,    bg: "#FFF1BF" },
  accepted:  { label: "수락", color: GREEN,   bg: "#DDF2EF" },
  expired:   { label: "만료", color: "#9A948F", bg: "#F6F3F1" },
  cancelled: { label: "취소", color: DANGER,  bg: "#F9DEDA" },
};
const SMS_TYPE_CFG: Record<SmsType, { label: string; color: string }> = {
  teacher_invite:   { label: "선생님 초대",  color: "#1F8F86" },
  parent_connect:   { label: "학부모 연결",  color: GREEN },
  phone_verify:     { label: "휴대폰 인증",  color: P },
  policy_reconfirm: { label: "정책 재확인",  color: WARN },
  payment_fail:     { label: "결제 실패",    color: DANGER },
  storage_warn:     { label: "저장공간 경고", color: "#EA580C" },
  deletion_notice:  { label: "삭제 예정",    color: "#991B1B" },
};

// mock 인증 기록
const AUTH_LOG_MOCK = [
  { id: "a1", phone: "010-1234-5678", type: "가입 인증", status: "success", time: "2026-03-22T10:34:00Z", operator: "서울수영장" },
  { id: "a2", phone: "010-9876-5432", type: "가입 인증", status: "failed",  time: "2026-03-22T09:21:00Z", operator: "부산아쿠아" },
  { id: "a3", phone: "010-5555-1234", type: "2FA 인증",  status: "success", time: "2026-03-22T08:05:00Z", operator: "—" },
  { id: "a4", phone: "010-7777-8888", type: "가입 인증", status: "expired", time: "2026-03-21T22:10:00Z", operator: "인천풀" },
  { id: "a5", phone: "010-2222-3333", type: "재발송",    status: "success", time: "2026-03-21T17:44:00Z", operator: "대전수영" },
  { id: "a6", phone: "010-4444-9999", type: "2FA 인증",  status: "failed",  time: "2026-03-21T14:30:00Z", operator: "—" },
];

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function InviteSmsScreen() {
  const { adminUser } = useAuth();
  const actorName = adminUser?.name ?? "슈퍼관리자";

  const records        = useSmsStore(s => s.records);
  const templates      = useSmsStore(s => s.templates);
  const invites        = useSmsStore(s => s.invites);
  const resendInvite   = useSmsStore(s => s.resendInvite);
  const cancelInvite   = useSmsStore(s => s.cancelInvite);
  const updateTemplate = useSmsStore(s => s.updateTemplate);
  const createLog      = useAuditLogStore(s => s.createLog);

  const [tab, setTab] = useState("log");
  const [editTplModal, setEditTplModal] = useState<null | typeof templates[0]>(null);
  const [tplBody, setTplBody] = useState("");

  const stats = useMemo(() => ({
    totalSent:    records.filter(r => r.status === "sent").length,
    totalFailed:  records.filter(r => r.status === "failed").length,
    pendingInv:   invites.filter(i => i.status === "pending").length,
    expiredInv:   invites.filter(i => i.status === "expired").length,
    authFailed:   AUTH_LOG_MOCK.filter(a => a.status === "failed").length,
  }), [records, invites]);

  const failedRecords = useMemo(() => records.filter(r => r.status === "failed"), [records]);
  const authRecords   = AUTH_LOG_MOCK;

  function doResend(inv: InviteRecord) {
    resendInvite(inv.id, actorName);
    createLog({ category: "SMS", title: `초대 재발송: ${inv.recipientName}`, detail: `역할: ${INVITE_ROLE_CFG[inv.role].label}`, actorName, impact: "low" });
  }

  function doCancel(inv: InviteRecord) {
    cancelInvite(inv.id, actorName);
    createLog({ category: "SMS", title: `초대 취소: ${inv.recipientName}`, detail: `역할: ${INVITE_ROLE_CFG[inv.role].label}`, actorName, impact: "low" });
  }

  function doSaveTpl() {
    if (!editTplModal || !tplBody.trim()) return;
    updateTemplate(editTplModal.id, { body: tplBody }, actorName);
    createLog({ category: "SMS", title: `SMS 템플릿 수정: ${editTplModal.name}`, detail: "템플릿 본문 변경", actorName, impact: "low" });
    setEditTplModal(null);
  }

  function SmsLogItem({ r }: { r: SmsRecord }) {
    const tc = SMS_TYPE_CFG[r.type];
    const statusColor = r.status === "sent" ? GREEN : r.status === "failed" ? DANGER : WARN;
    return (
      <View style={s.card}>
        <View style={[s.cardIcon, { backgroundColor: statusColor + "20" }]}>
          <Feather name="message-square" size={15} color={statusColor} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={s.nameRow}>
            <Text style={s.cardName}>{r.recipientName}</Text>
            <View style={[s.badge, { backgroundColor: tc.color + "20" }]}>
              <Text style={[s.badgeTxt, { color: tc.color }]}>{tc.label}</Text>
            </View>
            <View style={[s.badge, { backgroundColor: statusColor + "20" }]}>
              <Text style={[s.badgeTxt, { color: statusColor }]}>
                {r.status === "sent" ? "발송 성공" : r.status === "failed" ? "실패" : "대기"}
              </Text>
            </View>
          </View>
          <Text style={s.cardMeta}>{r.recipientPhone} · {r.operatorName}</Text>
          <Text style={s.cardMeta}>{fmtDate(r.sentAt)} · by {r.sentBy}</Text>
          {r.failReason && <Text style={[s.cardMeta, { color: DANGER }]}>사유: {r.failReason}</Text>}
          <Text style={s.msgBody} numberOfLines={2}>{r.message}</Text>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="SMS 로그·템플릿 관리" homePath="/(super)/dashboard" />

      {/* 탭 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.tabBar} contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 6, gap: 4 }}>
        {TABS.map(t => (
          <Pressable key={t.key} style={[s.tab, tab === t.key && s.tabActive]} onPress={() => setTab(t.key)}>
            <Text style={[s.tabTxt, tab === t.key && s.tabTxtActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* KPI 요약 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.kpiBar} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8 }}>
        {[
          { label: "발송 성공",   val: stats.totalSent,   color: GREEN },
          { label: "발송 실패",   val: stats.totalFailed, color: DANGER },
          { label: "대기 초대",   val: stats.pendingInv,  color: WARN },
          { label: "만료 초대",   val: stats.expiredInv,  color: "#9A948F" },
          { label: "인증 실패",   val: stats.authFailed,  color: DANGER },
        ].map(k => (
          <View key={k.label} style={[s.kpiCard, { borderTopColor: k.color }]}>
            <Text style={[s.kpiVal, { color: k.color }]}>{k.val}</Text>
            <Text style={s.kpiLabel}>{k.label}</Text>
          </View>
        ))}
      </ScrollView>

      {/* ── 발송 로그 탭 ── */}
      {tab === "log" && (
        <FlatList
          data={records}
          keyExtractor={r => r.id}
          contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 80 }}
          ListEmptyComponent={<View style={s.empty}><Text style={s.emptyTxt}>발송 기록 없음</Text></View>}
          renderItem={({ item }) => <SmsLogItem r={item} />}
        />
      )}

      {/* ── 실패 로그 탭 ── */}
      {tab === "failed" && (
        <FlatList
          data={failedRecords}
          keyExtractor={r => r.id}
          contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 80 }}
          ListEmptyComponent={
            <View style={s.empty}>
              <Feather name="check-circle" size={36} color={GREEN} />
              <Text style={s.emptyTxt}>발송 실패 없음</Text>
            </View>
          }
          renderItem={({ item }) => <SmsLogItem r={item} />}
        />
      )}

      {/* ── 초대 현황 탭 ── */}
      {tab === "invites" && (
        <FlatList
          data={invites}
          keyExtractor={i => i.id}
          contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 80 }}
          ListEmptyComponent={<View style={s.empty}><Text style={s.emptyTxt}>초대 기록 없음</Text></View>}
          renderItem={({ item: inv }) => {
            const rc = INVITE_ROLE_CFG[inv.role];
            const sc = INVITE_STATUS_CFG[inv.status];
            return (
              <View style={s.card}>
                <View style={[s.cardIcon, { backgroundColor: rc.bg }]}>
                  <Feather name={rc.icon as any} size={15} color={rc.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={s.nameRow}>
                    <Text style={s.cardName}>{inv.recipientName}</Text>
                    <View style={[s.badge, { backgroundColor: rc.bg }]}>
                      <Text style={[s.badgeTxt, { color: rc.color }]}>{rc.label}</Text>
                    </View>
                    <View style={[s.badge, { backgroundColor: sc.bg }]}>
                      <Text style={[s.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
                    </View>
                  </View>
                  <Text style={s.cardMeta}>{inv.recipientPhone} · {inv.operatorName !== "—" ? inv.operatorName : "운영자 없음"}</Text>
                  <Text style={s.cardMeta}>발송: {fmtDate(inv.createdAt)} · 만료: {fmtDate(inv.expiresAt)}</Text>
                  {inv.note && <Text style={[s.cardMeta, { fontStyle: "italic" }]}>{inv.note}</Text>}
                  {(inv.status === "pending" || inv.status === "expired") && (
                    <View style={s.invActions}>
                      <Pressable style={s.reBtn} onPress={() => doResend(inv)}>
                        <Feather name="refresh-cw" size={11} color={P} />
                        <Text style={s.reTxt}>재발송</Text>
                      </Pressable>
                      {inv.status === "pending" && (
                        <Pressable style={s.cancelBtnSm} onPress={() => doCancel(inv)}>
                          <Text style={s.cancelSmTxt}>취소</Text>
                        </Pressable>
                      )}
                    </View>
                  )}
                </View>
              </View>
            );
          }}
        />
      )}

      {/* ── 인증 기록 탭 ── */}
      {tab === "auth" && (
        <FlatList
          data={authRecords}
          keyExtractor={a => a.id}
          contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 80 }}
          renderItem={({ item: a }) => {
            const statusColor = a.status === "success" ? GREEN : a.status === "failed" ? DANGER : WARN;
            const statusLabel = a.status === "success" ? "성공" : a.status === "failed" ? "실패" : "만료";
            return (
              <View style={s.card}>
                <View style={[s.cardIcon, { backgroundColor: statusColor + "20" }]}>
                  <Feather name={a.status === "success" ? "check-circle" : "x-circle"} size={15} color={statusColor} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={s.nameRow}>
                    <Text style={s.cardName}>{a.phone}</Text>
                    <View style={[s.badge, { backgroundColor: statusColor + "20" }]}>
                      <Text style={[s.badgeTxt, { color: statusColor }]}>{statusLabel}</Text>
                    </View>
                  </View>
                  <Text style={s.cardMeta}>{a.type} · 운영자: {a.operator}</Text>
                  <Text style={s.cardMeta}>{fmtDate(a.time)}</Text>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* ── 템플릿 탭 ── */}
      {tab === "templates" && (
        <FlatList
          data={templates}
          keyExtractor={t => t.id}
          contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 80 }}
          renderItem={({ item: tpl }) => {
            const tc = SMS_TYPE_CFG[tpl.type];
            return (
              <View style={s.card}>
                <View style={{ flex: 1 }}>
                  <View style={s.nameRow}>
                    <Text style={s.cardName}>{tpl.name}</Text>
                    <View style={[s.badge, { backgroundColor: tc.color + "20" }]}>
                      <Text style={[s.badgeTxt, { color: tc.color }]}>{tc.label}</Text>
                    </View>
                    {!tpl.isActive && (
                      <View style={[s.badge, { backgroundColor: "#F6F3F1" }]}>
                        <Text style={[s.badgeTxt, { color: "#9A948F" }]}>비활성</Text>
                      </View>
                    )}
                  </View>
                  <Text style={s.msgBody}>{tpl.body}</Text>
                  <Text style={s.cardMeta}>최종 수정: {fmtDate(tpl.updatedAt)} · {tpl.updatedBy}</Text>
                </View>
                <Pressable style={s.editBtn} onPress={() => { setEditTplModal(tpl); setTplBody(tpl.body); }}>
                  <Feather name="edit-2" size={14} color={P} />
                </Pressable>
              </View>
            );
          }}
          ListEmptyComponent={<View style={s.empty}><Text style={s.emptyTxt}>템플릿 없음</Text></View>}
        />
      )}

      {/* 템플릿 편집 모달 */}
      {editTplModal && (
        <Modal visible animationType="fade" transparent statusBarTranslucent onRequestClose={() => setEditTplModal(null)}>
          <Pressable style={m.backdrop} onPress={() => setEditTplModal(null)}>
            <Pressable style={m.sheet} onPress={() => {}}>
              <View style={m.handle} />
              <Text style={m.title}>{editTplModal.name}</Text>
              <Text style={m.label}>본문</Text>
              <TextInput style={[m.input, { minHeight: 100, textAlignVertical: "top" }]}
                value={tplBody} onChangeText={setTplBody}
                multiline placeholder="템플릿 본문" placeholderTextColor="#9A948F" />
              <Text style={[m.label, { color: "#9A948F" }]}>사용 가능 변수: {"{name}"} {"{pool}"} {"{link}"} {"{code}"} {"{pct}"} {"{date}"}</Text>
              <View style={m.btnRow}>
                <Pressable style={m.cancelBtn} onPress={() => setEditTplModal(null)}>
                  <Text style={m.cancelTxt}>취소</Text>
                </Pressable>
                <Pressable style={m.saveBtn} onPress={doSaveTpl}>
                  <Text style={m.saveTxt}>저장</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: "#EEDDF5" },
  tabBar:      { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E9E2DD", flexGrow: 0 },
  tab:         { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20 },
  tabActive:   { backgroundColor: "#EEDDF5" },
  tabTxt:      { fontSize: 13, fontFamily: "Inter_500Medium", color: "#6F6B68" },
  tabTxtActive:{ color: P, fontFamily: "Inter_700Bold" },
  kpiBar:      { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E9E2DD", flexGrow: 0 },
  kpiCard:     { width: 80, paddingVertical: 8, paddingHorizontal: 8, backgroundColor: "#FBF8F6",
                 borderRadius: 10, borderTopWidth: 2, alignItems: "center", gap: 2 },
  kpiVal:      { fontSize: 17, fontFamily: "Inter_700Bold" },
  kpiLabel:    { fontSize: 9, fontFamily: "Inter_400Regular", color: "#6F6B68", textAlign: "center" },
  card:        { backgroundColor: "#fff", borderRadius: 14, padding: 14, gap: 8, flexDirection: "row",
                 shadowColor: "#0000001A", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 3, elevation: 1 },
  cardIcon:    { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  nameRow:     { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  cardName:    { fontSize: 14, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  badge:       { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  badgeTxt:    { fontSize: 10, fontFamily: "Inter_700Bold" },
  cardMeta:    { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9A948F", marginTop: 2 },
  msgBody:     { fontSize: 12, fontFamily: "Inter_400Regular", color: "#1F1F1F", marginTop: 4,
                 backgroundColor: "#FBF8F6", padding: 8, borderRadius: 8, lineHeight: 18 },
  invActions:  { flexDirection: "row", gap: 8, marginTop: 6 },
  reBtn:       { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6,
                 borderRadius: 8, backgroundColor: "#EEDDF5" },
  reTxt:       { fontSize: 11, fontFamily: "Inter_600SemiBold", color: P },
  cancelBtnSm: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: "#F9DEDA" },
  cancelSmTxt: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: DANGER },
  editBtn:     { padding: 8 },
  empty:       { alignItems: "center", paddingVertical: 60, gap: 12 },
  emptyTxt:    { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9A948F" },
});

const m = StyleSheet.create({
  backdrop:  { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:     { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
               borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, gap: 12 },
  handle:    { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  title:     { fontSize: 17, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  label:     { fontSize: 12, fontFamily: "Inter_500Medium", color: "#6F6B68" },
  input:     { borderWidth: 1.5, borderColor: "#E9E2DD", borderRadius: 10, paddingHorizontal: 12,
               paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular", color: "#1F1F1F" },
  btnRow:    { flexDirection: "row", gap: 10, marginTop: 4 },
  cancelBtn: { flex: 1, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#F6F3F1" },
  cancelTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#6F6B68" },
  saveBtn:   { flex: 1, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: P },
  saveTxt:   { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
