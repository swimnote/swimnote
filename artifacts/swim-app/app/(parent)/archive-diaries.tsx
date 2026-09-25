/**
 * (parent)/archive-diaries.tsx — 지난 수강 기록
 *
 * 관리자가 Archive를 현재 자녀와 연결한 경우에만 표시.
 * read-only. 사진/영상 없음. 현재 feed와 완전 분리.
 */
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;

interface ArchiveGroup {
  link_id: string;
  archive_member_id: string;
  student_name: string;
  withdrawn_at: string;
  last_class_name?: string | null;
  linked_at: string;
  diaries: ArchiveDiary[];
}

interface ArchiveDiary {
  id: string;
  lesson_date: string;
  former_class_name?: string | null;
  former_teacher_name?: string | null;
  common_content?: string | null;
  student_note?: string | null;
  is_makeup_diary: boolean;
}

function fmtDate(d?: string | null) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
}

export default function ArchiveDiariesScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

  const [groups, setGroups] = useState<ArchiveGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest(token, `/parent/students/${id}/archive-diaries`);
      if (res.ok) {
        const data: ArchiveGroup[] = await res.json();
        setGroups(data);
        // 첫 번째 그룹 기본 펼침
        if (data.length > 0) {
          setExpanded({ [data[0].archive_member_id]: true });
        }
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [id, token]);

  useEffect(() => { load(); }, [load]);

  const toggleGroup = (archiveId: string) => {
    setExpanded(prev => ({ ...prev, [archiveId]: !prev[archiveId] }));
  };

  const renderDiary = (diary: ArchiveDiary) => (
    <View key={diary.id} style={styles.diaryCard}>
      <View style={styles.diaryHeader}>
        <Text style={styles.diaryDate}>{diary.lesson_date.replace(/-/g, ".")}</Text>
        {diary.is_makeup_diary && (
          <View style={styles.makeupBadge}><Text style={styles.makeupText}>보강</Text></View>
        )}
      </View>
      {!!diary.former_class_name && (
        <Text style={styles.diaryMeta}>{diary.former_class_name} · {diary.former_teacher_name ?? "-"} 선생님</Text>
      )}
      {!!diary.common_content && (
        <Text style={styles.diaryContent}>{diary.common_content}</Text>
      )}
      {!!diary.student_note && (
        <View style={styles.noteBox}>
          <Text style={styles.noteLabel}>개별 피드백</Text>
          <Text style={styles.noteContent}>{diary.student_note}</Text>
        </View>
      )}
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.root, { paddingBottom: insets.bottom }]}>
        <SubScreenHeader title="지난 수강 기록" onBack={() => {}} />
        <View style={styles.center}><ActivityIndicator color={C.primary} /></View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom }]}>
      <SubScreenHeader title="지난 수강 기록" onBack={() => {}} />
      {groups.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>연결된 지난 수강 기록이 없습니다.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          {groups.map(group => (
            <View key={group.archive_member_id} style={styles.group}>
              <Pressable style={styles.groupHeader} onPress={() => toggleGroup(group.archive_member_id)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.groupTitle}>
                    {group.last_class_name ? `${group.last_class_name} · ` : ""}
                    {fmtDate(group.withdrawn_at)} 퇴원
                  </Text>
                  <Text style={styles.groupSub}>{group.diaries.length}건의 수업일지</Text>
                </View>
                <Text style={styles.chevron}>{expanded[group.archive_member_id] ? "▲" : "▼"}</Text>
              </Pressable>

              {expanded[group.archive_member_id] && (
                <View style={styles.groupBody}>
                  {group.diaries.length === 0 ? (
                    <Text style={styles.emptyText}>저장된 수업일지가 없습니다.</Text>
                  ) : (
                    group.diaries.map(renderDiary)
                  )}
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  emptyText: { fontSize: 14, color: C.subtext, textAlign: "center" },
  group: {
    backgroundColor: C.card, borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, marginBottom: 12, overflow: "hidden",
  },
  groupHeader: {
    flexDirection: "row", alignItems: "center", padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border,
  },
  groupTitle: { fontSize: 14, fontWeight: "700", color: C.text },
  groupSub: { fontSize: 12, color: C.subtext, marginTop: 2 },
  chevron: { fontSize: 12, color: C.subtext },
  groupBody: { padding: 12 },
  diaryCard: {
    backgroundColor: "#F8F9FA", borderRadius: 8, padding: 12, marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth, borderColor: C.border,
  },
  diaryHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  diaryDate: { fontSize: 13, fontWeight: "600", color: C.text },
  makeupBadge: { backgroundColor: "#EEF2FF", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  makeupText: { fontSize: 10, color: "#4F46E5", fontWeight: "600" },
  diaryMeta: { fontSize: 12, color: C.subtext, marginBottom: 4 },
  diaryContent: { fontSize: 13, color: C.text, lineHeight: 20 },
  noteBox: { marginTop: 8, backgroundColor: "#FFF7ED", borderRadius: 6, padding: 8 },
  noteLabel: { fontSize: 11, color: "#92400E", fontWeight: "600", marginBottom: 2 },
  noteContent: { fontSize: 13, color: C.text, lineHeight: 19 },
});
