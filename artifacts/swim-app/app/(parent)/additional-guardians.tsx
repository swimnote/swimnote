import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;
const TEAL = "#2EC4B6";
const TEAL_BG = "#E6FAF8";
const NAVY = "#0F3460";

interface PhoneSlot {
  slot: number;
  phone: string | null;
  status: "empty" | "connected" | "pending";
  connected_name: string | null;
}

interface StudentGuardian {
  student_id: string;
  student_name: string;
  phones: PhoneSlot[];
}

export default function AdditionalGuardiansScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [students, setStudents] = useState<StudentGuardian[]>([]);

  const [modalVisible, setModalVisible] = useState(false);
  const [modalStudentId, setModalStudentId] = useState("");
  const [modalStudentName, setModalStudentName] = useState("");
  const [phoneInput, setPhoneInput] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest(token, "/parent/guardians");
      if (res.ok) {
        const data = await res.json();
        setStudents(data.students || []);
      }
    } catch { /* noop */ } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openAddModal = (studentId: string, studentName: string) => {
    setModalStudentId(studentId);
    setModalStudentName(studentName);
    setPhoneInput("");
    setModalVisible(true);
  };

  const submitAdd = async () => {
    const normPhone = phoneInput.replace(/[^0-9]/g, "");
    if (normPhone.length < 9) {
      Alert.alert("입력 오류", "올바른 전화번호를 입력해주세요."); return;
    }
    setSaving(true);
    try {
      const res = await apiRequest(token, "/parent/guardians", {
        method: "POST",
        body: JSON.stringify({ studentId: modalStudentId, phone: normPhone }),
      });
      const body = await res.json();
      if (res.ok) {
        setModalVisible(false);
        const msg = body.auto_linked
          ? "보호자 번호가 등록되었고 해당 보호자 앱과 자동 연결되었습니다."
          : "보호자 번호가 등록되었습니다. 해당 번호로 가입 시 자동 연결됩니다.";
        Alert.alert("등록 완료", msg);
        await load();
      } else {
        Alert.alert("오류", body.message || "등록에 실패했습니다.");
      }
    } catch {
      Alert.alert("오류", "네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (studentId: string, slot: PhoneSlot) => {
    if (slot.status === "connected") {
      Alert.alert("삭제 불가", "이미 앱에 연결된 보호자 번호는 삭제할 수 없습니다.\n관리자에게 문의해주세요."); return;
    }
    Alert.alert("보호자 번호 삭제", `${formatPhone(slot.phone)} 번호를 삭제하시겠습니까?`, [
      { text: "취소", style: "cancel" },
      {
        text: "삭제", style: "destructive",
        onPress: async () => {
          try {
            const res = await apiRequest(token, "/parent/guardians", {
              method: "DELETE",
              body: JSON.stringify({ studentId, slot: slot.slot }),
            });
            const body = await res.json();
            if (res.ok) {
              await load();
            } else {
              Alert.alert("오류", body.message || "삭제에 실패했습니다.");
            }
          } catch { Alert.alert("오류", "네트워크 오류가 발생했습니다."); }
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#F8FAFC" }}>
      <ParentScreenHeader
        title="추가 보호자 관리"
        onBack={() => router.back()}
        insets={insets}
      />

      {loading ? (
        <ActivityIndicator color={TEAL} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 16 }}>
          {/* 안내 */}
          <View style={{ backgroundColor: TEAL_BG, borderRadius: 12, padding: 14, gap: 8 }}>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <LucideIcon name="info" size={16} color={TEAL} />
              <Text style={{ fontSize: 13, color: "#0F766E", fontFamily: "Pretendard-SemiBold" }}>추가 보호자 연결 방법</Text>
            </View>
            <View style={{ gap: 6, paddingLeft: 2 }}>
              <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
                <Text style={{ fontSize: 13, color: "#0F766E", lineHeight: 20 }}>①</Text>
                <Text style={{ flex: 1, fontSize: 13, color: "#0F766E", lineHeight: 20 }}>
                  이 화면에서 추가 보호자의 <Text style={{ fontFamily: "Pretendard-SemiBold" }}>전화번호를 먼저 등록</Text>해주세요.
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
                <Text style={{ fontSize: 13, color: "#0F766E", lineHeight: 20 }}>②</Text>
                <Text style={{ flex: 1, fontSize: 13, color: "#0F766E", lineHeight: 20 }}>
                  추가 보호자가 등록된 번호로 SwimNote에 가입하면 <Text style={{ fontFamily: "Pretendard-SemiBold" }}>별도 승인 없이 자동으로 연결</Text>됩니다.
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
                <Text style={{ fontSize: 13, color: "#0F766E", lineHeight: 20 }}>③</Text>
                <Text style={{ flex: 1, fontSize: 13, color: "#0F766E", lineHeight: 20 }}>
                  최대 3개까지 추가할 수 있습니다.
                </Text>
              </View>
            </View>
          </View>

          {students.map(s => {
            const filledSlots = s.phones.filter(p => p.phone && p.slot > 1);
            const hasEmpty = s.phones.some(p => !p.phone && p.slot > 1);

            return (
              <View key={s.student_id} style={{ backgroundColor: "#fff", borderRadius: 14, padding: 16, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 }}>
                {/* 자녀 이름 */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: TEAL_BG, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 14, color: TEAL, fontFamily: "Pretendard-SemiBold" }}>{s.student_name[0]}</Text>
                  </View>
                  <Text style={{ fontSize: 16, color: NAVY, fontFamily: "Pretendard-SemiBold" }}>{s.student_name}</Text>
                </View>

                {/* 주 보호자 (slot 1) */}
                {s.phones.filter(p => p.slot === 1).map(p => (
                  <View key={1} style={[slotRow, { backgroundColor: "#F1F5F9", opacity: 0.85 }]}>
                    <View style={dotBadge("connected")}>
                      <LucideIcon name="shield-check" size={13} color="#2EC4B6" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={slotLabel}>주 보호자 (관리자 설정)</Text>
                      <Text style={slotPhone}>{p.phone ? formatPhone(p.phone) : "미등록"}</Text>
                    </View>
                  </View>
                ))}

                {/* 추가 보호자 슬롯 */}
                {filledSlots.map(p => (
                  <View key={p.slot} style={slotRow}>
                    <View style={dotBadge(p.status)}>
                      <LucideIcon
                        name={p.status === "connected" ? "link" : "clock"}
                        size={13}
                        color={p.status === "connected" ? "#2EC4B6" : "#F59E0B"}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={slotLabel}>
                        추가 보호자 {p.slot - 1}{" "}
                        <Text style={{ color: p.status === "connected" ? TEAL : "#F59E0B", fontSize: 11 }}>
                          ({p.status === "connected" ? "연결됨" : "대기중"})
                        </Text>
                      </Text>
                      <Text style={slotPhone}>{formatPhone(p.phone)}</Text>
                      {p.connected_name ? (
                        <Text style={{ fontSize: 11, color: "#64748B", marginTop: 1 }}>연결 계정: {p.connected_name}</Text>
                      ) : null}
                    </View>
                    <Pressable
                      style={({ pressed }) => [deleteBtn, { opacity: pressed ? 0.6 : 1 }]}
                      onPress={() => confirmDelete(s.student_id, p)}
                    >
                      <LucideIcon name="trash-2" size={14} color="#EF4444" />
                    </Pressable>
                  </View>
                ))}

                {/* 빈 슬롯 / 추가 버튼 */}
                {hasEmpty && (
                  <Pressable
                    style={({ pressed }) => [addBtn, { opacity: pressed ? 0.8 : 1 }]}
                    onPress={() => openAddModal(s.student_id, s.student_name)}
                  >
                    <LucideIcon name="plus" size={16} color={TEAL} />
                    <Text style={{ fontSize: 14, color: TEAL, fontFamily: "Pretendard-Medium" }}>보호자 번호 추가</Text>
                  </Pressable>
                )}

                {!hasEmpty && filledSlots.length >= 3 && (
                  <Text style={{ fontSize: 12, color: "#94A3B8", textAlign: "center", marginTop: 4 }}>
                    보호자 번호가 최대 개수(3개)에 도달했습니다
                  </Text>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* 전화번호 입력 모달 */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={{ flex: 1 }}>
          {/* 배경 딤 — 절대 포지션으로 뒤에 깔림 */}
          <Pressable
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)" }}
            onPress={() => setModalVisible(false)}
          />
          {/* KAV는 flex-end로 시트를 아래 붙이고, 키보드가 열리면 위로 밀어올림 */}
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={{ flex: 1, justifyContent: "flex-end" }}
          >
            <View style={sheet}>
              <Text style={sheetTitle}>{modalStudentName} — 보호자 추가</Text>
              <Text style={sheetDesc}>
                추가 보호자의 전화번호를 입력해주세요.{"\n"}
                입력한 번호로 SwimNote에 가입하면 자동으로 연결됩니다.
              </Text>
              <TextInput
                style={phoneInputStyle}
                placeholder="010-0000-0000"
                placeholderTextColor="#94A3B8"
                keyboardType="phone-pad"
                value={phoneInput}
                onChangeText={setPhoneInput}
                autoFocus
              />
              <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
                <Pressable
                  style={({ pressed }) => [cancelBtn, { opacity: pressed ? 0.7 : 1 }]}
                  onPress={() => setModalVisible(false)}
                >
                  <Text style={{ fontSize: 15, color: "#64748B", fontFamily: "Pretendard-Medium" }}>취소</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [confirmBtn, { opacity: pressed ? 0.85 : 1 }]}
                  onPress={submitAdd}
                  disabled={saving}
                >
                  {saving
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={{ fontSize: 15, color: "#fff", fontFamily: "Pretendard-SemiBold" }}>등록하기</Text>
                  }
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  const d = phone.replace(/[^0-9]/g, "");
  if (d.length === 11) return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
  return phone;
}

function dotBadge(status: string) {
  const bg = status === "connected" ? "#E6FAF8" : status === "pending" ? "#FFF8E1" : "#F1F5F9";
  return {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: bg, alignItems: "center" as const, justifyContent: "center" as const,
    marginRight: 10,
  };
}

const slotRow: object = {
  flexDirection: "row", alignItems: "center",
  paddingVertical: 10, paddingHorizontal: 10,
  borderRadius: 10, backgroundColor: "#F8FAFC",
  marginBottom: 6,
};

const slotLabel: object = { fontSize: 11, color: "#64748B", fontFamily: "Pretendard-Regular" };
const slotPhone: object = { fontSize: 14, color: "#0F172A", fontFamily: "Pretendard-SemiBold", marginTop: 1 };

const deleteBtn: object = {
  padding: 8, borderRadius: 8, backgroundColor: "#FEE2E2",
};

const addBtn: object = {
  flexDirection: "row", alignItems: "center", justifyContent: "center",
  gap: 6, paddingVertical: 10,
  borderRadius: 10, borderWidth: 1.5, borderColor: "#2EC4B6",
  borderStyle: "dashed", marginTop: 4,
};

const overlay: object = {
  position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: "rgba(0,0,0,0.35)",
};

const sheet: object = {
  backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
  padding: 24, paddingBottom: 40, gap: 12,
};

const sheetTitle: object = { fontSize: 17, color: "#0F172A", fontFamily: "Pretendard-SemiBold" };
const sheetDesc: object = { fontSize: 13, color: "#64748B", fontFamily: "Pretendard-Regular" };

const phoneInputStyle: object = {
  borderWidth: 1.5, borderColor: "#E2E8F0", borderRadius: 10,
  padding: 14, fontSize: 16, color: "#0F172A",
  fontFamily: "Pretendard-Regular", backgroundColor: "#F8FAFC",
};

const cancelBtn: object = {
  flex: 1, paddingVertical: 13, borderRadius: 10,
  backgroundColor: "#F1F5F9", alignItems: "center",
};
const confirmBtn: object = {
  flex: 2, paddingVertical: 13, borderRadius: 10,
  backgroundColor: "#2EC4B6", alignItems: "center",
};
