import { Feather } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable,
  RefreshControl, StyleSheet, Text, View,
} from "react-native";
import Colors from "@/constants/colors";
import { DiaryEntry } from "./types";

const C = Colors.light;

export default function DiaryHistoryList({
  diaries, diaryLoading, themeColor,
  userId, refreshing,
  deleteTarget, deleteLoading, deleteError,
  onRefresh, onOpenEdit, onDelete, onDeleteConfirm, onDeleteCancel,
}: {
  diaries: DiaryEntry[];
  diaryLoading: boolean;
  themeColor: string;
  userId?: string;
  refreshing: boolean;
  deleteTarget: DiaryEntry | null;
  deleteLoading: boolean;
  deleteError: string | null;
  onRefresh: () => void;
  onOpenEdit: (item: DiaryEntry) => void;
  onDelete: (item: DiaryEntry) => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
}) {
  return (
    <>
      {diaryLoading ? (
        <ActivityIndicator color={themeColor} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={diaries}
          keyExtractor={i => i.id}
          contentContainerStyle={s.diaryList}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View style={s.emptyBox}>
              <Feather name="book-open" size={32} color={C.textMuted} />
              <Text style={s.emptyText}>작성된 일지가 없습니다</Text>
            </View>
          }
          renderItem={({ item }) => {
            const isMine = item.teacher_id === userId;
            return (
              <Pressable
                style={({ pressed }) => [s.diaryCard, { backgroundColor: C.card, opacity: pressed && isMine ? 0.88 : 1 }, isMine && s.diaryCardEditable]}
                onPress={() => { if (isMine) onOpenEdit(item); }}>
                <View style={s.badgeRow}>
                  {item.is_edited && (
                    <View style={[s.statusBadge, { backgroundColor: "#FFF1BF" }]}>
                      <Text style={[s.statusBadgeText, { color: "#92400E" }]}>수정됨</Text>
                    </View>
                  )}
                  {item.note_count && Number(item.note_count) > 0 && (
                    <View style={[s.statusBadge, { backgroundColor: "#EEDDF5" }]}>
                      <Feather name="user" size={10} color="#7C3AED" />
                      <Text style={[s.statusBadgeText, { color: "#7C3AED" }]}>개별 {item.note_count}명</Text>
                    </View>
                  )}
                  {isMine && (
                    <View style={[s.statusBadge, { backgroundColor: "#E6FFFA", marginLeft: "auto" }]}>
                      <Feather name="edit-2" size={10} color="#4EA7D8" />
                      <Text style={[s.statusBadgeText, { color: "#4EA7D8" }]}>탭하여 수정</Text>
                    </View>
                  )}
                </View>
                <View style={s.diaryCardHeader}>
                  <View>
                    <Text style={[s.diaryCardDate, { color: C.text }]}>{item.lesson_date}</Text>
                    <Text style={[s.diaryTeacher, { color: C.textMuted }]}>{item.teacher_name} 선생님</Text>
                  </View>
                  {isMine && (
                    <Pressable style={[s.iconBtn, { backgroundColor: "#FEF2F2" }]}
                      onPress={e => { e.stopPropagation?.(); onDelete(item); }}>
                      <Feather name="trash-2" size={13} color={C.error} />
                    </Pressable>
                  )}
                </View>
                <Text style={[s.diaryContent, { color: C.textSecondary }]} numberOfLines={3}>
                  {item.common_content}
                </Text>
              </Pressable>
            );
          }}
        />
      )}

      <Modal visible={!!deleteTarget} transparent animationType="fade" onRequestClose={onDeleteCancel}>
        <View style={s.delOverlay}>
          <View style={[s.delSheet, { backgroundColor: C.card }]}>
            <View style={[s.delIconWrap, { backgroundColor: "#F9DEDA" }]}>
              <Feather name="trash-2" size={26} color={C.error} />
            </View>
            <Text style={[s.delTitle, { color: C.text }]}>일지 삭제</Text>
            <Text style={[s.delDesc, { color: C.textSecondary }]}>
              이 일지를 삭제하시겠습니까?{"\n"}삭제된 일지는 관리자만 확인할 수 있습니다.
            </Text>
            {deleteError && (
              <View style={[s.inlineError, { backgroundColor: "#F9DEDA" }]}>
                <Feather name="alert-circle" size={13} color={C.error} />
                <Text style={[s.inlineErrorText, { color: C.error }]}>{deleteError}</Text>
              </View>
            )}
            <View style={{ flexDirection: "row", gap: 10, width: "100%" }}>
              <Pressable style={[s.delBtn, { borderColor: C.border, backgroundColor: C.background, flex: 1 }]}
                onPress={onDeleteCancel} disabled={deleteLoading}>
                <Text style={{ color: C.textSecondary, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>취소</Text>
              </Pressable>
              <Pressable style={[s.delBtn, { backgroundColor: C.error, flex: 1, opacity: deleteLoading ? 0.6 : 1 }]}
                onPress={onDeleteConfirm} disabled={deleteLoading}>
                {deleteLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 14 }}>삭제</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  diaryList:     { padding: 12, gap: 10, paddingBottom: 120 },
  diaryCard:     { borderRadius: 14, padding: 14, gap: 8 },
  diaryCardEditable: { borderWidth: 1.5, borderColor: "#E6FFFA" },
  badgeRow:      { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  statusBadge:   { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  statusBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  diaryCardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  diaryCardDate: { fontSize: 15, fontFamily: "Inter_700Bold" },
  diaryTeacher:  { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  diaryContent:  { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  iconBtn:       { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  emptyBox:      { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyText:     { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  delOverlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: 24 },
  delSheet:      { width: "100%", borderRadius: 22, padding: 24, alignItems: "center", gap: 14 },
  delIconWrap:   { width: 64, height: 64, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  delTitle:      { fontSize: 18, fontFamily: "Inter_700Bold" },
  delDesc:       { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  delBtn:        { height: 48, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  inlineError:   { flexDirection: "row", alignItems: "center", gap: 6, padding: 10, borderRadius: 10 },
  inlineErrorText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 17 },
});
