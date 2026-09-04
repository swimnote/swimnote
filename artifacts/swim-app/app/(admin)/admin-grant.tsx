/**
 * 관리자 추가/승계 화면
 * - 승인된 선생님 목록 표시
 * - 선생님에게 관리자 권한 부여/회수 가능
 * - 관리자 수 제한 없음 (여러 명 가능)
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Platform, Pressable,
  RefreshControl, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;
const TAB_BAR_H = Platform.OS === "web" ? 84 : Platform.OS === "android" ? 56 : 49;

interface GrantTeacher {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  is_admin_granted: boolean;
  approved_at?: string;
}

function fmtDate(dt?: string | null) {
  if (!dt) return null;
  try { return new Date(dt).toLocaleDateString("ko-KR"); } catch { return dt; }
}

export default function AdminGrantScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const [teachers, setTeachers]     = useState<GrantTeacher[]>([]);
  const [loading, setLoading]       = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [confirmTarget, setConfirmTarget]   = useState<GrantTeacher | null>(null);
  const [processing, setProcessing]         = useState(false);
  const [resultMsg, setResultMsg]           = useState<string | null>(null);

  // ── 결과 모달 닫기 공통 함수 ─────────────────────────────────────────────
  function closeResultModal() {
    setResultMsg(null);
    setConfirmTarget(null);
    setProcessing(false);
  }

  const load = useCallback(async (isRefresh = false) => {
    if (!token) return;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const r = await apiRequest(token, "/admin/approved-teachers-for-grant");
      if (r.ok) {
        const d = await r.json();
        setTeachers(Array.isArray(d) ? d : (d.data ?? []));
      }
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function handleGrant(userId: string, grant: boolean) {
    if (processing) return;
    setProcessing(true);
    let successMessage: string | null = null;

    try {
      const r = await apiRequest(token, "/admin/grant-pool-admin", {
        method: "POST",
        body: JSON.stringify({ userId, grant }),
      });
      const d = await r.json();

      if (!r.ok) {
        // 실패: 확인 다이얼로그 먼저 닫고 → processing 해제 → 오류 메시지
        setConfirmTarget(null);
        setProcessing(false);
        setResultMsg(d.message || "처리 중 오류가 발생했습니다.");
        return;
      }

      // 성공: 서버 roles 기준으로 목록 즉시 갱신
      const serverRoles: string[] = Array.isArray(d.roles) ? d.roles : [];
      const isAdminGranted = serverRoles.includes("pool_admin");
      setTeachers(prev =>
        prev.map(t => t.id === userId ? { ...t, is_admin_granted: isAdminGranted } : t)
      );
      successMessage = grant
        ? "관리자 권한이 부여되었습니다.\n대상 선생님 앱에 최대 15초 이내 자동 반영됩니다."
        : "관리자 권한이 회수되었습니다.\n대상 선생님 앱에 최대 15초 이내 자동 반영됩니다.";

      // 확인 다이얼로그 종료 → processing 해제 → 결과 모달 표시 (순서 중요)
      setConfirmTarget(null);
      setProcessing(false);
      setResultMsg(successMessage);

      // 목록 전체 재조회는 백그라운드로 (결과 모달 닫힘과 무관하게 실행)
      void apiRequest(token, "/admin/approved-teachers-for-grant")
        .then(async res => {
          if (res.ok) {
            const d2 = await res.json();
            setTeachers(Array.isArray(d2) ? d2 : (d2.data ?? []));
          }
        })
        .catch(() => {});

    } catch {
      // 네트워크 오류: 목록 상태 변경 없이 오류 메시지만 표시
      setConfirmTarget(null);
      setProcessing(false);
      setResultMsg("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      // finally는 processing / confirmTarget 정리만 담당
      // resultMsg는 절대 건드리지 않음 (이미 위에서 명시적으로 처리)
      if (successMessage === null) {
        setProcessing(false);
        setConfirmTarget(null);
      }
    }
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <SubScreenHeader title="관리자 추가/승계" />

      {/* 안내 배너 */}
      <View style={s.infoBanner}>
        <LucideIcon name="info" size={14} color={C.brandStrong} />
        <Text style={s.infoTxt}>
          승인된 선생님에게 관리자 권한을 부여할 수 있습니다.{"\n"}
          관리자 권한을 받은 선생님은 선생님↔관리자 역할 전환이 가능합니다.{"\n"}
          권한 변경 사항은 대상 선생님 앱에 최대 15초 이내 자동 반영됩니다.
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={themeColor} />
      ) : (
        <FlatList
          data={teachers}
          keyExtractor={item => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: TAB_BAR_H + 16 }}
          ListEmptyComponent={
            <View style={s.empty}>
              <LucideIcon name="users" size={32} color={C.textMuted} />
              <Text style={s.emptyTxt}>승인된 선생님이 없습니다</Text>
              <Text style={s.emptyDesc}>먼저 선생님 초대 후 승인해주세요.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={[s.card, item.is_admin_granted && s.cardAdmin]}>
              <View style={[s.avatar, { backgroundColor: item.is_admin_granted ? themeColor + "20" : C.brandSoft }]}>
                <Text style={[s.avatarTxt, { color: item.is_admin_granted ? themeColor : C.brandStrong }]}>
                  {item.name[0]}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={s.nameRow}>
                  <Text style={s.name}>{item.name}</Text>
                  <View style={[
                    s.roleBadge,
                    item.is_admin_granted
                      ? { backgroundColor: "#FFF7ED", borderColor: "#FED7AA" }
                      : { backgroundColor: "#EFF6FF", borderColor: "#BFDBFE" }
                  ]}>
                    {item.is_admin_granted && <LucideIcon name="shield" size={10} color="#C2410C" />}
                    <Text style={[
                      s.roleBadgeTxt,
                      { color: item.is_admin_granted ? "#C2410C" : "#1D4ED8" }
                    ]}>
                      {item.is_admin_granted ? "관리자" : "선생님"}
                    </Text>
                  </View>
                </View>
                {!!item.phone && <Text style={s.sub}>{item.phone}</Text>}
                {!!item.email && <Text style={s.sub}>{item.email}</Text>}
                {!!item.approved_at && (
                  <Text style={s.sub}>승인일 {fmtDate(item.approved_at)}</Text>
                )}
              </View>
              <Pressable
                style={({ pressed }) => [
                  s.grantBtn,
                  item.is_admin_granted
                    ? s.grantBtnRevoke
                    : { backgroundColor: C.primaryAction },
                  { opacity: pressed ? 0.8 : 1 },
                ]}
                onPress={() => setConfirmTarget(item)}
              >
                <LucideIcon
                  name={item.is_admin_granted ? "shield-off" : "shield"}
                  size={13}
                  color={item.is_admin_granted ? "#D96C6C" : "#fff"}
                />
                <Text style={[s.grantBtnTxt, item.is_admin_granted && { color: "#D96C6C" }]}>
                  {item.is_admin_granted ? "권한 회수" : "권한 부여"}
                </Text>
              </Pressable>
            </View>
          )}
        />
      )}

      {/* 확인 모달 — resultMsg가 있으면 표시하지 않음 (두 모달 동시 visible 방지) */}
      {confirmTarget !== null && resultMsg === null && (
        <Modal
          animationType="fade"
          transparent
          visible
          onRequestClose={() => !processing && setConfirmTarget(null)}
        >
          <View style={s.overlay}>
            <View style={s.dialog}>
              <View style={[s.dialogIcon, confirmTarget.is_admin_granted ? s.dialogIconRevoke : { backgroundColor: themeColor + "20" }]}>
                <LucideIcon
                  name={confirmTarget.is_admin_granted ? "shield-off" : "shield"}
                  size={24}
                  color={confirmTarget.is_admin_granted ? "#D96C6C" : themeColor}
                />
              </View>
              <Text style={s.dialogTitle}>
                {confirmTarget.is_admin_granted ? "관리자 권한 회수" : "관리자 권한 부여"}
              </Text>
              <Text style={s.dialogBody}>
                {confirmTarget.name} 선생님의 관리자 권한을{"\n"}
                {confirmTarget.is_admin_granted
                  ? "회수하시겠습니까?\n이후 관리자 기능에 접근할 수 없습니다."
                  : "부여하시겠습니까?\n선생님↔관리자 역할 전환이 가능해집니다."
                }
              </Text>
              <View style={s.dialogBtns}>
                <Pressable
                  style={[s.dialogBtn, s.dialogBtnCancel]}
                  onPress={() => setConfirmTarget(null)}
                  disabled={processing}
                >
                  <Text style={s.dialogBtnCancelTxt}>취소</Text>
                </Pressable>
                <Pressable
                  style={[
                    s.dialogBtn,
                    confirmTarget.is_admin_granted ? s.dialogBtnRevoke : { backgroundColor: C.primaryAction },
                  ]}
                  onPress={() => handleGrant(confirmTarget.id, !confirmTarget.is_admin_granted)}
                  disabled={processing}
                >
                  {processing
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={s.dialogBtnTxt}>
                        {confirmTarget.is_admin_granted ? "회수" : "부여"}
                      </Text>
                  }
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* 결과 안내 모달 — 배경 터치 / 뒤로가기 / 확인 버튼 모두 closeResultModal */}
      {resultMsg !== null && (
        <Modal
          animationType="fade"
          transparent
          visible
          onRequestClose={closeResultModal}
        >
          {/* 배경: 터치 시 닫힘 */}
          <Pressable style={s.overlay} onPress={closeResultModal}>
            {/* 다이얼로그 내부: 터치 전파 차단 */}
            <Pressable style={s.dialog} onPress={e => e.stopPropagation()}>
              <LucideIcon name="check-circle" size={28} color={C.brandStrong} style={{ alignSelf: "center", marginBottom: 8 }} />
              <Text style={[s.dialogTitle, { textAlign: "center" }]}>완료</Text>
              <Text style={[s.dialogBody, { textAlign: "center" }]}>{resultMsg}</Text>
              <Pressable
                style={[s.dialogBtn, { backgroundColor: C.primaryAction, alignSelf: "center", paddingHorizontal: 40 }]}
                onPress={closeResultModal}
              >
                <Text style={s.dialogBtnTxt}>확인</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:          { flex: 1, backgroundColor: "#FFFFFF" },
  infoBanner:    { flexDirection: "row", alignItems: "flex-start", gap: 8, margin: 16, marginBottom: 4, padding: 12, backgroundColor: C.brandSoft, borderRadius: 10, borderWidth: 1, borderColor: C.brandSoft },
  infoTxt:       { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", color: "#1E3A5F", lineHeight: 18 },
  empty:         { alignItems: "center", paddingVertical: 48, gap: 8 },
  emptyTxt:      { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  emptyDesc:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted },
  card:          { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", borderRadius: 14, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: C.border },
  cardAdmin:     { borderColor: "#A7F3D0" },
  avatar:        { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  avatarTxt:     { fontSize: 17, fontFamily: "Pretendard-Regular" },
  nameRow:       { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  name:          { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  roleBadge:    { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  roleBadgeTxt: { fontSize: 10, fontFamily: "Pretendard-Regular", fontWeight: "600" },
  sub:           { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 },
  grantBtn:      { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8 },
  grantBtnRevoke:{ backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FCA5A5" },
  grantBtnTxt:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#fff" },
  overlay:       { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 24 },
  dialog:        { backgroundColor: "#fff", borderRadius: 20, padding: 24, width: "100%", maxWidth: 360, gap: 12 },
  dialogIcon:    { width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 4 },
  dialogIconRevoke: { backgroundColor: "#FEF2F2" },
  dialogTitle:   { fontSize: 17, fontFamily: "Pretendard-Regular", color: C.text, textAlign: "center" },
  dialogBody:    { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 22, textAlign: "center" },
  dialogBtns:    { flexDirection: "row", gap: 8, marginTop: 4 },
  dialogBtn:     { flex: 1, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  dialogBtnCancel:   { backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB" },
  dialogBtnCancelTxt:{ fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  dialogBtnRevoke:   { backgroundColor: "#D96C6C" },
  dialogBtnTxt:  { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
});
