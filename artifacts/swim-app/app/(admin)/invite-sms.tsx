/**
 * (admin)/invite-sms.tsx — 초대·문자 관리 (운영자 모드)
 * 운영자가 선생님·학부모를 초대하고 SMS 발송 현황을 조회하는 화면.
 * 발송 주체: 운영자 / 과금 대상: 운영자
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Alert, FlatList, Linking, Modal, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useBrand } from "@/context/BrandContext";
import { useSmsStore } from "@/store/smsStore";
import { useAuditLogStore } from "@/store/auditLogStore";
import type { InviteRole, InviteRecord, SmsType } from "@/domain/types";

const FREE_QUOTA = 500;
const SMS_UNIT_PRICE = 9.9;
// 이번 달 이 운영자의 mock 사용량 (op-001 기준)
const MY_USAGE = { sent: 320, failed: 2, blocked: false };

const TABS = [
  { key: "send",    label: "초대 발송" },
  { key: "pending", label: "대기 초대" },
  { key: "failed",  label: "실패 내역" },
] as const;

type Tab = typeof TABS[number]["key"];

const ROLE_CFG: Record<InviteRole, { label: string; color: string; bg: string; icon: string }> = {
  operator: { label: "운영자", color: "#7C3AED", bg: "#EDE9FE", icon: "briefcase" },
  teacher:  { label: "선생님", color: "#0891B2", bg: "#ECFEFF", icon: "user" },
  parent:   { label: "학부모", color: "#059669", bg: "#D1FAE5", icon: "users" },
};
const STATUS_CFG = {
  pending:   { label: "대기", color: "#D97706", bg: "#FEF3C7" },
  accepted:  { label: "수락", color: "#059669", bg: "#D1FAE5" },
  expired:   { label: "만료", color: "#9CA3AF", bg: "#F3F4F6" },
  cancelled: { label: "취소", color: "#DC2626", bg: "#FEE2E2" },
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function OperatorInviteSmsScreen() {
  const { adminUser } = useAuth();
  const { themeColor } = useBrand();
  const actorName = adminUser?.name ?? "운영자";

  const invites      = useSmsStore(s => s.invites);
  const records      = useSmsStore(s => s.records);
  const createInvite = useSmsStore(s => s.createInvite);
  const resendInvite = useSmsStore(s => s.resendInvite);
  const cancelInvite = useSmsStore(s => s.cancelInvite);
  const createLog    = useAuditLogStore(s => s.createLog);

  const [tab, setTab] = useState<Tab>("send");
  const [modal, setModal] = useState(false);
  const [invRole, setInvRole] = useState<InviteRole>("teacher");
  const [invName, setInvName] = useState("");
  const [invPhone, setInvPhone] = useState("");
  const [invNote, setInvNote] = useState("");

  // 이번 달 통계
  const excess   = Math.max(0, MY_USAGE.sent - FREE_QUOTA);
  const charge   = Math.round(excess * SMS_UNIT_PRICE);
  const freeLeft = Math.max(0, FREE_QUOTA - MY_USAGE.sent);

  // teacher/parent 초대만 표시
  const myInvites  = useMemo(() => invites.filter(i => i.role !== "operator"), [invites]);
  const pending    = useMemo(() => myInvites.filter(i => i.status === "pending" || i.status === "expired"), [myInvites]);
  const failedSms  = useMemo(() => records.filter(r => r.status === "failed"), [records]);

  async function doSend() {
    if (!invName.trim() || !invPhone.trim()) return;
    const poolName = "우리 수영장";
    const inviteMsg = invRole === "teacher"
      ? `[스윔노트] 안녕하세요 ${invName} 선생님, ${poolName} 초대장입니다.\n앱 다운로드 후 선생님 코드로 가입해 주세요.\nhttps://swimnote.kr`
      : `[스윔노트] 안녕하세요 ${invName} 학부모님, ${poolName}에서 초대장을 보냈습니다.\n앱 설치 후 가입해 주세요.\nhttps://swimnote.kr`;
    const rawPhone = invPhone.replace(/\D/g, "");
    const smsUrl = `sms:${rawPhone}?body=${encodeURIComponent(inviteMsg)}`;
    createInvite({
      role: invRole,
      recipientName: invName,
      recipientPhone: invPhone,
      operatorId: "op-001",
      operatorName: actorName,
      actorName,
      note: invNote,
    });
    createLog({
      category: "SMS",
      title: `운영자 초대 발송: ${invName} (${ROLE_CFG[invRole].label})`,
      detail: `전화: ${invPhone} / 역할: ${ROLE_CFG[invRole].label}`,
      actorName,
      impact: "low",
    });
    setModal(false);
    setInvName(""); setInvPhone(""); setInvNote("");
    setTab("pending");
    try {
      const can = await Linking.canOpenURL(smsUrl);
      if (can) await Linking.openURL(smsUrl);
      else Alert.alert("알림", "문자 앱을 열 수 없습니다. 초대 내역에서 메시지를 복사해 직접 발송해 주세요.");
    } catch { /* ignore */ }
  }

  function doResend(inv: InviteRecord) {
    resendInvite(inv.id, actorName);
    createLog({
      category: "SMS",
      title: `초대 재발송: ${inv.recipientName}`,
      detail: `역할: ${ROLE_CFG[inv.role].label}`,
      actorName,
      impact: "low",
    });
  }

  function doCancel(inv: InviteRecord) {
    cancelInvite(inv.id, actorName);
    createLog({
      category: "SMS",
      title: `초대 취소: ${inv.recipientName}`,
      detail: `역할: ${ROLE_CFG[inv.role].label}`,
      actorName,
      impact: "low",
    });
  }

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="초대·문자 관리" />

      {/* 이번 달 사용량 카드 */}
      <View style={s.quotaCard}>
        <View style={s.quotaRow}>
          <View style={s.quotaItem}>
            <Text style={s.quotaNum}>{MY_USAGE.sent.toLocaleString()}</Text>
            <Text style={s.quotaLabel}>이번 달 발송</Text>
          </View>
          <View style={s.quotaItem}>
            <Text style={[s.quotaNum, { color: freeLeft > 0 ? "#059669" : "#D97706" }]}>{freeLeft.toLocaleString()}</Text>
            <Text style={s.quotaLabel}>무료 잔여</Text>
          </View>
          <View style={[s.quotaItem, excess > 0 && { backgroundColor: "#FFF5F5" }]}>
            <Text style={[s.quotaNum, excess > 0 && { color: "#DC2626" }]}>{excess}</Text>
            <Text style={s.quotaLabel}>초과 건수</Text>
          </View>
          <View style={[s.quotaItem, charge > 0 && { backgroundColor: "#FFFBEB" }]}>
            <Text style={[s.quotaNum, charge > 0 && { color: "#D97706" }]}>
              {charge > 0 ? `₩${charge.toLocaleString()}` : "무료"}
            </Text>
            <Text style={s.quotaLabel}>예상 과금</Text>
          </View>
        </View>
        {MY_USAGE.blocked && (
          <View style={s.blockedBanner}>
            <Feather name="alert-circle" size={13} color="#DC2626" />
            <Text style={s.blockedTxt}>현재 SMS 발송이 차단되어 있습니다. 관리자에게 문의하세요.</Text>
          </View>
        )}
      </View>

      {/* 탭 */}
      <View style={s.tabBar}>
        {TABS.map(t => (
          <Pressable key={t.key} style={[s.tabItem, tab === t.key && { borderBottomColor: themeColor, borderBottomWidth: 2 }]}
            onPress={() => setTab(t.key)}>
            <Text style={[s.tabTxt, { color: tab === t.key ? themeColor : "#6B7280" }]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* ── 초대 발송 탭 ── */}
      {tab === "send" && (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 60 }}>
          <Text style={s.sectionLabel}>누구를 초대하시겠어요?</Text>

          <Pressable style={s.sendCard} onPress={() => { setInvRole("teacher"); setModal(true); }}>
            <View style={[s.sendIcon, { backgroundColor: "#ECFEFF" }]}>
              <Feather name="user" size={22} color="#0891B2" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.sendTitle}>선생님 초대 SMS 발송</Text>
              <Text style={s.sendSub}>이름·휴대폰 입력 → 초대 링크 문자 발송</Text>
            </View>
            <Feather name="chevron-right" size={16} color="#D1D5DB" />
          </Pressable>

          <Pressable style={s.sendCard} onPress={() => { setInvRole("parent"); setModal(true); }}>
            <View style={[s.sendIcon, { backgroundColor: "#D1FAE5" }]}>
              <Feather name="users" size={22} color="#059669" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.sendTitle}>학부모 연결 요청 SMS 발송</Text>
              <Text style={s.sendSub}>학부모 연결 초대 링크 문자 발송</Text>
            </View>
            <Feather name="chevron-right" size={16} color="#D1D5DB" />
          </Pressable>

          <View style={s.infoBox}>
            <Feather name="info" size={13} color="#6B7280" />
            <Text style={s.infoTxt}>무료 {FREE_QUOTA}건/월 제공 · 초과 시 ₩{SMS_UNIT_PRICE}/건 과금</Text>
          </View>

          {MY_USAGE.failed > 0 && (
            <Pressable style={s.failWarning} onPress={() => setTab("failed")}>
              <Feather name="alert-triangle" size={13} color="#DC2626" />
              <Text style={s.failWarningTxt}>발송 실패 {MY_USAGE.failed}건 있음 → 실패 내역 보기</Text>
              <Feather name="chevron-right" size={13} color="#DC2626" />
            </Pressable>
          )}
        </ScrollView>
      )}

      {/* ── 대기 초대 탭 ── */}
      {tab === "pending" && (
        <FlatList
          data={pending}
          keyExtractor={i => i.id}
          contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 80 }}
          ListEmptyComponent={
            <View style={s.empty}>
              <Feather name="user-check" size={36} color="#D1D5DB" />
              <Text style={s.emptyTxt}>대기 중인 초대가 없습니다</Text>
            </View>
          }
          renderItem={({ item: inv }) => {
            const rc = ROLE_CFG[inv.role];
            const sc = STATUS_CFG[inv.status];
            return (
              <View style={s.invCard}>
                <View style={[s.invIcon, { backgroundColor: rc.bg }]}>
                  <Feather name={rc.icon as any} size={16} color={rc.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={s.nameRow}>
                    <Text style={s.invName}>{inv.recipientName}</Text>
                    <View style={[s.badge, { backgroundColor: rc.bg }]}>
                      <Text style={[s.badgeTxt, { color: rc.color }]}>{rc.label}</Text>
                    </View>
                    <View style={[s.badge, { backgroundColor: sc.bg }]}>
                      <Text style={[s.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
                    </View>
                  </View>
                  <Text style={s.invMeta}>{inv.recipientPhone}</Text>
                  <Text style={s.invMeta}>발송: {fmtDate(inv.createdAt)} · 만료: {fmtDate(inv.expiresAt)}</Text>
                  <View style={s.invActions}>
                    <Pressable style={[s.actionBtn, { backgroundColor: "#EDE9FE" }]} onPress={() => doResend(inv)}>
                      <Feather name="refresh-cw" size={11} color="#7C3AED" />
                      <Text style={[s.actionTxt, { color: "#7C3AED" }]}>재발송</Text>
                    </Pressable>
                    {inv.status === "pending" && (
                      <Pressable style={[s.actionBtn, { backgroundColor: "#FEE2E2" }]} onPress={() => doCancel(inv)}>
                        <Text style={[s.actionTxt, { color: "#DC2626" }]}>취소</Text>
                      </Pressable>
                    )}
                    <Pressable style={[s.actionBtn, { backgroundColor: "#F3F4F6" }]}
                      onPress={() => {/* mock: 링크 복사 */}}>
                      <Feather name="link" size={11} color="#6B7280" />
                      <Text style={[s.actionTxt, { color: "#6B7280" }]}>링크 복사</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* ── 실패 내역 탭 ── */}
      {tab === "failed" && (
        <FlatList
          data={failedSms}
          keyExtractor={r => r.id}
          contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 80 }}
          ListEmptyComponent={
            <View style={s.empty}>
              <Feather name="check-circle" size={36} color="#D1D5DB" />
              <Text style={s.emptyTxt}>발송 실패 내역 없음</Text>
            </View>
          }
          renderItem={({ item: r }) => (
            <View style={[s.invCard, { borderLeftWidth: 3, borderLeftColor: "#DC2626" }]}>
              <View style={[s.invIcon, { backgroundColor: "#FEE2E2" }]}>
                <Feather name="x-circle" size={16} color="#DC2626" />
              </View>
              <View style={{ flex: 1 }}>
                <View style={s.nameRow}>
                  <Text style={s.invName}>{r.recipientName}</Text>
                  <View style={[s.badge, { backgroundColor: "#FEE2E2" }]}>
                    <Text style={[s.badgeTxt, { color: "#DC2626" }]}>실패</Text>
                  </View>
                </View>
                <Text style={s.invMeta}>{r.recipientPhone} · {fmtDate(r.sentAt)}</Text>
                {r.failReason && <Text style={[s.invMeta, { color: "#DC2626" }]}>사유: {r.failReason}</Text>}
                <Text style={s.invMeta} numberOfLines={1}>{r.message}</Text>
              </View>
            </View>
          )}
        />
      )}

      {/* 초대 발송 모달 */}
      <Modal visible={modal} animationType="slide" transparent statusBarTranslucent onRequestClose={() => setModal(false)}>
        <Pressable style={m.backdrop} onPress={() => setModal(false)}>
          <Pressable style={m.sheet} onPress={() => {}}>
            <View style={m.handle} />
            <Text style={m.title}>{ROLE_CFG[invRole].label} 초대 발송</Text>

            <View style={m.roleRow}>
              {(["teacher", "parent"] as InviteRole[]).map(r => {
                const rc = ROLE_CFG[r];
                return (
                  <Pressable key={r} style={[m.roleBtn, invRole === r && { backgroundColor: rc.bg, borderColor: rc.color }]}
                    onPress={() => setInvRole(r)}>
                    <Feather name={rc.icon as any} size={14} color={invRole === r ? rc.color : "#9CA3AF"} />
                    <Text style={[m.roleTxt, invRole === r && { color: rc.color }]}>{rc.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={m.label}>이름 *</Text>
            <TextInput style={m.input} value={invName} onChangeText={setInvName}
              placeholder="받는 사람 이름" placeholderTextColor="#9CA3AF" />

            <Text style={m.label}>휴대폰 번호 *</Text>
            <TextInput style={m.input} value={invPhone} onChangeText={setInvPhone}
              placeholder="010-0000-0000" keyboardType="phone-pad" placeholderTextColor="#9CA3AF" />

            <Text style={m.label}>메모 (선택)</Text>
            <TextInput style={m.input} value={invNote} onChangeText={setInvNote}
              placeholder="내부 메모" placeholderTextColor="#9CA3AF" />

            <View style={m.infoRow}>
              <Feather name="info" size={12} color="#6B7280" />
              <Text style={m.infoTxt}>무료 잔여 {freeLeft}건 · 초과 시 ₩{SMS_UNIT_PRICE}/건 과금</Text>
            </View>

            <View style={m.btnRow}>
              <Pressable style={m.cancelBtn} onPress={() => setModal(false)}>
                <Text style={m.cancelTxt}>취소</Text>
              </Pressable>
              <Pressable style={[m.sendBtn, { opacity: (invName && invPhone) ? 1 : 0.4, backgroundColor: ROLE_CFG[invRole].color }]}
                onPress={doSend} disabled={!invName.trim() || !invPhone.trim()}>
                <Feather name="send" size={14} color="#fff" />
                <Text style={m.sendTxt}>초대 발송</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#F5F9FF" },
  quotaCard:    { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", padding: 14, gap: 8 },
  quotaRow:     { flexDirection: "row", gap: 6 },
  quotaItem:    { flex: 1, backgroundColor: "#F9FAFB", borderRadius: 10, padding: 10, alignItems: "center",
                  borderWidth: 1, borderColor: "#E5E7EB" },
  quotaNum:     { fontSize: 16, fontFamily: "Inter_700Bold", color: "#111827" },
  quotaLabel:   { fontSize: 9, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2, textAlign: "center" },
  blockedBanner:{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#FEE2E2",
                  borderRadius: 8, padding: 8 },
  blockedTxt:   { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#DC2626" },
  tabBar:       { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  tabItem:      { flex: 1, paddingVertical: 13, alignItems: "center" },
  tabTxt:       { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  sectionLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#374151" },
  sendCard:     { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#fff",
                  borderRadius: 14, padding: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  sendIcon:     { width: 48, height: 48, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  sendTitle:    { fontSize: 15, fontFamily: "Inter_700Bold", color: "#111827" },
  sendSub:      { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 3 },
  infoBox:      { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#F9FAFB",
                  borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#E5E7EB" },
  infoTxt:      { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280" },
  failWarning:  { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#FFF5F5",
                  borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#FCA5A5" },
  failWarningTxt:{ flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#DC2626" },
  invCard:      { flexDirection: "row", gap: 10, backgroundColor: "#fff",
                  borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  invIcon:      { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  nameRow:      { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  invName:      { fontSize: 14, fontFamily: "Inter_700Bold", color: "#111827" },
  badge:        { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  badgeTxt:     { fontSize: 10, fontFamily: "Inter_700Bold" },
  invMeta:      { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2 },
  invActions:   { flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" },
  actionBtn:    { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  actionTxt:    { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  empty:        { alignItems: "center", paddingVertical: 60, gap: 10 },
  emptyTxt:     { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
});

const m = StyleSheet.create({
  backdrop:  { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:     { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
               borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, gap: 12 },
  handle:    { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  title:     { fontSize: 17, fontFamily: "Inter_700Bold", color: "#111827" },
  roleRow:   { flexDirection: "row", gap: 8 },
  roleBtn:   { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
               paddingVertical: 9, borderRadius: 10, borderWidth: 1.5, borderColor: "#E5E7EB" },
  roleTxt:   { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#9CA3AF" },
  label:     { fontSize: 12, fontFamily: "Inter_500Medium", color: "#6B7280" },
  input:     { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, paddingHorizontal: 12,
               paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827" },
  infoRow:   { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#F9FAFB",
               padding: 10, borderRadius: 8 },
  infoTxt:   { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280" },
  btnRow:    { flexDirection: "row", gap: 10, marginTop: 4 },
  cancelBtn: { flex: 1, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#F3F4F6" },
  cancelTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#6B7280" },
  sendBtn:   { flex: 1.5, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
               height: 46, borderRadius: 12 },
  sendTxt:   { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
