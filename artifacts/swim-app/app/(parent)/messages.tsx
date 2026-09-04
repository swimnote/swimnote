/**
 * 학부모 쪽지함 — 댓글 시스템으로 이전 완료
 *
 * diaryId 파라미터가 있으면 diary-comments 화면으로 즉시 리다이렉트.
 * 직접 접근 시 안내 화면 표시.
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";

const C = Colors.light;

export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const { diaryId, diaryDate, teacherName, studentId, studentName } = useLocalSearchParams<{
    diaryId?: string; diaryDate?: string; teacherName?: string;
    studentId?: string; studentName?: string;
  }>();

  useEffect(() => {
    if (diaryId) {
      router.replace({
        pathname: "/(parent)/diary-comments" as any,
        params: { diaryId, diaryDate, teacherName, studentId, studentName },
      });
    }
  }, [diaryId]);

  if (diaryId) return null;

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <ParentScreenHeader title="쪽지함" />
      <View style={[s.body, { paddingBottom: insets.bottom + 24 }]}>
        <View style={[s.iconWrap, { backgroundColor: C.brandMist }]}>
          <LucideIcon name="message-circle" size={36} color={C.brandStrong} />
        </View>
        <Text style={[s.title, { color: C.text }]}>쪽지함이 댓글로 바뀌었어요</Text>
        <Text style={[s.desc, { color: C.textSecondary }]}>
          수업일지 화면에서{"\n"}선생님께 댓글을 남길 수 있습니다
        </Text>
        <Pressable
          style={[s.btn, { backgroundColor: C.primaryAction }]}
          onPress={() => router.replace("/(parent)/diary" as any)}
        >
          <LucideIcon name="book-open" size={16} color="#fff" />
          <Text style={s.btnText}>수업일지 보러가기</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  body: {
    flex: 1, alignItems: "center", justifyContent: "center", gap: 14, paddingHorizontal: 32,
  },
  iconWrap: { width: 80, height: 80, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  title: { fontSize: 20, fontFamily: "Pretendard-Regular", textAlign: "center" },
  desc: { fontSize: 14, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 22 },
  btn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 24, paddingVertical: 13, borderRadius: 14, marginTop: 8,
  },
  btnText: { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" },
});
