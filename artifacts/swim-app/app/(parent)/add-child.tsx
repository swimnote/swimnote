import React, { useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  Pressable, StyleSheet, Text, TextInput, View,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, UserPlus } from "lucide-react-native";
import Colors from "@/constants/colors";
import { API_BASE, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";

const ORANGE = "#F97316";

export default function AddChildScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { refresh } = useParent();
  const C = Colors.light;

  const [childName, setChildName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    const name = childName.trim();
    if (!name) {
      Alert.alert("이름 입력", "자녀 이름을 입력해주세요.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/parent/add-child`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ child_name: name }),
      });

      const data = await res.json();

      if (!res.ok) {
        Alert.alert("오류", data.error || "서버 오류가 발생했습니다.");
        return;
      }

      switch (data.status) {
        case "linked":
          await refresh();
          Alert.alert(
            "연결 완료",
            `${data.student?.name || name} 자녀가 연결됐어요!`,
            [{ text: "확인", onPress: () => router.back() }]
          );
          break;

        case "pending_created":
          Alert.alert(
            "등록 요청 접수",
            `${name} 자녀의 등록 요청이 접수됐어요.\n수영장 관리자가 확인 후 연결해드립니다.`,
            [{ text: "확인", onPress: () => router.back() }]
          );
          break;

        case "already_linked":
          Alert.alert("이미 연결됨", "이미 연결된 자녀입니다.");
          break;

        case "pending_already":
          Alert.alert(
            "요청 대기 중",
            `${name} 자녀의 등록 요청이 이미 접수되어 관리자 확인을 기다리고 있어요.`
          );
          break;

        default:
          Alert.alert("오류", "알 수 없는 응답입니다.");
      }
    } catch {
      Alert.alert("오류", "네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* 헤더 */}
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Pressable style={s.backBtn} onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={22} color={C.text} />
        </Pressable>
        <Text style={[s.headerTitle, { color: C.text }]}>우리 아이 추가</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={s.body}>
        {/* 아이콘 + 설명 */}
        <View style={s.iconWrap}>
          <View style={[s.iconCircle, { backgroundColor: ORANGE + "20" }]}>
            <UserPlus size={32} color={ORANGE} />
          </View>
        </View>

        <Text style={[s.desc, { color: C.textSecondary }]}>
          자녀 이름을 입력하면 수영장에 등록된{"\n"}
          정보와 자동으로 연결해드립니다.
        </Text>

        {/* 이름 입력 */}
        <View style={[s.inputWrap, { borderColor: C.border, backgroundColor: C.card }]}>
          <TextInput
            style={[s.input, { color: C.text }]}
            placeholder="자녀 이름 입력"
            placeholderTextColor={C.textSecondary}
            value={childName}
            onChangeText={setChildName}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
            autoFocus
          />
        </View>

        {/* 안내 텍스트 */}
        <Text style={[s.hint, { color: C.textSecondary }]}>
          수영장에 등록된 이름과 일치해야 연결됩니다.
        </Text>

        {/* 확인 버튼 */}
        <Pressable
          style={[s.submitBtn, { opacity: loading ? 0.7 : 1 }]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.submitBtnText}>연결하기</Text>
          }
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  body: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
    alignItems: "center",
  },
  iconWrap: {
    marginBottom: 20,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  desc: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    marginBottom: 32,
  },
  inputWrap: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 4,
    marginBottom: 10,
  },
  input: {
    fontSize: 17,
    paddingVertical: 14,
    textAlign: "center",
  },
  hint: {
    fontSize: 12,
    marginBottom: 32,
    textAlign: "center",
  },
  submitBtn: {
    width: "100%",
    backgroundColor: ORANGE,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  submitBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
});
