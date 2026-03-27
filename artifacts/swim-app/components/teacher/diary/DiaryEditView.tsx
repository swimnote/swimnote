import { Feather } from "@expo/vector-icons";
import React, { MutableRefObject } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import Colors from "@/constants/colors";
import SentencePicker from "@/components/teacher/SentencePicker";
import { DiaryEntry, ExistingNote, StudentNote, StudentOption } from "./types";
import { TeacherClassGroup } from "@/components/teacher/types";

const C = Colors.light;

export default function DiaryEditView({
  group, themeColor,
  editDiary, editContent, setEditContent,
  editNotes, editNewNotes,
  editAddStudent, setEditAddStudent,
  editAddInput, setEditAddInput,
  editSaving, editError, setEditError, editLoading,
  editPickerFor, setEditPickerFor,
  editCursorRef,
  classStudents,
  onSave, onBack,
  onUpdateNoteContent, onMarkNoteDeleted,
  onEditAddNote, onRemoveNewNote,
  insertAtCursor,
}: {
  group: TeacherClassGroup; themeColor: string;
  editDiary: DiaryEntry | null;
  editContent: string; setEditContent: (v: string) => void;
  editNotes: ExistingNote[]; editNewNotes: StudentNote[];
  editAddStudent: StudentOption | null; setEditAddStudent: (v: StudentOption | null) => void;
  editAddInput: string; setEditAddInput: (v: string) => void;
  editSaving: boolean; editError: string | null; setEditError: (v: string | null) => void;
  editLoading: boolean;
  editPickerFor: "common" | "note" | null;
  setEditPickerFor: (v: "common" | "note" | null) => void;
  editCursorRef: MutableRefObject<number>;
  classStudents: StudentOption[];
  onSave: () => void; onBack: () => void;
  onUpdateNoteContent: (noteId: string, content: string) => void;
  onMarkNoteDeleted: (noteId: string) => void;
  onEditAddNote: () => void;
  onRemoveNewNote: (idx: number) => void;
  insertAtCursor: (current: string, insert: string, cursorPos: number, setter: (v: string) => void) => void;
}) {
  const activeNotes = editNotes.filter(n => !n._deleted);
  const usedStudentIds = new Set([
    ...activeNotes.map(n => n.student_id),
    ...editNewNotes.map(n => n.student_id),
  ]);

  if (editLoading) {
    return <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />;
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        <View style={[s.infoCard, { backgroundColor: themeColor + "12", borderColor: themeColor + "30" }]}>
          <View style={s.infoCardRow}>
            <Feather name="layers" size={14} color={themeColor} />
            <Text style={[s.infoCardText, { color: themeColor }]}>{group.name}</Text>
          </View>
          <View style={s.infoCardRow}>
            <Feather name="calendar" size={14} color={themeColor} />
            <Text style={[s.infoCardText, { color: themeColor }]}>{editDiary?.lesson_date} · {group.schedule_time}</Text>
          </View>
          <View style={s.infoCardRow}>
            <Feather name="user" size={14} color={themeColor} />
            <Text style={[s.infoCardText, { color: themeColor }]}>{editDiary?.teacher_name} 선생님</Text>
          </View>
        </View>

        <View style={[s.card, { backgroundColor: C.card }]}>
          <View style={s.cardHeader}>
            <View style={[s.cardIcon, { backgroundColor: themeColor + "20" }]}>
              <Feather name="book-open" size={15} color={themeColor} />
            </View>
            <Text style={[s.cardTitle, { color: C.text }]}>반 공통 일지</Text>
            <Text style={s.cardSub}>모든 학생에게 공통으로 보이는 내용</Text>
          </View>
          <TextInput style={[s.textarea, { borderColor: C.border, color: C.text }]}
            value={editContent}
            onChangeText={t => { setEditContent(t); if (editError) setEditError(null); }}
            onSelectionChange={e => { editCursorRef.current = e.nativeEvent.selection.start; }}
            placeholder="수업 내용을 입력하세요"
            placeholderTextColor={C.textMuted} multiline numberOfLines={6} textAlignVertical="top" />
          <View style={s.textareaFooter}>
            <Text style={s.charCount}>{editContent.length}자</Text>
            <TouchableOpacity style={s.sentencePickBtn} onPress={() => setEditPickerFor("common")} activeOpacity={0.7}>
              <Feather name="book-open" size={13} color={C.tint} />
              <Text style={s.sentencePickBtnText}>문장 불러오기</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={[s.card, { backgroundColor: C.card }]}>
          <View style={s.cardHeader}>
            <View style={[s.cardIcon, { backgroundColor: "#8B5CF620" }]}>
              <Feather name="users" size={15} color="#8B5CF6" />
            </View>
            <Text style={[s.cardTitle, { color: C.text }]}>학생별 추가 일지</Text>
            <Text style={s.cardSub}>개별 코멘트 수정</Text>
          </View>

          {activeNotes.map(note => (
            <View key={note.id} style={[s.editNoteItem, { backgroundColor: "#EEDDF5", borderColor: "#C4B5FD" }]}>
              <View style={s.editNoteHeader}>
                <Text style={s.noteName}>{note.student_name}</Text>
                <Pressable onPress={() => onMarkNoteDeleted(note.id)}>
                  <Feather name="trash-2" size={15} color={C.error} />
                </Pressable>
              </View>
              <TextInput style={[s.noteTextarea, { borderColor: "#C4B5FD", color: C.text }]}
                value={note.note_content}
                onChangeText={t => onUpdateNoteContent(note.id, t)}
                multiline numberOfLines={3} textAlignVertical="top"
                placeholder="개별 코멘트를 입력하세요" placeholderTextColor={C.textMuted} />
            </View>
          ))}

          {editNewNotes.map((note, idx) => (
            <View key={idx} style={[s.editNoteItem, { backgroundColor: "#DFF3EC", borderColor: "#6EE7B7" }]}>
              <View style={s.editNoteHeader}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <View style={[s.statusBadge, { backgroundColor: "#E6FFFA" }]}>
                    <Text style={[s.statusBadgeText, { color: "#2EC4B6" }]}>신규</Text>
                  </View>
                  <Text style={[s.noteName, { color: "#2EC4B6" }]}>{note.student_name}</Text>
                </View>
                <Pressable onPress={() => onRemoveNewNote(idx)}>
                  <Feather name="x-circle" size={15} color={C.error} />
                </Pressable>
              </View>
              <Text style={[s.noteContent, { color: C.text }]}>{note.note_content}</Text>
            </View>
          ))}

          {classStudents.length === 0 ? (
            <View style={[s.emptyStudents, { backgroundColor: C.background, borderColor: C.border }]}>
              <Feather name="users" size={16} color={C.textMuted} />
              <Text style={[s.emptyStudentsText, { color: C.textMuted }]}>이 수업에 배정된 학생이 없습니다</Text>
            </View>
          ) : (
            <>
              {classStudents.filter(st => !usedStudentIds.has(st.id)).length > 0 && (
                <View style={{ gap: 6 }}>
                  <Text style={[s.sectionLabel, { color: C.textSecondary }]}>학생 추가</Text>
                  {classStudents.filter(st => !usedStudentIds.has(st.id)).map(st => (
                    <Pressable key={st.id}
                      style={[s.studentChip, { backgroundColor: C.background, borderColor: C.border },
                        editAddStudent?.id === st.id && { borderColor: "#8B5CF6", backgroundColor: "#EEDDF5" }]}
                      onPress={() => { if (editAddStudent?.id === st.id) { setEditAddStudent(null); setEditAddInput(""); } else { setEditAddStudent(st); setEditAddInput(""); } }}>
                      <Text style={[s.studentChipText, { color: editAddStudent?.id === st.id ? "#8B5CF6" : C.text }]}>{st.name}</Text>
                      <Feather name="plus-circle" size={15} color={editAddStudent?.id === st.id ? "#8B5CF6" : C.textMuted} />
                    </Pressable>
                  ))}
                </View>
              )}
              {editAddStudent && (
                <View style={[s.noteInput, { backgroundColor: "#EEDDF5", borderColor: "#8B5CF6" }]}>
                  <Text style={[s.noteName, { color: "#8B5CF6", marginBottom: 6 }]}>{editAddStudent.name} 추가 일지</Text>
                  <TextInput style={[s.noteTextarea, { borderColor: "#8B5CF6", color: C.text }]}
                    value={editAddInput} onChangeText={setEditAddInput}
                    placeholder="이 학생에게 전달할 추가 내용을 입력하세요"
                    placeholderTextColor={C.textMuted} multiline numberOfLines={3} textAlignVertical="top" autoFocus />
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                    <Pressable style={[s.noteBtn, { borderColor: C.border }]} onPress={() => { setEditAddStudent(null); setEditAddInput(""); }}>
                      <Text style={{ color: C.textSecondary, fontFamily: "Pretendard-SemiBold", fontSize: 13 }}>취소</Text>
                    </Pressable>
                    <Pressable style={[s.noteBtn, { backgroundColor: "#8B5CF6", borderColor: "#8B5CF6", flex: 1 }]} onPress={onEditAddNote} disabled={!editAddInput.trim()}>
                      <Text style={{ color: "#fff", fontFamily: "Pretendard-SemiBold", fontSize: 13 }}>추가</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </>
          )}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      <View style={s.footer}>
        {editError && (
          <View style={[s.inlineError, { backgroundColor: "#F9DEDA" }]}>
            <Feather name="alert-circle" size={13} color={C.error} />
            <Text style={[s.inlineErrorText, { color: C.error }]}>{editError}</Text>
          </View>
        )}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable style={[s.cancelBtnFt, { borderColor: C.border }]} onPress={onBack}>
            <Text style={[s.cancelBtnFtText, { color: C.textSecondary }]}>취소</Text>
          </Pressable>
          <Pressable style={[s.saveBtn, { backgroundColor: themeColor, opacity: editSaving ? 0.5 : 1, flex: 2 }]}
            onPress={onSave} disabled={editSaving}>
            {editSaving ? <ActivityIndicator color="#fff" size="small" /> : <><Feather name="save" size={16} color="#fff" /><Text style={s.saveBtnText}>저장</Text></>}
          </Pressable>
        </View>
      </View>

      <SentencePicker
        visible={editPickerFor !== null}
        onClose={() => setEditPickerFor(null)}
        onInsert={text => {
          if (editPickerFor === "common") {
            insertAtCursor(editContent, text, editCursorRef.current, setEditContent);
            editCursorRef.current = editCursorRef.current + text.length;
          }
          setEditPickerFor(null);
        }}
      />
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  form:          { padding: 14, gap: 14, paddingBottom: 80 },
  infoCard:      { borderRadius: 14, borderWidth: 1.5, padding: 14, gap: 8 },
  infoCardRow:   { flexDirection: "row", alignItems: "center", gap: 8 },
  infoCardText:  { fontSize: 13, fontFamily: "Pretendard-SemiBold" },
  card:          { borderRadius: 16, padding: 14, gap: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  cardHeader:    { flexDirection: "row", alignItems: "center", gap: 8 },
  cardIcon:      { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  cardTitle:     { fontSize: 14, fontFamily: "Pretendard-Bold", flex: 1 },
  cardSub:       { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#9CA3AF" },
  textarea:      { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 22, minHeight: 140, textAlignVertical: "top", backgroundColor: "#fff" },
  textareaFooter:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  charCount:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#9CA3AF" },
  sentencePickBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1.5, borderColor: Colors.light.tintLight, backgroundColor: "#F0F5FF" },
  sentencePickBtnText: { fontSize: 12, fontFamily: "Pretendard-SemiBold", color: Colors.light.tint },
  emptyStudents: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  emptyStudentsText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  sectionLabel:  { fontSize: 12, fontFamily: "Pretendard-SemiBold" },
  studentChip:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 10, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 8 },
  studentChipText: { fontSize: 13, fontFamily: "Pretendard-Medium", flex: 1 },
  editNoteItem:  { borderRadius: 12, borderWidth: 1.5, padding: 12, gap: 8 },
  editNoteHeader:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  noteName:      { fontSize: 12, fontFamily: "Pretendard-Bold", color: "#7C3AED" },
  noteContent:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#111827", lineHeight: 18 },
  noteInput:     { borderRadius: 12, borderWidth: 1.5, padding: 12, gap: 4 },
  noteTextarea:  { borderWidth: 1.5, borderRadius: 10, padding: 10, fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 20, minHeight: 80, textAlignVertical: "top", backgroundColor: "#fff" },
  noteBtn:       { flex: 1, height: 38, borderRadius: 10, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  statusBadge:   { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  statusBadgeText: { fontSize: 11, fontFamily: "Pretendard-SemiBold" },
  footer:        { gap: 8, padding: 12, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  cancelBtnFt:   { flex: 1, height: 50, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  cancelBtnFtText: { fontSize: 14, fontFamily: "Pretendard-SemiBold" },
  saveBtn:       { flexDirection: "row", height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", gap: 8 },
  saveBtnText:   { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Bold" },
  inlineError:   { flexDirection: "row", alignItems: "center", gap: 6, padding: 10, borderRadius: 10 },
  inlineErrorText: { flex: 1, fontSize: 12, fontFamily: "Pretendard-Medium", lineHeight: 17 },
});
