/**
 * 선생님 관리 (직접 계정 + 초대 방식)
 */
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal,
  Platform, Pressable, RefreshControl, ScrollView,
  StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;

interface Teacher {
  id: string; name: string; email: string; phone: string;
  is_activated: boolean; is_admin_self_teacher: boolean; created_at: string;
}
interface TeacherInvite {
  id: string; name: string; phone: string; position: string | null;
  invite_token: string | null; invite_status: string;
  created_at: string; requested_at: string | null;
  approved_at: string | null; user_email: string | null;
}
interface CreateForm {
  name: string; email: string; phone: string; password: string; is_admin_self_teacher: boolean;
}
interface InviteForm {
  name: string; phone: string; position: string;
}

type MainTab = "direct" | "invites";
type InviteFilter = "all" | "invited" | "joinedPendingApproval" | "approved" | "rejected" | "inactive";

const INVITE_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  invited:               { label: "초대 보냄",  color: "#3B82F6", bg: "#DBEAFE" },
  joinedPendingApproval: { label: "승인 대기",  color: "#D97706", bg: "#FEF3C7" },
  approved:              { label: "승인 완료",  color: "#059669", bg: "#D1FAE5" },
  rejected:              { label: "거절됨",     color: "#DC2626", bg: "#FEE2E2" },
  inactive:              { label: "비활성",     color: "#6B7280", bg: "#F3F4F6" },
};

const INVITE_FILTER_OPTIONS: { key: InviteFilter; label: string }[] = [
  { key: "all",                   label: "전체" },
  { key: "invited",               label: "초대 보냄" },
  { key: "joinedPendingApproval", label: "승인 대기" },
  { key: "approved",              label: "승인 완료" },
  { key: "rejected",              label: "거절됨" },
];

