/**
 * (super)/security.tsx — 슈퍼관리자 보안관리
 * 계정/역할/2FA/세션/디바이스/잠금
 */
import { Check, Lock, Monitor } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable,
  ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useSecurityStore } from "@/store/securityStore";
import { useAuditLogStore } from "@/store/auditLogStore";
import type { SuperAdminAccount, SuperAdminRole, SuperAdminSession } from "@/domain/types";
import Colors from "@/constants/colors";
const C = Colors.light;

const P = "#7C3AED";
const DANGER = "#D96C6C";

const ROLE_CFG: Record<SuperAdminRole, { label: string; color: string; bg: string }> = {
  super_admin:     { label: '슈퍼관리자', color: '#7C3AED', bg: '#EEDDF5' },
  senior_admin:    { label: '시니어관리자', color: '#2EC4B6', bg: '#ECFEFF' },
  read_only_admin: { label: '읽기전용', color: '#6B7280', bg: '#F8FAFC' },
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  const m = Math.floor(Math.abs(diff) / 60000);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

function isLocked(account: SuperAdminAccount): boolean {
  if (!account.lockedUntil) return false;
  return new Date(account.lockedUntil) > new Date();
}

export default function SecurityScreen() {
  const { adminUser } = useAuth();
  const actorName = adminUser?.name ?? '슈퍼관리자';

  const accounts         = useSecurityStore(s => s.accounts);
  const forceTwoFactor   = useSecurityStore(s => s.forceTwoFactor);
  const terminateSession = useSecurityStore(s => s.terminateSession);
  const lockAccount      = useSecurityStore(s => s.lockAccount);
  const unlockAccount    = useSecurityStore(s => s.unlockAccount);
  const changeRole       = useSecurityStore(s => s.changeRole);
  const toggleActive     = useSecurityStore(s => s.toggleActive);
  const resetFailCount   = useSecurityStore(s => s.resetFailCount);
  const createLog        = useAuditLogStore(s => s.createLog);

  const [selected, setSelected] = useState<SuperAdminAccount | null>(null);
  const [roleModal, setRoleModal] = useState(false);
  const [lockModal, setLockModal] = useState(false);
  const [lockHours, setLockHours] = useState("24");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const stats = useMemo(() => ({
    total: accounts.length,
    active: accounts.filter(a => a.isActive).length,
    twoFA: accounts.filter(a => a.twoFactorEnabled).length,
    locked: accounts.filter(a => isLocked(a)).length,
    highFail: accounts.filter(a => a.loginFailCount >= 3).length,
  }), [accounts]);

  function doForceTwoFactor(acc: SuperAdminAccount) {
    setActionLoading(`2fa-${acc.id}`);
    forceTwoFactor(acc.id, actorName);
    createLog({ category: '보안', title: `2차 인증 강제 활성화: ${acc.name}`, detail: `${acc.email}에 2FA 강제 적용`, actorName, impact: 'high' });
    if (selected?.id === acc.id) setSelected(a => a ? { ...a, twoFactorEnabled: true } : null);
    setTimeout(() => setActionLoading(null), 400);
  }

  function doTerminateSession(acc: SuperAdminAccount, sess: SuperAdminSession) {
    terminateSession(acc.id, sess.id, actorName);
    createLog({ category: '보안', title: `세션 강제 종료: ${acc.name}`, detail: `세션 ${sess.id} / IP ${sess.ip}`, actorName, impact: 'high' });
    setSelected(a => a ? { ...a, sessions: a.sessions.map(s => s.id === sess.id ? { ...s, isActive: false } : s) } : null);
  }

  function doLock() {
    if (!selected) return;
    const h = parseInt(lockHours) || 24;
    lockAccount(selected.id, h, actorName);
    createLog({ category: '보안', title: `계정 잠금: ${selected.name} (${h}시간)`, detail: reason || '수동 잠금', actorName, impact: 'critical' });
    setLockModal(false); setReason("");
  }

  function doUnlock(acc: SuperAdminAccount) {
    unlockAccount(acc.id, actorName);
    createLog({ category: '보안', title: `계정 잠금 해제: ${acc.name}`, detail: '수동 해제', actorName, impact: 'medium' });
  }

  function doChangeRole(role: SuperAdminRole) {
    if (!selected) return;
    changeRole(selected.id, role, actorName);
    createLog({ category: '보안', title: `권한 변경: ${selected.name} → ${ROLE_CFG[role].label}`, detail: `이전: ${ROLE_CFG[selected.role].label}`, actorName, impact: 'critical' });
    setSelected(a => a ? { ...a, role } : null);
    setRoleModal(false);
  }

  function doToggleActive(acc: SuperAdminAccount) {
    toggleActive(acc.id, actorName);
    createLog({ category: '보안', title: `계정 ${acc.isActive ? '비활성화' : '활성화'}: ${acc.name}`, detail: '관리자 수동 처리', actorName, impact: 'high' });
  }

  const renderAccount = ({ item: acc }: { item: SuperAdminAccount }) => {
    const locked = isLocked(acc);
    const rc = ROLE_CFG[acc.role];
    return (
      <Pressable style={[s.card, !acc.isActive && s.cardInactive, locked && s.cardLocked]}
        onPress={() => setSelected(acc)}>
        <View style={s.cardTop}>
          <View style={[s.avatar, { backgroundColor: rc.bg }]}>
            <Text style={[s.avatarTxt, { color: rc.color }]}>{acc.name[0]}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={s.cardNameRow}>
              <Text style={s.cardName}>{acc.name}</Text>
              <View style={[s.roleBadge, { backgroundColor: rc.bg }]}>
                <Text style={[s.roleTxt, { color: rc.color }]}>{rc.label}</Text>
              </View>
              {locked && <View style={s.lockBadge}><Text style={s.lockTxt}>잠금</Text></View>}
              {!acc.isActive && <View style={s.inactiveBadge}><Text style={s.inactiveTxt}>비활성</Text></View>}
            </View>
            <Text style={s.cardEmail}>{acc.email}</Text>
          </View>
        </View>

        <View style={s.cardMeta}>
          <MetaItem icon="clock" label={`마지막 로그인: ${fmtDate(acc.lastLoginAt)}`} />
          <MetaItem icon="wifi" label={acc.lastLoginIp ?? '—'} />
          <MetaItem icon="shield" label={acc.twoFactorEnabled ? '2FA 활성' : '2FA 없음'} color={acc.twoFactorEnabled ? '#2EC4B6' : '#D96C6C'} />
          {acc.loginFailCount > 0 && <MetaItem icon="alert-triangle" label={`실패 ${acc.loginFailCount}회`} color={acc.loginFailCount >= 3 ? '#D96C6C' : '#D97706'} />}
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="슈퍼관리자 보안관리" homePath="/(super)/dashboard" />

      {/* KPI 요약 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.kpiBar} contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 10, gap: 8 }}>
        {[
          { label: '전체', val: stats.total, color: P },
          { label: '활성', val: stats.active, color: '#2EC4B6' },
          { label: '2FA 활성', val: stats.twoFA, color: '#2EC4B6' },
          { label: '잠금', val: stats.locked, color: DANGER },
          { label: '실패 3+', val: stats.highFail, color: '#D97706' },
        ].map(k => (
          <View key={k.label} style={[s.kpiCard, { borderTopColor: k.color }]}>
            <Text style={[s.kpiVal, { color: k.color }]}>{k.val}</Text>
            <Text style={s.kpiLabel}>{k.label}</Text>
          </View>
        ))}
      </ScrollView>

      <FlatList
        data={accounts}
        keyExtractor={a => a.id}
        renderItem={renderAccount}
        contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 80 }}
        ListEmptyComponent={<View style={s.empty}><Text style={s.emptyTxt}>계정 없음</Text></View>}
      />

      {/* 계정 상세 모달 */}
      {selected && (
        <Modal visible animationType="slide" transparent statusBarTranslucent onRequestClose={() => setSelected(null)}>
          <Pressable style={m.backdrop} onPress={() => setSelected(null)}>
            <Pressable style={m.sheet} onPress={() => {}}>
              <View style={m.handle} />
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={m.titleRow}>
                  <Text style={m.title}>{selected.name}</Text>
                  <View style={[m.roleBadge, { backgroundColor: ROLE_CFG[selected.role].bg }]}>
                    <Text style={[m.roleTxt, { color: ROLE_CFG[selected.role].color }]}>{ROLE_CFG[selected.role].label}</Text>
                  </View>
                </View>
                <Text style={m.sub}>{selected.email}</Text>

                {/* 보안 정보 */}
                <View style={m.section}>
                  <Text style={m.sectionTitle}>보안 상태</Text>
                  <InfoRow label="마지막 로그인" val={fmtDate(selected.lastLoginAt)} />
                  <InfoRow label="최근 IP" val={selected.lastLoginIp ?? '—'} />
                  <InfoRow label="2차 인증" val={selected.twoFactorEnabled ? '활성' : '비활성'} valColor={selected.twoFactorEnabled ? '#2EC4B6' : DANGER} />
                  <InfoRow label="로그인 실패" val={`${selected.loginFailCount}회`} valColor={selected.loginFailCount >= 3 ? DANGER : '#111827'} />
                  <InfoRow label="잠금 상태" val={isLocked(selected) ? `잠금 (${new Date(selected.lockedUntil!).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} 해제)` : '정상'} valColor={isLocked(selected) ? DANGER : '#2EC4B6'} />
                  <InfoRow label="계정 상태" val={selected.isActive ? '활성' : '비활성'} valColor={selected.isActive ? '#2EC4B6' : '#9CA3AF'} />
                </View>

                {/* 세션 */}
                {selected.sessions.length > 0 && (
                  <View style={m.section}>
                    <Text style={m.sectionTitle}>활성 세션</Text>
                    {selected.sessions.map(sess => (
                      <View key={sess.id} style={m.sessRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={m.sessDevice}>{sess.device}</Text>
                          <Text style={m.sessMeta}>{sess.ip} · {fmtDate(sess.startedAt)} 시작</Text>
                        </View>
                        {sess.isActive ? (
                          <Pressable style={m.sessKill} onPress={() => doTerminateSession(selected, sess)}>
                            <Text style={m.sessKillTxt}>종료</Text>
                          </Pressable>
                        ) : (
                          <Text style={m.sessDone}>종료됨</Text>
                        )}
                      </View>
                    ))}
                  </View>
                )}

                {/* 디바이스 */}
                {selected.devices.length > 0 && (
                  <View style={m.section}>
                    <Text style={m.sectionTitle}>디바이스 기록</Text>
                    {selected.devices.map(d => (
                      <View key={d.id} style={m.devRow}>
                        <Monitor size={14} color="#64748B" />
                        <View style={{ flex: 1 }}>
                          <Text style={m.devLabel}>{d.label} {d.isCurrent && <Text style={m.devCurrent}>(현재)</Text>}</Text>
                          <Text style={m.devMeta}>{d.os} · {d.browser} · {fmtDate(d.lastUsedAt)}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {/* 액션 */}
                <View style={m.section}>
                  <Text style={m.sectionTitle}>관리 액션</Text>
                  <View style={m.actions}>
                    {!selected.twoFactorEnabled && (
                      <ActionBtn label="2FA 강제 활성" icon="shield" color="#2EC4B6" bg="#E6FFFA"
                        loading={actionLoading === `2fa-${selected.id}`}
                        onPress={() => doForceTwoFactor(selected)} />
                    )}
                    <ActionBtn label="권한 변경" icon="user-check" color={P} bg="#EEDDF5"
                      onPress={() => setRoleModal(true)} />
                    {isLocked(selected)
                      ? <ActionBtn label="잠금 해제" icon="unlock" color="#2EC4B6" bg="#E6FFFA"
                          onPress={() => doUnlock(selected)} />
                      : <ActionBtn label="계정 잠금" icon="lock" color={DANGER} bg="#F9DEDA"
                          onPress={() => setLockModal(true)} />
                    }
                    <ActionBtn label={selected.isActive ? '계정 비활성화' : '계정 활성화'}
                      icon={selected.isActive ? 'user-x' : 'user-check'}
                      color={selected.isActive ? '#D97706' : '#2EC4B6'}
                      bg={selected.isActive ? '#FFF1BF' : '#E6FFFA'}
                      onPress={() => { doToggleActive(selected); setSelected(null); }} />
                    {selected.loginFailCount > 0 && (
                      <ActionBtn label="실패 횟수 초기화" icon="refresh-cw" color="#64748B" bg="#FFFFFF"
                        onPress={() => { resetFailCount(selected.id); setSelected(a => a ? { ...a, loginFailCount: 0 } : null); }} />
                    )}
                  </View>
                </View>
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* 역할 변경 모달 */}
      {roleModal && selected && (
        <Modal visible animationType="fade" transparent statusBarTranslucent onRequestClose={() => setRoleModal(false)}>
          <Pressable style={m.backdrop} onPress={() => setRoleModal(false)}>
            <Pressable style={[m.sheet, { paddingBottom: 30 }]} onPress={() => {}}>
              <View style={m.handle} />
              <Text style={m.title}>권한 변경 — {selected.name}</Text>
              <Text style={[m.sub, { marginBottom: 12 }]}>현재: {ROLE_CFG[selected.role].label}</Text>
              {(Object.keys(ROLE_CFG) as SuperAdminRole[]).map(r => (
                <Pressable key={r} style={[m.roleRow, selected.role === r && { backgroundColor: ROLE_CFG[r].bg }]}
                  onPress={() => doChangeRole(r)}>
                  <View style={[m.roleDot, { backgroundColor: ROLE_CFG[r].color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[m.roleRowLabel, { color: ROLE_CFG[r].color }]}>{ROLE_CFG[r].label}</Text>
                    {r === 'super_admin' && <Text style={m.roleDesc}>전체 권한 · 삭제 · 정책 변경</Text>}
                    {r === 'senior_admin' && <Text style={m.roleDesc}>대부분 기능 · 킬스위치 제외</Text>}
                    {r === 'read_only_admin' && <Text style={m.roleDesc}>읽기만 가능 · 변경 불가</Text>}
                  </View>
                  {selected.role === r && <Check size={16} color={ROLE_CFG[r].color} />}
                </Pressable>
              ))}
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* 잠금 모달 */}
      {lockModal && selected && (
        <Modal visible animationType="fade" transparent statusBarTranslucent onRequestClose={() => setLockModal(false)}>
          <Pressable style={m.backdrop} onPress={() => setLockModal(false)}>
            <Pressable style={[m.sheet, { paddingBottom: 30 }]} onPress={() => {}}>
              <View style={m.handle} />
              <Text style={m.title}>계정 잠금 — {selected.name}</Text>
              <Text style={m.sub}>잠금 시간 (시간)</Text>
              <View style={m.lockHours}>
                {["1","6","12","24","72","168"].map(h => (
                  <Pressable key={h} style={[m.hourBtn, lockHours === h && m.hourBtnActive]}
                    onPress={() => setLockHours(h)}>
                    <Text style={[m.hourTxt, lockHours === h && { color: "#fff" }]}>{h}h</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput style={m.reasonInput} value={reason} onChangeText={setReason}
                placeholder="잠금 사유 입력" placeholderTextColor="#64748B" />
              <View style={m.lockBtns}>
                <Pressable style={m.cancelBtn} onPress={() => setLockModal(false)}>
                  <Text style={m.cancelTxt}>취소</Text>
                </Pressable>
                <Pressable style={m.dangerBtn} onPress={doLock}>
                  <Lock size={14} color="#fff" />
                  <Text style={m.dangerTxt}>잠금 실행</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </SafeAreaView>
  );
}

function MetaItem({ icon, label, color = "#64748B" }: { icon: any; label: string; color?: string }) {
  return (
    <View style={s.metaItem}>
      <LucideIcon name={icon} size={10} color={color} />
      <Text style={[s.metaTxt, { color }]}>{label}</Text>
    </View>
  );
}

function InfoRow({ label, val, valColor = "#0F172A" }: { label: string; val: string; valColor?: string }) {
  return (
    <View style={m.infoRow}>
      <Text style={m.infoLabel}>{label}</Text>
      <Text style={[m.infoVal, { color: valColor }]}>{val}</Text>
    </View>
  );
}

function ActionBtn({ label, icon, color, bg, onPress, loading }: {
  label: string; icon: any; color: string; bg: string; onPress: () => void; loading?: boolean
}) {
  return (
    <Pressable style={[m.actionBtn, { backgroundColor: bg }]} onPress={onPress} disabled={loading}>
      {loading ? <ActivityIndicator size="small" color={color} /> : <LucideIcon name={icon} size={14} color={color} />}
      <Text style={[m.actionTxt, { color }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: C.background },
  kpiBar:       { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", flexGrow: 0 },
  kpiCard:      { width: 80, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: "#F1F5F9",
                  borderRadius: 10, borderTopWidth: 2, alignItems: "center", gap: 2 },
  kpiVal:       { fontSize: 18, fontFamily: "Pretendard-Regular" },
  kpiLabel:     { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B" },
  card:         { backgroundColor: "#fff", borderRadius: 14, padding: 14, gap: 10,
                  shadowColor: "#0000001A", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 3, elevation: 1 },
  cardInactive: { opacity: 0.5 },
  cardLocked:   { borderLeftWidth: 3, borderLeftColor: "#D96C6C" },
  cardTop:      { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  avatar:       { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  avatarTxt:    { fontSize: 18, fontFamily: "Pretendard-Regular" },
  cardNameRow:  { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  cardName:     { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  cardEmail:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2 },
  roleBadge:    { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  roleTxt:      { fontSize: 10, fontFamily: "Pretendard-Regular" },
  lockBadge:    { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: "#F9DEDA" },
  lockTxt:      { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#D96C6C" },
  inactiveBadge:{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: "#FFFFFF" },
  inactiveTxt:  { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B" },
  cardMeta:     { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metaItem:     { flexDirection: "row", alignItems: "center", gap: 4 },
  metaTxt:      { fontSize: 11, fontFamily: "Pretendard-Regular" },
  empty:        { alignItems: "center", paddingTop: 60 },
  emptyTxt:     { fontSize: 14, color: "#64748B", fontFamily: "Pretendard-Regular" },
});

const m = StyleSheet.create({
  backdrop:     { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:        { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
                  borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: "85%", gap: 10 },
  handle:       { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  titleRow:     { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  title:        { fontSize: 17, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  sub:          { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B" },
  roleBadge:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  roleTxt:      { fontSize: 11, fontFamily: "Pretendard-Regular" },
  section:      { gap: 8, paddingTop: 6 },
  sectionTitle: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A", borderBottomWidth: 1,
                  borderBottomColor: "#FFFFFF", paddingBottom: 6, marginBottom: 2 },
  infoRow:      { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 },
  infoLabel:    { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B" },
  infoVal:      { fontSize: 13, fontFamily: "Pretendard-Regular" },
  sessRow:      { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8,
                  borderBottomWidth: 1, borderBottomColor: "#FFFFFF" },
  sessDevice:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  sessMeta:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  sessKill:     { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: "#F9DEDA" },
  sessKillTxt:  { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#D96C6C" },
  sessDone:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  devRow:       { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 6,
                  borderBottomWidth: 1, borderBottomColor: "#FFFFFF" },
  devLabel:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  devCurrent:   { color: "#2EC4B6", fontFamily: "Pretendard-Regular" },
  devMeta:      { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  actions:      { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  actionBtn:    { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12,
                  paddingVertical: 9, borderRadius: 10 },
  actionTxt:    { fontSize: 13, fontFamily: "Pretendard-Regular" },
  roleRow:      { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 10, marginBottom: 4 },
  roleDot:      { width: 10, height: 10, borderRadius: 5 },
  roleRowLabel: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  roleDesc:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2 },
  lockHours:    { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  hourBtn:      { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
                  borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#F1F5F9" },
  hourBtnActive:{ backgroundColor: "#D96C6C", borderColor: "#D96C6C" },
  hourTxt:      { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  reasonInput:  { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, padding: 12,
                  fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A", marginBottom: 4 },
  lockBtns:     { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  cancelBtn:    { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: "#FFFFFF" },
  cancelTxt:    { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  dangerBtn:    { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16,
                  paddingVertical: 10, borderRadius: 10, backgroundColor: "#D96C6C" },
  dangerTxt:    { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
});
