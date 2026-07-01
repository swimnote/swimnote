import { BookOpen, CircleAlert, CirclePlus, CircleX, Images, Image, Save, User, Users, Video, Zap } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { MutableRefObject, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import Colors from "@/constants/colors";
import SentencePicker from "@/components/teacher/SentencePicker";
import { AlbumPhotoInfo, AlbumVideoInfo, DiaryTemplate, DiaryTemplateLevel, StudentNote, StudentOption, UploadedMedia } from "./types";
import { API_BASE } from "@/context/AuthContext";
import { TeacherClassGroup } from "@/components/teacher/types";

const C = Colors.light;

export default function DiaryWriteView({
  group, targetDate, themeColor, myDiaryExists,
  templates, levels,
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
  token, onOpenAlbumPicker, selectedAlbumPhotos, onRemoveAlbumPhoto, selectedAlbumVideos, onRemoveAlbumVideo,
}: {
  group: TeacherClassGroup; targetDate: string; themeColor: string; myDiaryExists: boolean;
  templates: DiaryTemplate[]; levels: DiaryTemplateLevel[];
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
  token: string;
  onOpenAlbumPicker: () => void;
  selectedAlbumPhotos: AlbumPhotoInfo[];
  onRemoveAlbumPhoto: (id: string) => void;
  selectedAlbumVideos: AlbumVideoInfo[];
  onRemoveAlbumVideo: (id: string) => void;
}) {
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [pickerLevelId, setPickerLevelId] = useState<string | null>(null);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        {myDiaryExists && (
          <View style={[s.infoBox, { backgroundColor: "#FFF1BF" }]}>
            <CircleAlert size={13} color="#D97706" />
            <Text style={s.infoText}>오늘 이미 일지가 작성되어 있습니다. 수정은 "지난 일지"에서 할 수 있습니다.</Text>
          </View>
        )}

        <View style={[s.card, { backgroundColor: C.card }]}>
          <View style={s.cardHeader}>
            <View style={[s.cardIcon, { backgroundColor: themeColor + "20" }]}>
              <BookOpen size={15} color={themeColor} />
            </View>
            <Text style={[s.cardTitle, { color: C.text }]}>반 공통 일지</Text>
            <Text style={s.cardSub}>모든 학생에게 공통으로 보이는 내용</Text>
          </View>

          {levels.length > 0 && (
            <Pressable
              style={[s.templateBtn, { borderColor: themeColor }]}
              onPress={() => {
                if (!pickerLevelId && levels.length > 0) setPickerLevelId(levels[0].id);
                setShowTemplatePicker(true);
              }}
            >
              <Zap size={13} color={themeColor} />
              <Text style={[s.templateBtnText, { color: themeColor }]}>템플릿 불러오기</Text>
            </Pressable>
          )}

          <TextInput style={[s.textarea, { borderColor: C.border, color: C.text }]}
            value={commonContent} onChangeText={setCommonContent}
            onSelectionChange={e => { commonCursorRef.current = e.nativeEvent.selection.start; }}
            placeholder="오늘 수업 내용을 입력하세요.\n(모든 학생 학부모에게 공통으로 노출됩니다)"
            placeholderTextColor={C.textMuted} multiline numberOfLines={6} textAlignVertical="top" />
          <View style={s.textareaFooter}>
            <Text style={s.charCount}>{commonContent.length}자</Text>
            <TouchableOpacity style={s.sentencePickBtn} onPress={() => setShowPickerFor("common")} activeOpacity={0.7}>
              <BookOpen size={13} color={C.tint} />
              <Text style={s.sentencePickBtnText}>문장 불러오기</Text>
            </TouchableOpacity>
          </View>

          <View style={s.mediaRow}>
            <Pressable style={[s.mediaBtn, { backgroundColor: "#FFF1BF" }]} onPress={() => onUploadGroupMedia("photo")} disabled={mediaUploading === "group"}>
              {mediaUploading === "group" ? <ActivityIndicator size="small" color="#E4A93A" /> : <><Image size={14} color="#E4A93A" /><Text style={[s.mediaBtnText, { color: "#E4A93A" }]}>반 사진 추가</Text></>}
            </Pressable>
            <Pressable style={[s.mediaBtn, { backgroundColor: "#E6FFFA" }]} onPress={() => onUploadGroupMedia("video")} disabled={mediaUploading === "group"}>
              <Video size={14} color="#2EC4B6" /><Text style={[s.mediaBtnText, { color: "#2EC4B6" }]}>반 영상 추가</Text>
            </Pressable>
            <Pressable style={[s.mediaBtn, { backgroundColor: "#EFF6FF" }]} onPress={onOpenAlbumPicker}>
              <Images size={14} color="#3B82F6" /><Text style={[s.mediaBtnText, { color: "#3B82F6" }]}>앨범에서 선택</Text>
            </Pressable>
          </View>
          {groupMedia.length > 0 && (
            <View style={s.mediaPreviewRow}>
              {groupMedia.map((m, i) => (
                <View key={i} style={s.mediaThumb}>
                  {m.kind === "photo"
                    ? <LucideIcon name={m.uploaded ? "check-circle" : m.error ? "alert-circle" : "image"} size={20} color={m.uploaded ? "#2EC4B6" : m.error ? "#D96C6C" : "#E4A93A"} />
                    : <LucideIcon name={m.uploaded ? "check-circle" : m.error ? "alert-circle" : "video"} size={20} color={m.uploaded ? "#2EC4B6" : m.error ? "#D96C6C" : "#2EC4B6"} />}
                  {m.uploading && <ActivityIndicator size="small" color={C.tint} style={{ position: "absolute" }} />}
                </View>
              ))}
            </View>
          )}
          {(selectedAlbumPhotos.length > 0 || selectedAlbumVideos.length > 0) && (
            <View style={{ gap: 10 }}>
              {selectedAlbumPhotos.length > 0 && (
                <View>
                  <Text style={[s.albumLabel, { color: "#3B82F6" }]}>첨부 사진 {selectedAlbumPhotos.length}장</Text>
                  <View style={s.albumPreviewRow}>
                    {selectedAlbumPhotos.map(photo => (
                      <View key={photo.id} style={s.albumThumb}>
                        <ExpoImage
                          source={{ uri: photo.presigned_url ?? `${API_BASE.replace(/\/api$/, "")}${photo.file_url}?token=${token}` }}
                          style={{ width: "100%", height: "100%", borderRadius: 6 }}
                          contentFit="cover"
                        />
                        <Pressable style={s.albumThumbRemove} onPress={() => onRemoveAlbumPhoto(photo.id)} hitSlop={6}>
                          <CircleX size={16} color="#fff" fill="#374151" />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                </View>
              )}
              {selectedAlbumVideos.length > 0 && (
                <View>
                  <Text style={[s.albumLabel, { color: "#2EC4B6" }]}>첨부 영상 {selectedAlbumVideos.length}개</Text>
                  <View style={s.albumPreviewRow}>
                    {selectedAlbumVideos.map(video => (
                      <View key={video.id} style={s.albumThumb}>
                        {video.thumbnail_presigned_url ? (
                          <ExpoImage
                            source={{ uri: video.thumbnail_presigned_url }}
                            style={{ width: "100%", height: "100%", borderRadius: 6 }}
                            contentFit="cover"
                          />
                        ) : (
                          <View style={{ width: "100%", height: "100%", borderRadius: 6, backgroundColor: "#1E293B", alignItems: "center", justifyContent: "center" }}>
                            <Video size={18} color="#94A3B8" />
                          </View>
                        )}
                        <View style={{ position: "absolute", bottom: 3, left: 3, width: 16, height: 16, borderRadius: 8, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" }}>
                          <Video size={8} color="#fff" />
                        </View>
                        <Pressable style={s.albumThumbRemove} onPress={() => onRemoveAlbumVideo(video.id)} hitSlop={6}>
                          <CircleX size={16} color="#fff" fill="#374151" />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          )}
        </View>

        <View style={[s.card, { backgroundColor: C.card }]}>
          <View style={s.cardHeader}>
            <View style={[s.cardIcon, { backgroundColor: "#8B5CF620" }]}>
              <User size={15} color="#8B5CF6" />
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
                      <CircleX size={18} color={C.textMuted} />
                    </Pressable>
                  </View>
                  <Text style={s.noteContent} numberOfLines={2}>{note.note_content}</Text>
                  <View style={[s.mediaRow, { marginTop: 2 }]}>
                    <Pressable style={[s.mediaBtn, { backgroundColor: "#EEDDF5" }]} onPress={() => onUploadStudentMedia(st, "photo")} disabled={mediaUploading === note.student_id}>
                      {mediaUploading === note.student_id ? <ActivityIndicator size="small" color="#7C3AED" /> : <><Image size={13} color="#7C3AED" /><Text style={[s.mediaBtnText, { color: "#7C3AED" }]}>개별 사진</Text></>}
                    </Pressable>
                    <Pressable style={[s.mediaBtn, { backgroundColor: "#EEDDF5" }]} onPress={() => onUploadStudentMedia(st, "video")} disabled={mediaUploading === note.student_id}>
                      <Video size={13} color="#7C3AED" /><Text style={[s.mediaBtnText, { color: "#7C3AED" }]}>개별 영상</Text>
                    </Pressable>
                  </View>
                  {stMedia.length > 0 && (
                    <View style={s.mediaPreviewRow}>
                      {stMedia.map((m, i) => (
                        <View key={i} style={s.mediaThumb}>
                          <LucideIcon name={m.uploaded ? "check-circle" : m.error ? "alert-circle" : (m.kind === "photo" ? "image" : "video")} size={16}
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
              <Users size={16} color={C.textMuted} />
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
                  <CirclePlus size={15} color={addNoteStudent?.id === st.id ? "#8B5CF6" : C.textMuted} />
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
                <BookOpen size={13} color="#8B5CF6" />
                <Text style={[s.sentencePickBtnText, { color: "#8B5CF6" }]}>문장 불러오기</Text>
              </TouchableOpacity>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                <Pressable style={[s.noteBtn, { borderColor: C.border }]} onPress={() => { setAddNoteStudent(null); setNoteInput(""); }}>
                  <Text style={{ color: C.textSecondary, fontFamily: "Pretendard-Regular", fontSize: 13 }}>취소</Text>
                </Pressable>
                <Pressable style={[s.noteBtn, { backgroundColor: "#8B5CF6", borderColor: "#8B5CF6", flex: 1 }]} onPress={onAddNote} disabled={!noteInput.trim()}>
                  <Text style={{ color: "#fff", fontFamily: "Pretendard-Regular", fontSize: 13 }}>추가</Text>
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
            <CircleAlert size={13} color={C.error} />
            <Text style={[s.inlineErrorText, { color: C.error }]}>{formError}</Text>
          </View>
        )}
        {saveMsg && (
          <View style={[s.inlineError, { backgroundColor: saveMsg.type === "success" ? "#E6FFFA" : "#F9DEDA" }]}>
            <LucideIcon name={saveMsg.type === "success" ? "check-circle" : "alert-circle"} size={13}
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
            {saving ? <ActivityIndicator color="#fff" size="small" /> : <><Save size={16} color="#fff" /><Text style={s.saveBtnText}>저장</Text></>}
          </Pressable>
        </View>
      </View>

      <SentencePicker
        visible={showPickerFor === "common" || showPickerFor === "note"}
        onClose={() => setShowPickerFor(null)}
        onInsert={text => {
          if (showPickerFor === "common") {
            setCommonContent(prev => prev.trim() ? `${prev.trim()}\n\n${text}` : text);
          } else if (showPickerFor === "note") {
            setNoteInput(prev => prev.trim() ? `${prev.trim()}\n\n${text}` : text);
          }
          setShowPickerFor(null);
        }}
      />

      <TemplatePicker
        visible={showTemplatePicker}
        levels={levels}
        templates={templates}
        selectedLevelId={pickerLevelId}
        onSelectLevel={setPickerLevelId}
        themeColor={themeColor}
        onInsert={(text) => {
          setCommonContent(commonContent.trim() ? `${commonContent.trim()}\n\n${text}` : text);
          setShowTemplatePicker(false);
        }}
        onClose={() => setShowTemplatePicker(false)}
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
  cardTitle:     { fontSize: 14, fontFamily: "Pretendard-Regular", flex: 1 },
  cardSub:       { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  templateBtn:   { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, alignSelf: "flex-start" },
  templateBtnText: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  templateList:  { gap: 6 },
  templateItem:  { borderRadius: 10, padding: 12, gap: 4 },
  templateText:  { fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 20 },
  templateCategory: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  textarea:      { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 22, minHeight: 140, textAlignVertical: "top", backgroundColor: "#fff" },
  textareaFooter:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  charCount:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  sentencePickBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1.5, borderColor: Colors.light.tintLight, backgroundColor: "#F0F5FF" },
  sentencePickBtnText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: Colors.light.tint },
  emptyStudents: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  emptyStudentsText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  sectionLabel:  { fontSize: 12, fontFamily: "Pretendard-Regular" },
  studentChip:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 10, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 8 },
  studentChipText: { fontSize: 13, fontFamily: "Pretendard-Regular", flex: 1 },
  noteItem:      { borderRadius: 10, padding: 10, gap: 4 },
  editNoteItem:  { borderRadius: 12, borderWidth: 1.5, padding: 12, gap: 8 },
  editNoteHeader:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  noteName:      { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#7C3AED" },
  noteContent:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A", lineHeight: 18 },
  noteInput:     { borderRadius: 12, borderWidth: 1.5, padding: 12, gap: 4 },
  noteTextarea:  { borderWidth: 1.5, borderRadius: 10, padding: 10, fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 20, minHeight: 80, textAlignVertical: "top", backgroundColor: "#fff" },
  noteBtn:       { flex: 1, height: 38, borderRadius: 10, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  mediaRow:      { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  mediaBtn:      { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  mediaBtnText:  { fontSize: 12, fontFamily: "Pretendard-Regular" },
  mediaPreviewRow: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 4 },
  mediaThumb:    { width: 36, height: 36, borderRadius: 8, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  albumLabel:    { fontSize: 11, fontFamily: "Pretendard-Regular", marginBottom: 6 },
  albumPreviewRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  albumThumb:    { width: 56, height: 56, borderRadius: 8, overflow: "hidden", backgroundColor: "#F1F5F9" },
  albumThumbRemove: { position: "absolute", top: 2, right: 2 },
  footer:        { gap: 8, padding: 12, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  cancelBtnFt:   { flex: 1, height: 50, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  cancelBtnFtText: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  saveBtn:       { flexDirection: "row", height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", gap: 8 },
  saveBtnText:   { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" },
  inlineError:   { flexDirection: "row", alignItems: "center", gap: 6, padding: 10, borderRadius: 10 },
  inlineErrorText: { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", lineHeight: 17 },
  statusBadge:   { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  statusBadgeText: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  infoCard:      { borderRadius: 14, borderWidth: 1.5, padding: 14, gap: 8 },
  infoCardRow:   { flexDirection: "row", alignItems: "center", gap: 8 },
  infoCardText:  { fontSize: 13, fontFamily: "Pretendard-Regular" },
  subHeader:     { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  tabBtn:        { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1.5 },
  tabBtnText:    { fontSize: 12, fontFamily: "Pretendard-Regular" },
  diaryList:     { padding: 12, gap: 10, paddingBottom: 120 },
  diaryCard:     { borderRadius: 14, padding: 14, gap: 8 },
  diaryCardEditable: { borderWidth: 1.5, borderColor: "#E6FFFA" },
  badgeRow:      { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  diaryCardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  diaryCardDate: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  diaryTeacher:  { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 },
  diaryContent:  { fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 20 },
  iconBtn:       { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  emptyBox:      { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyText:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B" },
  delOverlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: 24 },
  delSheet:      { width: "100%", borderRadius: 22, padding: 24, alignItems: "center", gap: 14 },
  delIconWrap:   { width: 64, height: 64, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  delTitle:      { fontSize: 18, fontFamily: "Pretendard-Regular" },
  delDesc:       { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 20 },
  delBtn:        { height: 48, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  safe:          { flex: 1, backgroundColor: "#FFFFFF" },
});

function TemplatePicker({
  visible, levels, templates, selectedLevelId, onSelectLevel, themeColor, onInsert, onClose,
}: {
  visible: boolean; levels: DiaryTemplateLevel[]; templates: DiaryTemplate[];
  selectedLevelId: string | null; onSelectLevel: (id: string) => void;
  themeColor: string; onInsert: (text: string) => void; onClose: () => void;
}) {
  // merged view: global_id != null → merged(global+override), global_id==null → 내 신규 추가
  const baseItems    = selectedLevelId ? templates.filter(t => t.level_id === selectedLevelId && t.global_id !== null) : [];
  const myNewItems   = selectedLevelId ? templates.filter(t => t.level_id === selectedLevelId && t.global_id === null) : [];
  const totalCount   = baseItems.length + myNewItems.length;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={tp.overlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={tp.sheet}>
          <View style={tp.handle} />
          <View style={tp.header}>
            <Text style={tp.headerTitle}>템플릿 불러오기</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <LucideIcon name="x" size={18} color={C.textSecondary} />
            </Pressable>
          </View>

          {levels.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={tp.tabRow}>
              {levels.map(lv => (
                <Pressable
                  key={lv.id}
                  style={[tp.tab, selectedLevelId === lv.id && { backgroundColor: themeColor + "20", borderColor: themeColor }]}
                  onPress={() => onSelectLevel(lv.id)}
                >
                  <Text style={[tp.tabText, selectedLevelId === lv.id && { color: themeColor }]}>
                    {lv.level_name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          <ScrollView style={tp.listScroll} contentContainerStyle={tp.listContent} keyboardShouldPersistTaps="handled">
            {totalCount === 0 ? (
              <View style={tp.emptyBox}>
                <Text style={tp.emptyText}>이 레벨에 등록된 템플릿이 없습니다.</Text>
              </View>
            ) : (
              <>
                {baseItems.map(t => (
                  <Pressable key={t.id} style={[tp.item, t.is_overridden && tp.itemOverridden]} onPress={() => onInsert(t.template_text)}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: t.is_overridden ? 2 : 0 }}>
                      {!!t.title && <Text style={tp.itemTitle} numberOfLines={1}>{t.title}</Text>}
                      {t.is_overridden && <View style={tp.myBadge}><Text style={tp.myBadgeText}>내 수정</Text></View>}
                    </View>
                    <Text style={tp.itemText} numberOfLines={3}>{t.template_text}</Text>
                  </Pressable>
                ))}
                {myNewItems.length > 0 && (
                  <>
                    <Text style={[tp.sectionLabel, { marginTop: baseItems.length > 0 ? 12 : 0 }]}>내 추가 항목</Text>
                    {myNewItems.map(t => (
                      <Pressable key={t.id} style={[tp.item, tp.itemTeacher]} onPress={() => onInsert(t.template_text)}>
                        {!!t.title && <Text style={[tp.itemTitle, { color: "#7C3AED" }]} numberOfLines={1}>{t.title}</Text>}
                        <Text style={tp.itemText} numberOfLines={3}>{t.template_text}</Text>
                      </Pressable>
                    ))}
                  </>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const tp = StyleSheet.create({
  overlay:     { flex: 1, backgroundColor: "rgba(0,0,0,0.3)", justifyContent: "flex-end" },
  sheet:       { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: 440 },
  handle:      { width: 36, height: 4, borderRadius: 2, backgroundColor: "#E2E8F0", alignSelf: "center", marginTop: 10, marginBottom: 4 },
  header:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  headerTitle: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  tabRow:      { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  tab:         { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1.5, borderColor: "#E2E8F0" },
  tabText:     { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B" },
  listScroll:  { flexShrink: 1 },
  listContent: { padding: 12, gap: 8, paddingBottom: 24 },
  emptyBox:     { paddingTop: 32, alignItems: "center" },
  emptyText:    { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#94A3B8" },
  sectionLabel: { fontSize: 11, fontFamily: "Pretendard-SemiBold", color: "#94A3B8", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 },
  item:          { borderRadius: 10, padding: 12, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E5E7EB", gap: 4, marginBottom: 6 },
  itemTeacher:   { backgroundColor: "#F5F3FF", borderColor: "#DDD6FE" },
  itemOverridden:{ backgroundColor: "#FFF8EC", borderColor: "#FCD34D" },
  myBadge:       { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, backgroundColor: "#FCD34D" },
  myBadgeText:   { fontSize: 10, fontFamily: "Pretendard-SemiBold", color: "#92400E" },
  itemTitle:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#2EC4B6" },
  itemText:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A", lineHeight: 20 },
});
