/**
 * (super)/invite-sms.tsx — 초대/SMS 관리
 * adapter 패턴 mock provider — 실제 SMS 업체 연동 준비
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
import { useOperatorsStore } from "@/store/operatorsStore";
import type { SmsType, InviteRole, InviteRecord, SmsRecord } from "@/domain/types";

const P = "#7C3AED";

const TABS = [
  { key: "invites", label: "초대 관리" },
  { key: "sms",     label: "SMS 발송" },
  { key: "templates",label: "템플릿" },
];

const INVITE_ROLE_CFG: Record<InviteRole, { label: string; color: string; bg: string; icon: string }> = {
  operator: { label: '운영자', color: '#7C3AED', bg: '#EDE9FE', icon: 'briefcase' },
  teacher:  { label: '선생님', color: '#0891B2', bg: '#ECFEFF', icon: 'user' },
  parent:   { label: '학부모', color: '#059669', bg: '#D1FAE5', icon: 'users' },
};

const INVITE_STATUS_CFG = {
  pending:   { label: '대기', color: '#D97706', bg: '#FEF3C7' },
  accepted:  { label: '수락', color: '#059669', bg: '#D1FAE5' },
  expired:   { label: '만료', color: '#9CA3AF', bg: '#F3F4F6' },
  cancelled: { label: '취소', color: '#DC2626', bg: '#FEE2E2' },
};

const SMS_TYPE_CFG: Record<SmsType, { label: string; color: string }> = {
  teacher_invite: { label: '선생님 초대', color: '#0891B2' },
  parent_connect: { label: '학부모 연결', color: '#059669' },
  phone_verify:   { label: '휴대폰 인증', color: '#7C3AED' },
  policy_reconfirm:{ label: '정책 재확인', color: '#D97706' },
  payment_fail:   { label: '결제 실패', color: '#DC2626' },
  storage_warn:   { label: '저장공간 경고', color: '#EA580C' },
  deletion_notice:{ label: '삭제 예정 고지', color: '#991B1B' },
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function InviteSmsScreen() {
  const { adminUser } = useAuth();
  const actorName = adminUser?.name ?? '슈퍼관리자';

  const records      = useSmsStore(s => s.records);
  const templates    = useSmsStore(s => s.templates);
  const invites      = useSmsStore(s => s.invites);
  const sendSms      = useSmsStore(s => s.sendSms);
  const resendInvite = useSmsStore(s => s.resendInvite);
  const cancelInvite = useSmsStore(s => s.cancelInvite);
  const createInvite = useSmsStore(s => s.createInvite);
  const updateTemplate = useSmsStore(s => s.updateTemplate);
  const createLog    = useAuditLogStore(s => s.createLog);
  const operators    = useOperatorsStore(s => s.operators);

  const [tab, setTab] = useState("invites");
  const [newInviteModal, setNewInviteModal] = useState(false);
  const [newSmsModal, setNewSmsModal] = useState(false);
  const [editTplModal, setEditTplModal] = useState<null | typeof templates[0]>(null);
  const [tplBody, setTplBody] = useState("");

  // 초대 생성 폼
  const [invRole, setInvRole] = useState<InviteRole>("teacher");
  const [invName, setInvName] = useState("");
  const [invPhone, setInvPhone] = useState("");
  const [invOpId, setInvOpId] = useState("");
  const [invNote, setInvNote] = useState("");

  // SMS 발송 폼
  const [smsType, setSmsType] = useState<SmsType>("payment_fail");
  const [smsName, setSmsName] = useState("");
  const [smsPhone, setSmsPhone] = useState("");
  const [smsOpId, setSmsOpId] = useState("");

  const stats = useMemo(() => ({
    pendingInvites: invites.filter(i => i.status === 'pending').length,
    expiredInvites: invites.filter(i => i.status === 'expired').length,
    smsSent: records.filter(r => r.status === 'sent').length,
    smsFailed: records.filter(r => r.status === 'failed').length,
  }), [invites, records]);

  function doCreateInvite() {
    if (!invName.trim() || !invPhone.trim()) return;
    const op = operators.find(o => o.id === invOpId);
    const inv = createInvite({ role: invRole, recipientName: invName, recipientPhone: invPhone, operatorId: invOpId, operatorName: op?.name ?? '—', actorName, note: invNote });
    createLog({ category: 'SMS', title: `초대 발송: ${invName} (${INVITE_ROLE_CFG[invRole].label})`, detail: `전화: ${invPhone} / 운영자: ${op?.name ?? '—'}`, actorName, impact: 'low' });
    setNewInviteModal(false); setInvName(""); setInvPhone(""); setInvNote(""); setInvOpId("");
  }

  function doSendSms() {
    if (!smsName.trim() || !smsPhone.trim()) return;
    const op = operators.find(o => o.id === smsOpId);
    sendSms({ type: smsType, recipientName: smsName, recipientPhone: smsPhone, operatorId: smsOpId, operatorName: op?.name ?? '—', actorName });
    createLog({ category: 'SMS', title: `SMS 발송: ${SMS_TYPE_CFG[smsType].label} → ${smsName}`, detail: `${smsPhone} / ${op?.name ?? '—'}`, actorName, impact: 'low' });
    setNewSmsModal(false); setSmsName(""); setSmsPhone(""); setSmsOpId("");
  }

  function doResend(inv: InviteRecord) {
    resendInvite(inv.id, actorName);
    createLog({ category: 'SMS', title: `초대 재발송: ${inv.recipientName}`, detail: `역할: ${INVITE_ROLE_CFG[inv.role].label}`, actorName, impact: 'low' });
  }

  function doCancel(inv: InviteRecord) {
    cancelInvite(inv.id, actorName);
    createLog({ category: 'SMS', title: `초대 취소: ${inv.recipientName}`, detail: `역할: ${INVITE_ROLE_CFG[inv.role].label}`, actorName, impact: 'low' });
  }

  function doSaveTpl() {
    if (!editTplModal || !tplBody.trim()) return;
    updateTemplate(editTplModal.id, { body: tplBody }, actorName);
    createLog({ category: 'SMS', title: `SMS 템플릿 수정: ${editTplModal.name}`, detail: '템플릿 본문 변경', actorName, impact: 'low' });
    setEditTplModal(null);
  }

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="초대/SMS 관리" homePath="/(super)/dashboard"
        rightSlot={
          <View style={{ flexDirection: "row", gap: 6 }}>
            {tab === "invites" && (
              <Pressable style={s.addBtn} onPress={() => setNewInviteModal(true)}>
                <Feather name="user-plus" size={16} color={P} />
              </Pressable>
            )}
            {tab === "sms" && (
              <Pressable style={s.addBtn} onPress={() => setNewSmsModal(true)}>
                <Feather name="send" size={16} color={P} />
              </Pressable>
            )}
          </View>
        }
      />

      {/* 탭 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.tabBar} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 6, gap: 4 }}>
        {TABS.map(t => (
          <Pressable key={t.key} style={[s.tab, tab === t.key && s.tabActive]} onPress={() => setTab(t.key)}>
            <Text style={[s.tabTxt, tab === t.key && s.tabTxtActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* KPI */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.kpiBar} contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 8, gap: 8 }}>
        {[
          { label: '대기 중 초대', val: stats.pendingInvites, color: '#D97706' },
          { label: '만료 초대', val: stats.expiredInvites, color: '#9CA3AF' },
          { label: 'SMS 발송', val: stats.smsSent, color: '#059669' },
          { label: 'SMS 실패', val: stats.smsFailed, color: '#DC2626' },
        ].map(k => (
          <View key={k.label} style={[s.kpiCard, { borderTopColor: k.color }]}>
            <Text style={[s.kpiVal, { color: k.color }]}>{k.val}</Text>
            <Text style={s.kpiLabel}>{k.label}</Text>
          </View>
        ))}
      </ScrollView>

      {/* 초대 탭 */}
      {tab === "invites" && (
        <FlatList
          data={invites}
          keyExtractor={i => i.id}
          contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 80 }}
          renderItem={({ item: inv }) => {
            const rc = INVITE_ROLE_CFG[inv.role];
            const sc = INVITE_STATUS_CFG[inv.status];
            return (
              <View style={s.card}>
                <View style={s.cardTop}>
                  <View style={[s.roleIcon, { backgroundColor: rc.bg }]}>
                    <Feather name={rc.icon as any} size={16} color={rc.color} />
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
                    <Text style={s.cardMeta}>{inv.recipientPhone} · {inv.operatorName !== '—' ? inv.operatorName : '운영자 없음'}</Text>
                    <Text style={s.cardMeta}>발송: {fmtDate(inv.createdAt)} · 만료: {fmtDate(inv.expiresAt)}</Text>
                    {inv.note ? <Text style={s.cardNote}>{inv.note}</Text> : null}
                  </View>
                </View>
                {(inv.status === 'pending' || inv.status === 'expired') && (
                  <View style={s.cardActions}>
                    <Pressable style={s.reBtn} onPress={() => doResend(inv)}>
                      <Feather name="refresh-cw" size={12} color={P} />
                      <Text style={s.reTxt}>재발송</Text>
                    </Pressable>
                    {inv.status === 'pending' && (
                      <Pressable style={s.cancelBtnSm} onPress={() => doCancel(inv)}>
                        <Text style={s.cancelSmTxt}>취소</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            );
          }}
          ListEmptyComponent={<View style={s.empty}><Text style={s.emptyTxt}>초대 기록 없음</Text></View>}
        />
      )}

      {/* SMS 탭 */}
      {tab === "sms" && (
        <FlatList
          data={records}
          keyExtractor={r => r.id}
          contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 80 }}
          renderItem={({ item: r }) => {
            const tc = SMS_TYPE_CFG[r.type];
            const statusColor = r.status === 'sent' ? '#059669' : r.status === 'failed' ? '#DC2626' : '#D97706';
            return (
              <View style={s.card}>
                <View style={s.cardTop}>
                  <View style={[s.roleIcon, { backgroundColor: statusColor + "20" }]}>
                    <Feather name="message-square" size={16} color={statusColor} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={s.nameRow}>
                      <Text style={s.cardName}>{r.recipientName}</Text>
                      <View style={[s.badge, { backgroundColor: tc.color + "20" }]}>
                        <Text style={[s.badgeTxt, { color: tc.color }]}>{tc.label}</Text>
                      </View>
                      <View style={[s.badge, { backgroundColor: statusColor + "20" }]}>
                        <Text style={[s.badgeTxt, { color: statusColor }]}>{r.status === 'sent' ? '발송 성공' : r.status === 'failed' ? '실패' : '대기'}</Text>
                      </View>
                    </View>
                    <Text style={s.cardMeta}>{r.recipientPhone} · {r.operatorName}</Text>
                    <Text style={s.cardMeta}>{fmtDate(r.sentAt)} · by {r.sentBy}</Text>
                    {r.failReason && <Text style={[s.cardNote, { color: '#DC2626' }]}>실패 사유: {r.failReason}</Text>}
                    <Text style={[s.msgBody]} numberOfLines={2}>{r.message}</Text>
                  </View>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={<View style={s.empty}><Text style={s.emptyTxt}>발송 기록 없음</Text></View>}
        />
      )}

      {/* 템플릿 탭 */}
      {tab === "templates" && (
        <FlatList
          data={templates}
          keyExtractor={t => t.id}
          contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 80 }}
          renderItem={({ item: tpl }) => {
            const tc = SMS_TYPE_CFG[tpl.type];
            return (
              <View style={s.card}>
                <View style={s.cardTop}>
                  <View style={{ flex: 1 }}>
                    <View style={s.nameRow}>
                      <Text style={s.cardName}>{tpl.name}</Text>
                      <View style={[s.badge, { backgroundColor: tc.color + "20" }]}>
                        <Text style={[s.badgeTxt, { color: tc.color }]}>{tc.label}</Text>
                      </View>
                      {!tpl.isActive && <View style={[s.badge, { backgroundColor: "#F3F4F6" }]}>
                        <Text style={[s.badgeTxt, { color: "#9CA3AF" }]}>비활성</Text>
                      </View>}
                    </View>
                    <Text style={s.msgBody}>{tpl.body}</Text>
                    <Text style={s.cardMeta}>최종 수정: {fmtDate(tpl.updatedAt)} · {tpl.updatedBy}</Text>
                  </View>
                  <Pressable style={s.editBtn} onPress={() => { setEditTplModal(tpl); setTplBody(tpl.body); }}>
                    <Feather name="edit-2" size={14} color={P} />
                  </Pressable>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={<View style={s.empty}><Text style={s.emptyTxt}>템플릿 없음</Text></View>}
        />
      )}

      {/* 초대 생성 모달 */}
      {newInviteModal && (
        <Modal visible animationType="slide" transparent statusBarTranslucent onRequestClose={() => setNewInviteModal(false)}>
          <Pressable style={m.backdrop} onPress={() => setNewInviteModal(false)}>
            <Pressable style={m.sheet} onPress={() => {}}>
              <View style={m.handle} />
              <Text style={m.title}>새 초대 발송</Text>

              <Text style={m.label}>역할</Text>
              <View style={m.roleRow}>
                {(Object.keys(INVITE_ROLE_CFG) as InviteRole[]).map(r => {
                  const rc = INVITE_ROLE_CFG[r];
                  return (
                    <Pressable key={r} style={[m.roleBtn, invRole === r && { backgroundColor: rc.bg, borderColor: rc.color }]}
                      onPress={() => setInvRole(r)}>
                      <Text style={[m.roleBtnTxt, invRole === r && { color: rc.color }]}>{rc.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={m.label}>이름</Text>
              <TextInput style={m.input} value={invName} onChangeText={setInvName} placeholder="받는 사람 이름" placeholderTextColor="#9CA3AF" />

              <Text style={m.label}>휴대폰 번호</Text>
              <TextInput style={m.input} value={invPhone} onChangeText={setInvPhone} placeholder="010-0000-0000" keyboardType="phone-pad" placeholderTextColor="#9CA3AF" />

              <Text style={m.label}>운영자 (선택)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 44, marginBottom: 8 }}
                contentContainerStyle={{ gap: 6, paddingBottom: 4 }}>
                <Pressable style={[m.opChip, invOpId === '' && m.opChipActive]} onPress={() => setInvOpId("")}>
                  <Text style={[m.opChipTxt, invOpId === '' && { color: P }]}>없음</Text>
                </Pressable>
                {operators.slice(0, 8).map(op => (
                  <Pressable key={op.id} style={[m.opChip, invOpId === op.id && m.opChipActive]} onPress={() => setInvOpId(op.id)}>
                    <Text style={[m.opChipTxt, invOpId === op.id && { color: P }]}>{op.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              <Text style={m.label}>메모 (선택)</Text>
              <TextInput style={m.input} value={invNote} onChangeText={setInvNote} placeholder="메모" placeholderTextColor="#9CA3AF" />

              <View style={m.btnRow}>
                <Pressable style={m.cancelBtn} onPress={() => setNewInviteModal(false)}>
                  <Text style={m.cancelTxt}>취소</Text>
                </Pressable>
                <Pressable style={[m.saveBtn, { opacity: (invName && invPhone) ? 1 : 0.4 }]}
                  onPress={doCreateInvite} disabled={!invName.trim() || !invPhone.trim()}>
                  <Text style={m.saveTxt}>초대 발송</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* SMS 발송 모달 */}
      {newSmsModal && (
        <Modal visible animationType="slide" transparent statusBarTranslucent onRequestClose={() => setNewSmsModal(false)}>
          <Pressable style={m.backdrop} onPress={() => setNewSmsModal(false)}>
            <Pressable style={m.sheet} onPress={() => {}}>
              <View style={m.handle} />
              <Text style={m.title}>SMS 직접 발송</Text>

              <Text style={m.label}>SMS 유형</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 44 }}
                contentContainerStyle={{ gap: 6, paddingBottom: 4 }}>
                {(Object.keys(SMS_TYPE_CFG) as SmsType[]).map(t => {
                  const tc = SMS_TYPE_CFG[t];
                  return (
                    <Pressable key={t} style={[m.opChip, smsType === t && { backgroundColor: tc.color + "20", borderColor: tc.color }]}
                      onPress={() => setSmsType(t)}>
                      <Text style={[m.opChipTxt, smsType === t && { color: tc.color }]}>{tc.label}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <Text style={m.label}>이름</Text>
              <TextInput style={m.input} value={smsName} onChangeText={setSmsName} placeholder="받는 사람 이름" placeholderTextColor="#9CA3AF" />

              <Text style={m.label}>휴대폰 번호</Text>
              <TextInput style={m.input} value={smsPhone} onChangeText={setSmsPhone} placeholder="010-0000-0000" keyboardType="phone-pad" placeholderTextColor="#9CA3AF" />

              <Text style={m.label}>운영자 (선택)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 44 }}
                contentContainerStyle={{ gap: 6, paddingBottom: 4 }}>
                <Pressable style={[m.opChip, smsOpId === '' && m.opChipActive]} onPress={() => setSmsOpId("")}>
                  <Text style={[m.opChipTxt, smsOpId === '' && { color: P }]}>없음</Text>
                </Pressable>
                {operators.slice(0, 8).map(op => (
                  <Pressable key={op.id} style={[m.opChip, smsOpId === op.id && m.opChipActive]} onPress={() => setSmsOpId(op.id)}>
                    <Text style={[m.opChipTxt, smsOpId === op.id && { color: P }]}>{op.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              <View style={m.btnRow}>
                <Pressable style={m.cancelBtn} onPress={() => setNewSmsModal(false)}>
                  <Text style={m.cancelTxt}>취소</Text>
                </Pressable>
                <Pressable style={[m.saveBtn, { opacity: (smsName && smsPhone) ? 1 : 0.4 }]}
                  onPress={doSendSms} disabled={!smsName.trim() || !smsPhone.trim()}>
                  <Text style={m.saveTxt}>발송</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
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
                multiline placeholder="템플릿 본문" placeholderTextColor="#9CA3AF" />
              <Text style={[m.label, { color: "#9CA3AF", marginTop: -4 }]}>사용 가능 변수: {"{name}"} {"{pool}"} {"{link}"} {"{code}"} {"{pct}"} {"{date}"}</Text>
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
  safe:        { flex: 1, backgroundColor: "#F5F3FF" },
  addBtn:      { width: 36, height: 36, borderRadius: 10, backgroundColor: "#EDE9FE", alignItems: "center", justifyContent: "center" },
  tabBar:      { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", flexGrow: 0 },
  tab:         { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20 },
  tabActive:   { backgroundColor: "#EDE9FE" },
  tabTxt:      { fontSize: 13, fontFamily: "Inter_500Medium", color: "#6B7280" },
  tabTxtActive:{ color: P, fontFamily: "Inter_700Bold" },
  kpiBar:      { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", flexGrow: 0 },
  kpiCard:     { width: 90, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: "#F9FAFB",
                 borderRadius: 10, borderTopWidth: 2, alignItems: "center", gap: 2 },
  kpiVal:      { fontSize: 18, fontFamily: "Inter_700Bold" },
  kpiLabel:    { fontSize: 10, fontFamily: "Inter_400Regular", color: "#6B7280", textAlign: "center" },
  card:        { backgroundColor: "#fff", borderRadius: 14, padding: 14, gap: 8,
                 shadowColor: "#0000001A", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 3, elevation: 1 },
  cardTop:     { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  roleIcon:    { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  nameRow:     { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  cardName:    { fontSize: 14, fontFamily: "Inter_700Bold", color: "#111827" },
  badge:       { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  badgeTxt:    { fontSize: 10, fontFamily: "Inter_700Bold" },
  cardMeta:    { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2 },
  cardNote:    { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280", fontStyle: "italic" },
  msgBody:     { fontSize: 12, fontFamily: "Inter_400Regular", color: "#374151", marginTop: 4,
                 backgroundColor: "#F9FAFB", padding: 8, borderRadius: 8, lineHeight: 18 },
  cardActions: { flexDirection: "row", gap: 8 },
  reBtn:       { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6,
                 borderRadius: 8, backgroundColor: "#EDE9FE" },
  reTxt:       { fontSize: 12, fontFamily: "Inter_600SemiBold", color: P },
  cancelBtnSm: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: "#FEE2E2" },
  cancelSmTxt: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#DC2626" },
  editBtn:     { width: 34, height: 34, borderRadius: 8, backgroundColor: "#EDE9FE", alignItems: "center", justifyContent: "center" },
  empty:       { alignItems: "center", paddingTop: 60 },
  emptyTxt:    { fontSize: 14, color: "#9CA3AF", fontFamily: "Inter_400Regular" },
});

const m = StyleSheet.create({
  backdrop:   { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:      { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
                borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: "85%", gap: 12 },
  handle:     { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  title:      { fontSize: 17, fontFamily: "Inter_700Bold", color: "#111827" },
  label:      { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#374151" },
  roleRow:    { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  roleBtn:    { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
                borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#F9FAFB" },
  roleBtnTxt: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#374151" },
  input:      { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, padding: 12,
                fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827" },
  opChip:     { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
                borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#F9FAFB" },
  opChipActive:{ borderColor: P, backgroundColor: "#EDE9FE" },
  opChipTxt:  { fontSize: 12, fontFamily: "Inter_500Medium", color: "#374151" },
  btnRow:     { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  cancelBtn:  { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: "#F3F4F6" },
  cancelTxt:  { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#374151" },
  saveBtn:    { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: P },
  saveTxt:    { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
