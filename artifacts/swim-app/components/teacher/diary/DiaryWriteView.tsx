import { Feather } from "@expo/vector-icons";
import React, { MutableRefObject } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import Colors from "@/constants/colors";
import SentencePicker from "@/components/teacher/SentencePicker";
import { DiaryTemplate, StudentNote, StudentOption, UploadedMedia } from "./types";
import { TeacherClassGroup } from "@/components/teacher/types";

const C = Colors.light;

export default function DiaryWriteView({
  group, targetDate, themeColor, myDiaryExists,
  templates, showTemplates, setShowTemplates,
  commonContent, setCommonContent,
  classStudents,
  studentNotes,
  addNoteStudent, setAddNoteStudent,
  noteInput, setNoteInput,
  saving, formError, saveMsg,
  groupMedia,
  studentMedia,
  mediaUploading,
  showPickerFor, setShowPickerFor,
  commonCursorRef, noteCursorRef,
  onSave, onBack,
  onUploadGroupMedia, onUploadStudentMedia,
  onAddNote, onRemoveNote,
  insertAtCursor,
}: {
  group: TeacherClassGroup; targetDate: string; themeColor: string; myDiaryExists: boolean;
  templates: DiaryTemplate[]; showTemplates: boolean; setShowTemplates: (v: boolean) => void;
  commonContent: string; setCommonContent: (v: string) => void;
  classStudents: StudentOption[];
  studentNotes: StudentNote[];
  addNoteStudent: StudentOption | null; setAddNoteStudent: (v: StudentOption | null) => void;
  noteInput: string; setNoteInput: (v: string) => void;
  saving: boolean;
  formError: string | null;
  saveMsg: { type: "success" | "error"; text: string } | null;
  groupMedia: UploadedMedia[];
  studentMedia: Record<string, UploadedMedia[]>;
  mediaUploading: string | null;
  showPickerFor: "common" | "note" | "editCommon" | "editNote" | null;
  setShowPickerFor: (v: "common" | "note" | "editCommon" | "editNote" | null) => void;
  commonCursorRef: MutableRefObject<number>;
  noteCursorRef: MutableRefObject<number>;
  onSave: () => void;
  onBack: () => void;
  onUploadGroupMedia: (kind: "photo" | "video") => void;
  onUploadStudentMedia: (student: StudentOption, kind: "photo" | "video") => void;
  onAddNote: () => void;
  onRemoveNote: (studentId: string) => void;
  insertAtCursor: (current: string, insert: string, cursorPos: number, setter: (v: string) => void) => void;
}) {
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        {myDiaryExists && (
          <View style={[s.infoBox, { backgroundColor: "#FFF1BF" }]}>
            <Feather name="alert-circle" size={13} color="#D97706" />
            <Text style={s.infoText}>오늘 이미 일지가 작성되어 있습니다. 수정은 "지난 일지"에서 할 수 있습니다.</Text>
          </View>
        )}

        <View style={[s.card, { backgroundColor: C.card }]}>
          <View style={s.cardHeader}>
            <View style={[s.cardIcon, { backgroundColor: themeColor + "20" }]}>
              <Feather name="book-open" size={15} color={themeColor} />
            </View>
            <Text style={[s.cardTitle, { color: C.text }]}>반 공통 일지</Text>
            <Text style={s.cardSub}>모든 학생에게 공통으로 보이는 내용</Text>
          </View>

          {templates.length > 0 && (
            <Pressable style={[s.templateBtn, { borderColor: themeColor }]} onPress={() => setShowTemplates(!showTemplates)}>
              <Feather name="zap" size={13} color={themeColor} />
              <Text style={[s.templateBtnText, { color: themeColor }]}>템플릿 선택</Text>
              <Feather name={showTemplates ? "chevron-up" : "chevron-down"} size={13} color={themeColor} />
            </Pressable>
          )}
          {showTemplates && (
            <View style={s.templateList}>
              {templates.map(t => (
                <Pressable key={t.id} style={[s.templateItem, { backgroundColor: C.background }]} onPress={() => {
                  setCommonContent(commonContent.trim() ? `${commonContent.trim()}\n${t.template_text}` : t.template_text);
                  setShowTemplates(false);
                }}>
                  <Text style={[s.templateText, { color: C.text }]} numberOfLines={2}>{t.template_text}</Text>
                  {t.category !== "general" && <Text style={[s.templateCategory, { color: themeColor }]}>{t.category}</Text>}
                </Pressable>
              ))}
            </View>
          )}

          <TextInput style={[s.textarea, { borderColor: C.border, color: C.text }]}
            value={commonContent} onChangeText={setCommonContent}
            onSelectionChange={e => { commonCursorRef.current = e.nativeEvent.selection.start; }}
            placeholder="오늘 수업 내용을 입력하세요.\n(모든 학생 학부모에게 공통으로 노출됩니다)"
            placeholderTextColor={C.textMuted} multiline numberOfLines={6} textAlignVertical="top" />
          <View style={s.textareaFooter}>
            <Text style={s.charCount}>{commonContent.length}자</Text>
            <TouchableOpacity style={s.sentencePickBtn} onPress={() => setShowPickerFor("common")} activeOpacity={0.7}>
              <Feather name="book-open" size={13} color={C.tint} />
              <Text style={s.sentencePickBtnText}>문장 불러오기</Text>
            </TouchableOpacity>
          </View>

          <View style={s.mediaRow}>
            <Pressable style={[s.mediaBtn, { backgroundColor: "#FFF1BF" }]} onPress={() => onUploadGroupMedia("photo")} disabled={mediaUploading === "group"}>
              {mediaUploading === "group" ? <ActivityIndicator size="small" color="#E4A93A" /> : <><Feather name="image" size={14} color="#E4A93A" /><Text style={[s.mediaBtnText, { color: "#E4A93A" }]}>반 사진 추가</Text></>}
            </Pressable>
            <Pressable style={[s.mediaBtn, { backgroundColor: "#E6FFFA" }]} onPress={() => onUploadGroupMedia("video")} disabled={mediaUploading === "group"}>
              <Feather name="video" size={14} color="#2EC4B6" /><Text style={[s.mediaBtnText, { color: "#2EC4B6" }]}>반 영상 추가</Text>
            </Pressable>
          </View>
          {groupMedia.length > 0 && (
            <View style={s.mediaPreviewRow}>
              {groupMedia.map((m, i) => (
                <View key={i} style={s.mediaThumb}>
                  {m.kind === "photo"
                    ? <Feather name={m.uploaded ? "check-circle" : m.error ? "alert-circle" : "image"} size={20} color={m.uploaded ? "#2EC4B6" : m.error ? "#D96C6C" : "#E4A93A"} />
                    : <Feather name={m.uploaded ? "check-circle" : m.error ? "alert-circle" : "video"} size={20} color={m.uploaded ? "#2EC4B6" : m.error ? "#D96C6C" : "#2EC4B6"} />}
                  {m.uploading && <ActivityIndicator size="small" color={C.tint} style={{ position: "absolute" }} />}
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={[s.card, { backgroundColor: C.card }]}>
          <View style={s.cardHeader}>
            <View style={[s.cardIcon, { backgroundColor: "#8B5CF620" }]}>
              <Feather name="user" size={15} color="#8B5CF6" />
            </View>
            <Text style={[s.cardTitle, { color: C.text }]}>학생별 추가 일지</Text>
            <Text style={s.cardSub}>필요한 학생만 선택</Text>
          </View>

          {studentNotes.map(note => {
            const st: StudentOption = { id: note.student_id, name: note.student_name };
            const stMedia = studentMedia[note.student_id] || [];
            return (
              <View key={note.student_id} style={[s.noteItem, { backgroundColor: "#EEDDF5" }]}>
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={s.noteName}>{note.student_name}</Text>
                    <Pressable onPress={() => onRemoveNote(note.student_id)}>
                      <Feather name="x-circle" size={18} color={C.textMuted} />
                    </Pressable>
                  </View>
                  <Text style={s.noteContent} numberOfLines={2}>{note.note_content}</Text>
                  <View style={[s.mediaRow, { marginTop: 2 }]}>
                    <Pressable style={[s.mediaBtn, { backgroundColor: "#EEDDF5" }]} onPress={() => onUploadStudentMedia(st, "photo")} disabled={mediaUploading === note.student_id}>
                      {mediaUploading === note.student_id ? <ActivityIndicator size="small" color="#7C3AED" /> : <><Feather name="image" size={13} color="#7C3AED" /><Text style={[s.mediaBtnText, { color: "#7C3AED" }]}>개별 사진</Text></>}
                    </Pressable>
                    <Pressable style={[s.mediaBtn, { backgroundColor: "#EEDDF5" }]} onPress={() => onUploadStudentMedia(st, "video")} disabled={mediaUploading === note.student_id}>
                      <Feather name="video" size={13} color="#7C3AED" /><Text style={[s.mediaBtnText, { color: "#7C3AED" }]}>개별 영상</Text>
                    </Pressable>
                  </View>
                  {stMedia.length > 0 && (
                    <View style={s.mediaPreviewRow}>
                      {stMedia.map((m, i) => (
                        <View key={i} style={s.mediaThumb}>
                          <Feather name={m.uploaded ? "check-circle" : m.error ? "alert-circle" : (m.kind === "photo" ? "image" : "video")} size={16}
                            color={m.uploaded ? "#2EC4B6" : m.error ? "#D96C6C" : "#7C3AED"} />
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </View>
            );
          })}

          {classStudents.length === 0 ? (
            <View style={[s.emptyStudents, { backgroundColor: C.background, borderColor: C.border }]}>
              <Feather name="users" size={16} color={C.textMuted} />
              <Text style={[s.emptyStudentsText, { color: C.textMuted }]}>이 수업에 배정된 학생이 없습니다</Text>
            </View>
          ) : (
            <View style={{ gap: 6 }}>
              <Text style={[s.sectionLabel, { color: C.textSecondary }]}>학생 선택</Text>
              {classStudents.filter(st => !studentNotes.some(n => n.student_id === st.id)).map(st => (
                <Pressable key={st.id}
                  style={[s.studentChip, { backgroundColor: C.background, borderColor: C.border }, addNoteStudent?.id === st.id && { borderColor: "#8B5CF6", backgroundColor: "#EEDDF5" }]}
                  onPress={() => { if (addNoteStudent?.id === st.id) { setAddNoteStudent(null); setNoteInput(""); } else { setAddNoteStudent(st); setNoteInput(""); } }}>
                  <Text style={[s.studentChipText, { color: addNoteStudent?.id === st.id ? "#8B5CF6" : C.text }]}>{st.name}</Text>
                  <Feather name="plus-circle" size={15} color={addNoteStudent?.id === st.id ? "#8B5CF6" : C.textMuted} />
                </Pressable>
              ))}
            </View>
          )}

          {addNoteStudent && (
            <View style={[s.noteInput, { backgroundColor: "#EEDDF5", borderColor: "#8B5CF6" }]}>
              <Text style={[s.noteName, { color: "#8B5CF6", marginBottom: 6 }]}>{addNoteStudent.name} 추가 일지</Text>
              <TextInput style={[s.noteTextarea, { borderColor: "#8B5CF6", color: C.text }]}
                value={noteInput} onChangeText={setNoteInput}
                onSelectionChange={e => { noteCursorRef.current = e.nativeEvent.selection.start; }}
                placeholder="이 학생에게 전달할 추가 내용을 입력하세요"
                placeholderTextColor={C.textMuted} multiline numberOfLines={3} textAlignVertical="top" autoFocus />
              <TouchableOpacity style={[s.sentencePickBtn, { alignSelf: "flex-start", marginTop: 6 }]} onPress={() => setShowPickerFor("note")} activeOpacity={0.7}>
                <Feather name="book-open" size={13} color="#8B5CF6" />
                <Text style={[s.sentencePickBtnText, { color: "#8B5CF6" }]}>문장 불러오기</Text>
              </TouchableOpacity>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                <Pressable style={[s.noteBtn, { borderColor: C.border }]} onPress={() => { setAddNoteStudent(null); setNoteInput(""); }}>
                  <Text style={{ color: C.textSecondary, fontFamily: "Pretendard-SemiBold", fontSize: 13 }}>취소</Text>
                </Pressable>
                <Pressable style={[s.noteBtn, { backgroundColor: "#8B5CF6", borderColor: "#8B5CF6", flex: 1 }]} onPress={onAddNote} disabled={!noteInput.trim()}>
                  <Text style={{ color: "#fff", fontFamily: "Pretendard-SemiBold", fontSize: 13 }}>추가</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      <View style={s.footer}>
        {formError && (
          <View style={[s.inlineError, { backgroundColor: "#F9DEDA" }]}>
            <Feather name="alert-circle" size={13} color={C.error} />
            <Text style={[s.inlineErrorText, { color: C.error }]}>{formError}</Text>
          </View>
        )}
        {saveMsg && (
          <View style={[s.inlineError, { backgroundColor: saveMsg.type === "success" ? "#E6FFFA" : "#F9DEDA" }]}>
            <Feather name={saveMsg.type === "success" ? "check-circle" : "alert-circle"} size={13}
              color={saveMsg.type === "success" ? "#2EC4B6" : C.error} />
            <Text style={[s.inlineErrorText, { color: saveMsg.type === "success" ? "#2EC4B6" : C.error }]}>{saveMsg.text}</Text>
          </View>
        )}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable style={[s.cancelBtnFt, { borderColor: C.border }]} onPress={onBack}>
            <Text style={[s.cancelBtnFtText, { color: C.textSecondary }]}>나가기</Text>
          </Pressable>
          <Pressable style={[s.saveBtn, { backgroundColor: themeColor, opacity: saving || myDiaryExists ? 0.5 : 1, flex: 2 }]}
            onPress={onSave} disabled={saving || myDiaryExists}>
            {saving ? <ActivityIndicator color="#fff" size="small" /> : <><Feather name="save" size={16} color="#fff" /><Text style={s.saveBtnText}>저장</Text></>}
          </Pressable>
        </View>
      </View>

      <SentencePicker
        visible={showPickerFor === "common" || showPickerFor === "note"}
        onClose={() => setShowPickerFor(null)}
        onInsert={text => {
          if (showPickerFor === "common") {
            insertAtCursor(commonContent, text, commonCursorRef.current, setCommonContent);
            commonCursorRef.current = commonCursorRef.current + text.length;
          } else if (showPickerFor === "note") {
            insertAtCursor(noteInput, text, noteCursorRef.current, setNoteInput);
            noteCursorRef.current = noteCursorRef.current + text.length;
          }
          setShowPickerFor(null);
        }}
      />
    </KeyboardAvoidingView>
  );
}

export const s = StyleSheet.create({
  form:          { padding: 14, gap: 14, paddingBottom: 80 },
  infoBox:       { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12 },
  infoText:      { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", color: "#92400E", lineHeight: 18 },
  card:          { borderRadius: 16, padding: 14, gap: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  cardHeader:    { flexDirection: "row", alignItems: "center", gap: 8 },
  cardIcon:      { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  cardTitle:     { fontSize: 14, fontFamily: "Pretendard-Bold", flex: 1 },
  cardSub:       { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#9CA3AF" },
  templateBtn:   { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, alignSelf: "flex-start" },
  templateBtnText: { fontSize: 12, fontFamily: "Pretendard-SemiBold" },
  templateList:  { gap: 6 },
  templateItem:  { borderRadius: 10, padding: 12, gap: 4 },
  templateText:  { fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 20 },
  templateCategory: { fontSize: 11, fontFamily: "Pretendard-SemiBold" },
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
  noteItem:      { borderRadius: 10, padding: 10, gap: 4 },
  editNoteItem:  { borderRadius: 12, borderWidth: 1.5, padding: 12, gap: 8 },
  editNoteHeader:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  noteName:      { fontSize: 12, fontFamily: "Pretendard-Bold", color: "#7C3AED" },
  noteContent:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#111827", lineHeight: 18 },
  noteInput:     { borderRadius: 12, borderWidth: 1.5, padding: 12, gap: 4 },
  noteTextarea:  { borderWidth: 1.5, borderRadius: 10, padding: 10, fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 20, minHeight: 80, textAlignVertical: "top", backgroundColor: "#fff" },
  noteBtn:       { flex: 1, height: 38, borderRadius: 10, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  mediaRow:      { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  mediaBtn:      { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  mediaBtnText:  { fontSize: 12, fontFamily: "Pretendard-SemiBold" },
  mediaPreviewRow: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 4 },
  mediaThumb:    { width: 36, height: 36, borderRadius: 8, backgroundColor: "#F8FAFC", alignItems: "center", justifyContent: "center" },
  footer:        { gap: 8, padding: 12, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  cancelBtnFt:   { flex: 1, height: 50, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  cancelBtnFtText: { fontSize: 14, fontFamily: "Pretendard-SemiBold" },
  saveBtn:       { flexDirection: "row", height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", gap: 8 },
  saveBtnText:   { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Bold" },
  inlineError:   { flexDirection: "row", alignItems: "center", gap: 6, padding: 10, borderRadius: 10 },
  inlineErrorText: { flex: 1, fontSize: 12, fontFamily: "Pretendard-Medium", lineHeight: 17 },
  statusBadge:   { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  statusBadgeText: { fontSize: 11, fontFamily: "Pretendard-SemiBold" },
  infoCard:      { borderRadius: 14, borderWidth: 1.5, padding: 14, gap: 8 },
  infoCardRow:   { flexDirection: "row", alignItems: "center", gap: 8 },
  infoCardText:  { fontSize: 13, fontFamily: "Pretendard-SemiBold" },
  subHeader:     { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  tabBtn:        { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1.5 },
  tabBtnText:    { fontSize: 12, fontFamily: "Pretendard-SemiBold" },
  diaryList:     { padding: 12, gap: 10, paddingBottom: 120 },
  diaryCard:     { borderRadius: 14, padding: 14, gap: 8 },
  diaryCardEditable: { borderWidth: 1.5, borderColor: "#E6FFFA" },
  badgeRow:      { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  diaryCardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  diaryCardDate: { fontSize: 15, fontFamily: "Pretendard-Bold" },
  diaryTeacher:  { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 },
  diaryContent:  { fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 20 },
  iconBtn:       { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  emptyBox:      { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyText:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#9CA3AF" },
  delOverlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: 24 },
  delSheet:      { width: "100%", borderRadius: 22, padding: 24, alignItems: "center", gap: 14 },
  delIconWrap:   { width: 64, height: 64, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  delTitle:      { fontSize: 18, fontFamily: "Pretendard-Bold" },
  delDesc:       { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 20 },
  delBtn:        { height: 48, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  safe:          { flex: 1, backgroundColor: "#F8FAFC" },
});