export default function TeachersScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [mainTab, setMainTab] = useState<MainTab>("direct");
  const [inviteFilter, setInviteFilter] = useState<InviteFilter>("all");

  // 직접 생성 계정
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState("");
  const [newTeacher, setNewTeacher] = useState<{ teacher: Teacher; code: string } | null>(null);
  const [codeVisible, setCodeVisible] = useState<Record<string, string>>({});
  const [loadingCode, setLoadingCode] = useState<string | null>(null);
  const [form, setForm] = useState<CreateForm>({ name: "", email: "", phone: "", password: "", is_admin_self_teacher: false });

  // 초대 방식
  const [invites, setInvites] = useState<TeacherInvite[]>([]);
  const [showInviteAdd, setShowInviteAdd] = useState(false);
  const [inviteForm, setInviteForm] = useState<InviteForm>({ name: "", phone: "", position: "" });
  const [inviteSaving, setInviteSaving] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [processingInviteId, setProcessingInviteId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const hasAdminSelf = teachers.some(t => t.is_admin_self_teacher);

  const fetchAll = useCallback(async () => {
    try {
      const [tRes, iRes] = await Promise.all([
        apiRequest(token, "/teachers"),
        apiRequest(token, "/admin/teacher-invites"),
      ]);
      if (tRes.ok) setTeachers(await tRes.json());
      if (iRes.ok) { const d = await iRes.json(); setInvites(d.data ?? []); }
    } finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── 직접 계정 생성 ────────────────────────────────────────────────────
  function resetForm() { setForm({ name: "", email: "", phone: "", password: "", is_admin_self_teacher: false }); setAddError(""); }

  async function handleCreate() {
    if (!form.name.trim() || !form.email.trim() || !form.password || !form.phone.trim()) { setAddError("모든 필수 항목을 입력해주세요."); return; }
    if (form.password.length < 6) { setAddError("비밀번호는 6자 이상이어야 합니다."); return; }
    if (form.is_admin_self_teacher && hasAdminSelf) { setAddError("관리자 본인용 선생님 계정은 이미 등록되어 있습니다."); return; }
    setSaving(true); setAddError("");
    try {
      const res = await apiRequest(token, "/teachers", { method: "POST", body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "생성 실패");
      setShowAdd(false); resetForm();
      setNewTeacher({ teacher: data.teacher, code: data.activation_code });
      fetchAll();
    } catch (err: any) { setAddError(err.message || "생성 중 오류"); }
    finally { setSaving(false); }
  }

  async function handleViewCode(id: string) {
    setLoadingCode(id);
    try {
      const res = await apiRequest(token, `/teachers/${id}/activation-code`);
      const data = await res.json();
      if (res.ok) setCodeVisible(prev => ({ ...prev, [id]: data.activation_code }));
      else Alert.alert("오류", data.error || "코드 조회 실패");
    } finally { setLoadingCode(null); }
  }

  async function handleDeleteTeacher(id: string, name: string) {
    Alert.alert("선생님 삭제", `${name} 계정을 삭제하시겠습니까?`, [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: async () => {
        const res = await apiRequest(token, `/teachers/${id}`, { method: "DELETE" });
        if (res.ok) fetchAll();
        else Alert.alert("오류", "삭제에 실패했습니다.");
      }},
    ]);
  }

  // ── 초대 생성 ─────────────────────────────────────────────────────────
  function resetInviteForm() { setInviteForm({ name: "", phone: "", position: "" }); setInviteError(""); }

  async function handleCreateInvite() {
    if (!inviteForm.name.trim() || !inviteForm.phone.trim()) { setInviteError("이름과 연락처는 필수입니다."); return; }
    setInviteSaving(true); setInviteError("");
    try {
      const res = await apiRequest(token, "/admin/teacher-invites", { method: "POST", body: JSON.stringify(inviteForm) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "초대 생성 실패");
      setShowInviteAdd(false); resetInviteForm();
      fetchAll();
      setMainTab("invites");
    } catch (err: any) { setInviteError(err.message || "오류가 발생했습니다."); }
    finally { setInviteSaving(false); }
  }

  // ── 초대 링크 복사 ────────────────────────────────────────────────────
  async function handleCopyLink(invite: TeacherInvite) {
    if (!invite.invite_token) { Alert.alert("오류", "초대 토큰이 없습니다."); return; }
    const link = `스윔노트 선생님 초대링크\n앱 설치 후 초대 코드를 입력해 주세요:\n\n초대 코드: ${invite.invite_token}\n\n수영장 가입 및 초대 코드 입력 후 관리자 승인 절차가 진행됩니다.`;
    await Clipboard.setStringAsync(link);
    setCopiedId(invite.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  // ── 초대 승인/거절/비활성화 ───────────────────────────────────────────
  async function handleInviteAction(invite: TeacherInvite, action: string) {
    const labels: Record<string, string> = { approve: "승인", reject: "거절", deactivate: "비활성화", reactivate: "재활성화" };
    const label = labels[action] || action;
    Alert.alert(`선생님 ${label}`, `${invite.name} 선생님을 ${label}하시겠습니까?`, [
      { text: "취소", style: "cancel" },
      {
        text: label, style: action === "reject" || action === "deactivate" ? "destructive" : "default",
        onPress: async () => {
          setProcessingInviteId(invite.id);
          try {
            const res = await apiRequest(token, `/admin/teacher-invites/${invite.id}`, {
              method: "PATCH", body: JSON.stringify({ action }),
            });
            const d = await res.json();
            if (!res.ok) Alert.alert("오류", d.message || "처리 중 오류 발생");
            else fetchAll();
          } finally { setProcessingInviteId(null); }
        },
      },
    ]);
  }

  // ── 초대 필터 ─────────────────────────────────────────────────────────
  const filteredInvites = inviteFilter === "all"
    ? invites
    : invites.filter(i => i.invite_status === inviteFilter);

  const pendingInviteCount = invites.filter(i => i.invite_status === "joinedPendingApproval").length;

  // ── 렌더링 ────────────────────────────────────────────────────────────
  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      {/* 헤더 */}
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <View>
          <Text style={[styles.headerTitle, { color: C.text }]}>선생님 관리</Text>
          <Text style={[styles.headerSub, { color: C.textMuted }]}>선생님 계정 추가 및 초대 관리</Text>
        </View>
        <Pressable
          style={[styles.addBtn, { backgroundColor: C.tint }]}
          onPress={() => {
            if (mainTab === "direct") { resetForm(); setShowAdd(true); }
            else { resetInviteForm(); setShowInviteAdd(true); }
          }}
        >
          <Feather name="plus" size={18} color="#fff" />
          <Text style={styles.addBtnText}>{mainTab === "direct" ? "계정 추가" : "초대 생성"}</Text>
        </Pressable>
      </View>

      {/* 메인 탭 */}
      <View style={[styles.tabRow, { borderBottomColor: C.border }]}>
        {[
          { key: "direct" as MainTab, label: "직접 생성 계정" },
          { key: "invites" as MainTab, label: "초대 관리", count: pendingInviteCount },
        ].map(t => (
          <Pressable key={t.key} style={[styles.tabItem, mainTab === t.key && { borderBottomColor: C.tint }]} onPress={() => setMainTab(t.key)}>
            <Text style={[styles.tabLabel, { color: mainTab === t.key ? C.tint : C.textSecondary }]}>{t.label}</Text>
            {!!t.count && <View style={[styles.countBadge, { backgroundColor: C.error }]}>
              <Text style={styles.countText}>{t.count}</Text>
            </View>}
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 120, gap: 10, paddingTop: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAll(); }} />}
          showsVerticalScrollIndicator={false}
        >
          {/* ── 직접 생성 탭 ─────────────────────────────────── */}
          {mainTab === "direct" && (
            <>
              <View style={[styles.infoBox, { backgroundColor: C.tintLight }]}>
                <Feather name="info" size={14} color={C.tint} />
                <Text style={[styles.infoText, { color: C.tint }]}>
                  계정 생성 후 인증코드를 선생님에게 전달하세요.{"\n"}선생님이 앱 로그인 후 코드를 입력하면 활성화됩니다.
                </Text>
              </View>
              {teachers.length === 0 ? (
                <View style={styles.empty}>
                  <Feather name="users" size={40} color={C.textMuted} />
                  <Text style={[styles.emptyText, { color: C.textMuted }]}>등록된 선생님이 없습니다</Text>
                  <Text style={[styles.emptySub, { color: C.textMuted }]}>상단 [계정 추가] 버튼으로 등록해주세요</Text>
                </View>
              ) : teachers.map(t => (
                <View key={t.id} style={[styles.card, { backgroundColor: C.card, shadowColor: C.shadow }]}>
                  <View style={styles.cardTop}>
                    <View style={[styles.avatar, { backgroundColor: t.is_admin_self_teacher ? "#7C3AED15" : C.tintLight }]}>
                      <Feather name="user" size={20} color={t.is_admin_self_teacher ? "#7C3AED" : C.tint} />
                    </View>
                    <View style={styles.cardInfo}>
                      <View style={styles.nameRow}>
                        <Text style={[styles.teacherName, { color: C.text }]}>{t.name}</Text>
                        {t.is_admin_self_teacher && (
                          <View style={[styles.selfBadge, { backgroundColor: "#7C3AED15" }]}>
                            <Text style={[styles.selfBadgeText, { color: "#7C3AED" }]}>내 계정</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.teacherEmail, { color: C.textSecondary }]}>{t.email}</Text>
                      {t.phone && <Text style={[styles.teacherPhone, { color: C.textMuted }]}>{t.phone}</Text>}
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: t.is_activated ? "#D1FAE5" : "#FEF3C7" }]}>
                      <Text style={[styles.statusText, { color: t.is_activated ? "#059669" : "#D97706" }]}>
                        {t.is_activated ? "활성" : "인증 대기"}
                      </Text>
                    </View>
                  </View>
                  {!t.is_activated && (
                    <View style={[styles.codeSection, { borderTopColor: C.border }]}>
                      {codeVisible[t.id] ? (
                        <View style={[styles.codeBox, { backgroundColor: "#FEF3C7", borderRadius: 10, padding: 12 }]}>
                          <Text style={[styles.codeLabel, { color: "#92400E" }]}>인증코드 (선생님에게 전달해주세요)</Text>
                          <Text style={[styles.codeValue, { color: "#92400E" }]}>{codeVisible[t.id]}</Text>
                        </View>
                      ) : (
                        <Pressable style={[styles.viewCodeBtn, { borderColor: C.warning }]} onPress={() => handleViewCode(t.id)} disabled={loadingCode === t.id}>
                          {loadingCode === t.id ? <ActivityIndicator color={C.warning} size="small" /> : (
                            <><Feather name="key" size={14} color={C.warning} />
                            <Text style={[styles.viewCodeText, { color: C.warning }]}>인증코드 보기</Text></>
                          )}
                        </Pressable>
                      )}
                    </View>
                  )}
                  <View style={[styles.cardActions, { borderTopColor: C.border }]}>
                    <Pressable style={styles.actionBtn} onPress={() => handleDeleteTeacher(t.id, t.name)}>
                      <Feather name="trash-2" size={14} color={C.error} />
                      <Text style={[styles.actionText, { color: C.error }]}>삭제</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </>
          )}

          {/* ── 초대 관리 탭 ─────────────────────────────────── */}
          {mainTab === "invites" && (
            <>
              <View style={[styles.infoBox, { backgroundColor: C.tintLight }]}>
                <Feather name="info" size={14} color={C.tint} />
                <Text style={[styles.infoText, { color: C.tint }]}>
                  이름/연락처/직급 입력 후 초대 코드를 생성하세요.{"\n"}
                  선생님에게 코드를 전달하면 앱에서 가입 후 승인 가능합니다.
                </Text>
              </View>

              {/* 상태 필터 */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
                {INVITE_FILTER_OPTIONS.map(f => {
                  const isActive = inviteFilter === f.key;
                  const cfg = f.key !== "all" ? INVITE_STATUS_CONFIG[f.key] : null;
                  return (
                    <Pressable
                      key={f.key}
                      style={[styles.filterChip, {
                        backgroundColor: isActive ? (cfg?.bg || C.tintLight) : C.card,
                        borderColor: isActive ? (cfg?.color || C.tint) : C.border,
                      }]}
                      onPress={() => setInviteFilter(f.key)}
                    >
                      <Text style={[styles.filterChipText, { color: isActive ? (cfg?.color || C.tint) : C.textSecondary }]}>{f.label}</Text>
                      {f.key !== "all" && (
                        <Text style={[styles.filterCount, { color: isActive ? (cfg?.color || C.tint) : C.textMuted }]}>
                          {invites.filter(i => i.invite_status === f.key).length}
                        </Text>
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>

              {filteredInvites.length === 0 ? (
                <View style={styles.empty}>
                  <Feather name="send" size={40} color={C.textMuted} />
                  <Text style={[styles.emptyText, { color: C.textMuted }]}>초대 내역이 없습니다</Text>
                  <Text style={[styles.emptySub, { color: C.textMuted }]}>상단 [초대 생성] 버튼을 눌러 시작하세요</Text>
                </View>
              ) : filteredInvites.map(inv => {
                const cfg = INVITE_STATUS_CONFIG[inv.invite_status] || INVITE_STATUS_CONFIG.invited;
                const isProcessing = processingInviteId === inv.id;
                return (
                  <View key={inv.id} style={[styles.inviteCard, { backgroundColor: C.card, borderColor: C.border }]}>
                    <View style={styles.inviteCardTop}>
                      <View style={[styles.avatar, { backgroundColor: cfg.bg }]}>
                        <Feather name="user" size={20} color={cfg.color} />
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={[styles.teacherName, { color: C.text }]}>{inv.name}</Text>
                        <Text style={[styles.teacherPhone, { color: C.textSecondary }]}>{inv.phone}</Text>
                        {inv.position && <Text style={[styles.positionText, { color: C.textMuted }]}>{inv.position}</Text>}
                        {inv.user_email && <Text style={[styles.positionText, { color: C.textMuted }]}>{inv.user_email}</Text>}
                      </View>
                      <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
                        <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
                      </View>
                    </View>

                    {/* 초대 링크 복사 (invited 상태만) */}
                    {inv.invite_status === "invited" && inv.invite_token && (
                      <Pressable
                        style={[styles.copyBtn, { backgroundColor: copiedId === inv.id ? "#D1FAE5" : C.tintLight, borderColor: copiedId === inv.id ? C.success : C.tint }]}
                        onPress={() => handleCopyLink(inv)}
                      >
                        <Feather name={copiedId === inv.id ? "check" : "copy"} size={14} color={copiedId === inv.id ? C.success : C.tint} />
                        <Text style={[styles.copyBtnText, { color: copiedId === inv.id ? C.success : C.tint }]}>
                          {copiedId === inv.id ? "복사됨!" : "초대 코드 복사"}
                        </Text>
                      </Pressable>
                    )}

                    {/* 승인 대기: 승인/거절 버튼 */}
                    {inv.invite_status === "joinedPendingApproval" && (
                      <View style={styles.inviteActions}>
                        <Pressable
                          style={[styles.rejectBtn, { borderColor: C.error }]}
                          onPress={() => handleInviteAction(inv, "reject")}
                          disabled={isProcessing}
                        >
                          {isProcessing ? <ActivityIndicator size="small" color={C.error} /> : (
                            <><Feather name="x" size={14} color={C.error} />
                            <Text style={[styles.rejectBtnText, { color: C.error }]}>거절</Text></>
                          )}
                        </Pressable>
                        <Pressable
                          style={[styles.approveBtn, { backgroundColor: C.success }]}
                          onPress={() => handleInviteAction(inv, "approve")}
                          disabled={isProcessing}
                        >
                          {isProcessing ? <ActivityIndicator size="small" color="#fff" /> : (
                            <><Feather name="check" size={14} color="#fff" />
                            <Text style={styles.approveBtnText}>승인</Text></>
                          )}
                        </Pressable>
                      </View>
                    )}

                    {/* 승인 완료: 비활성화 버튼 */}
                    {inv.invite_status === "approved" && (
                      <View style={[styles.inviteActions, { justifyContent: "flex-end" }]}>
                        <Pressable
                          style={[styles.smallActionBtn, { borderColor: C.border }]}
                          onPress={() => handleInviteAction(inv, "deactivate")}
                          disabled={isProcessing}
                        >
                          <Feather name="pause-circle" size={14} color={C.textSecondary} />
                          <Text style={[styles.smallActionText, { color: C.textSecondary }]}>비활성화</Text>
                        </Pressable>
                      </View>
                    )}

                    {/* 비활성 상태: 재활성화 버튼 */}
                    {inv.invite_status === "inactive" && (
                      <View style={[styles.inviteActions, { justifyContent: "flex-end" }]}>
                        <Pressable
                          style={[styles.smallActionBtn, { borderColor: C.tint }]}
                          onPress={() => handleInviteAction(inv, "reactivate")}
                          disabled={isProcessing}
                        >
                          <Feather name="play-circle" size={14} color={C.tint} />
                          <Text style={[styles.smallActionText, { color: C.tint }]}>재활성화</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                );
              })}
            </>
          )}
        </ScrollView>
      )}

      {/* ── 직접 계정 추가 모달 ────────────────────────────────────────── */}
      <Modal visible={showAdd} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[styles.modal, { backgroundColor: C.background }]}>
            <View style={[styles.modalHeader, { borderBottomColor: C.border }]}>
              <Pressable onPress={() => { setShowAdd(false); resetForm(); }}>
                <Feather name="x" size={22} color={C.text} />
              </Pressable>
              <Text style={[styles.modalTitle, { color: C.text }]}>선생님 계정 추가</Text>
              <Pressable style={[styles.saveBtn, { backgroundColor: C.tint, opacity: saving ? 0.6 : 1 }]} onPress={handleCreate} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>추가</Text>}
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
              {addError ? (
                <View style={[styles.errBox, { backgroundColor: "#FEE2E2" }]}>
                  <Feather name="alert-circle" size={14} color={C.error} />
                  <Text style={[styles.errText, { color: C.error }]}>{addError}</Text>
                </View>
              ) : null}
              {[
                { key: "name",     label: "이름 *",          placeholder: "선생님 이름",        icon: "user" },
                { key: "phone",    label: "연락처 *",         placeholder: "010-0000-0000",     icon: "phone",  keyboard: "phone-pad" },
                { key: "email",    label: "이메일 *",         placeholder: "로그인 이메일",       icon: "mail",   keyboard: "email-address" },
                { key: "password", label: "임시 비밀번호 *",  placeholder: "6자 이상",           icon: "lock",   secure: true },
              ].map(({ key, label, placeholder, icon, keyboard, secure }) => (
                <View key={key} style={{ gap: 4 }}>
                  <Text style={[styles.label, { color: C.textSecondary }]}>{label}</Text>
                  <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.card }]}>
                    <Feather name={icon as any} size={16} color={C.textMuted} />
                    <TextInput
                      style={[styles.input, { color: C.text }]}
                      value={form[key as keyof CreateForm] as string}
                      onChangeText={v => setForm(f => ({ ...f, [key]: v }))}
                      placeholder={placeholder} placeholderTextColor={C.textMuted}
                      keyboardType={(keyboard as any) || "default"}
                      secureTextEntry={!!secure} autoCapitalize="none"
                    />
                  </View>
                </View>
              ))}
              <View style={[styles.selfToggleCard, { backgroundColor: C.card, borderColor: form.is_admin_self_teacher ? "#7C3AED" : C.border }]}>
                <View style={styles.selfToggleLeft}>
                  <View style={[styles.selfToggleIcon, { backgroundColor: "#7C3AED15" }]}>
                    <Feather name="shield" size={18} color="#7C3AED" />
                  </View>
                  <View>
                    <Text style={[styles.selfToggleTitle, { color: C.text }]}>관리자 본인용 계정</Text>
                    <Text style={[styles.selfToggleSub, { color: C.textMuted }]}>{hasAdminSelf ? "이미 등록됨 (최대 1개)" : "최대 1개까지 가능"}</Text>
                  </View>
                </View>
                <Switch value={form.is_admin_self_teacher} onValueChange={v => setForm(f => ({ ...f, is_admin_self_teacher: v }))}
                  trackColor={{ false: C.border, true: "#7C3AED" }} thumbColor="#fff" disabled={hasAdminSelf} />
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── 초대 생성 모달 ──────────────────────────────────────────────── */}
      <Modal visible={showInviteAdd} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[styles.modal, { backgroundColor: C.background }]}>
            <View style={[styles.modalHeader, { borderBottomColor: C.border }]}>
              <Pressable onPress={() => { setShowInviteAdd(false); resetInviteForm(); }}>
                <Feather name="x" size={22} color={C.text} />
              </Pressable>
              <Text style={[styles.modalTitle, { color: C.text }]}>선생님 초대</Text>
              <Pressable style={[styles.saveBtn, { backgroundColor: C.tint, opacity: inviteSaving ? 0.6 : 1 }]} onPress={handleCreateInvite} disabled={inviteSaving}>
                {inviteSaving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>초대 생성</Text>}
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
              {inviteError ? (
                <View style={[styles.errBox, { backgroundColor: "#FEE2E2" }]}>
                  <Feather name="alert-circle" size={14} color={C.error} />
                  <Text style={[styles.errText, { color: C.error }]}>{inviteError}</Text>
                </View>
              ) : null}
              {[
                { key: "name",     label: "이름 *",    placeholder: "선생님 이름",     icon: "user" },
                { key: "phone",    label: "연락처 *",  placeholder: "010-0000-0000",  icon: "phone", keyboard: "phone-pad" },
                { key: "position", label: "직급",      placeholder: "예: 수석 강사",  icon: "briefcase" },
              ].map(({ key, label, placeholder, icon, keyboard }) => (
                <View key={key} style={{ gap: 4 }}>
                  <Text style={[styles.label, { color: C.textSecondary }]}>{label}</Text>
                  <View style={[styles.inputRow, { borderColor: C.border, backgroundColor: C.card }]}>
                    <Feather name={icon as any} size={16} color={C.textMuted} />
                    <TextInput
                      style={[styles.input, { color: C.text }]}
                      value={inviteForm[key as keyof InviteForm]}
                      onChangeText={v => setInviteForm(f => ({ ...f, [key]: v }))}
                      placeholder={placeholder} placeholderTextColor={C.textMuted}
                      keyboardType={(keyboard as any) || "default"}
                    />
                  </View>
                </View>
              ))}
              <View style={[styles.infoBox, { backgroundColor: "#FEF3C7", borderRadius: 12, padding: 14 }]}>
                <Feather name="alert-circle" size={14} color="#D97706" />
                <Text style={[styles.infoText, { color: "#92400E" }]}>
                  초대 생성 후 코드를 복사해 선생님에게 전달하세요.{"\n"}
                  선생님이 앱에서 코드를 입력하면 가입이 완료되고{"\n"}
                  관리자 승인 후 활성화됩니다.
                </Text>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 직접 생성 결과 모달 */}
      <Modal visible={!!newTeacher} animationType="fade" transparent>
        <View style={styles.overlay}>
          <View style={[styles.resultModal, { backgroundColor: C.card }]}>
            <View style={[styles.resultIcon, { backgroundColor: "#D1FAE5" }]}>
              <Feather name="check-circle" size={32} color="#059669" />
            </View>
            <Text style={[styles.resultTitle, { color: C.text }]}>선생님 계정이 생성됐어요</Text>
            <Text style={[styles.resultName, { color: C.tint }]}>{newTeacher?.teacher.name}</Text>
            <Text style={[styles.resultLabel, { color: C.textSecondary }]}>인증코드</Text>
            <View style={[styles.codeDisplay, { backgroundColor: "#FEF3C7" }]}>
              <Text style={[styles.codeDisplayValue, { color: "#92400E" }]}>{newTeacher?.code}</Text>
            </View>
            <Text style={[styles.resultHint, { color: C.textMuted }]}>
              위 인증코드를 선생님에게 전달해주세요.{"\n"}코드 유효시간: 24시간
            </Text>
            <Pressable style={[styles.resultBtn, { backgroundColor: C.tint }]} onPress={() => setNewTeacher(null)}>
              <Text style={styles.resultBtnText}>확인</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 16 },
  headerTitle: { fontSize: 24, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  addBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  tabRow: { flexDirection: "row", borderBottomWidth: 1, marginHorizontal: 16, marginBottom: 4 },
  tabItem: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  countBadge: { minWidth: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  countText: { color: "#fff", fontSize: 11, fontFamily: "Inter_700Bold" },
  filterChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5 },
  filterChipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  filterCount: { fontSize: 12, fontFamily: "Inter_700Bold" },
  infoBox: { flexDirection: "row", gap: 8, padding: 12, borderRadius: 10, alignItems: "flex-start" },
  infoText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 18 },
  empty: { alignItems: "center", gap: 10, paddingTop: 80 },
  emptyText: { fontSize: 16, fontFamily: "Inter_500Medium" },
  emptySub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  card: { borderRadius: 16, overflow: "hidden", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 12, elevation: 3 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  avatar: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  cardInfo: { flex: 1, gap: 2 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  teacherName: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  selfBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  selfBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  teacherEmail: { fontSize: 12, fontFamily: "Inter_400Regular" },
  teacherPhone: { fontSize: 12, fontFamily: "Inter_400Regular" },
  positionText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  codeSection: { borderTopWidth: 1, padding: 12 },
  codeBox: {},
  codeLabel: { fontSize: 11, fontFamily: "Inter_500Medium", marginBottom: 4 },
  codeValue: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: 4, textAlign: "center", paddingVertical: 6 },
  viewCodeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1.5, borderRadius: 10, paddingVertical: 10 },
  viewCodeText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  cardActions: { flexDirection: "row", justifyContent: "flex-end", borderTopWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6 },
  actionText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  inviteCard: { borderRadius: 14, padding: 14, gap: 10, borderWidth: 1, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1 },
  inviteCardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  copyBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5 },
  copyBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  inviteActions: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  rejectBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5 },
  rejectBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  approveBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 10 },
  approveBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  smallActionBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5 },
  smallActionText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  modal: { flex: 1 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1 },
  modalTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  saveBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, minWidth: 60, alignItems: "center" },
  saveBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  errBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10 },
  errText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 48 },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  selfToggleCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1.5, borderRadius: 14, padding: 14 },
  selfToggleLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  selfToggleIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  selfToggleTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  selfToggleSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 24 },
  resultModal: { width: "100%", borderRadius: 24, padding: 28, gap: 12, alignItems: "center" },
  resultIcon: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  resultTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  resultName: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  resultLabel: { fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 8 },
  codeDisplay: { width: "100%", borderRadius: 14, paddingVertical: 16, paddingHorizontal: 20, alignItems: "center" },
  codeDisplayValue: { fontSize: 32, fontFamily: "Inter_700Bold", letterSpacing: 6 },
  resultHint: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  resultBtn: { width: "100%", height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 8 },
  resultBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
