import { BookOpen, Calendar, CircleAlert, CirclePlus, CircleX, Images, Layers, Save, Trash2, User, Users } from "lucide-react-native";
import React, { MutableRefObject } from "react";
import {
  ActivityIndicator, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image as ExpoImage } from "expo-image";
import Colors from "@/constants/colors";
import SentencePicker from "@/components/teacher/SentencePicker";
import { AlbumPhotoInfo, AlbumVideoInfo, DiaryEntry, ExistingNote, StudentNote, StudentOption } from "./types";
import { API_BASE } from "@/context/AuthContext";
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
  token, linkedPhotos, onRemoveLinkedPhoto, onOpenAlbumPicker, newAlbumPhotos, onRemoveNewAlbumPhoto,
  linkedVideos, onRemoveLinkedVideo, newAlbumVideos, onRemoveNewAlbumVideo,
  studentAlbumPhotos, studentAlbumVideos, onOpenStudentAlbumPicker, onRemoveStudentAlbumPhoto, onRemoveStudentAlbumVideo,
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
  token: string;
  linkedPhotos: AlbumPhotoInfo[];
  onRemoveLinkedPhoto: (id: string) => void;
  onOpenAlbumPicker: () => void;
  newAlbumPhotos: AlbumPhotoInfo[];
  onRemoveNewAlbumPhoto: (id: string) => void;
  linkedVideos: AlbumVideoInfo[];
  onRemoveLinkedVideo: (id: string) => void;
  newAlbumVideos: AlbumVideoInfo[];
  onRemoveNewAlbumVideo: (id: string) => void;
  studentAlbumPhotos: Record<string, AlbumPhotoInfo[]>;
  studentAlbumVideos: Record<string, AlbumVideoInfo[]>;
  onOpenStudentAlbumPicker: (student: StudentOption) => void;
  onRemoveStudentAlbumPhoto: (studentId: string, photoId: string) => void;
  onRemoveStudentAlbumVideo: (studentId: string, videoId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const activeNotes = editNotes.filter(n => !n._deleted);
  const usedStudentIds = new Set([
    ...activeNotes.map(n => n.student_id),
    ...editNewNotes.map(n => n.student_id),
  ]);

  if (editLoading) {
    return <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />;
  }

  return (
    <View style={{ flex: 1 }}>
      <KeyboardAwareScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} keyboardDismissMode="interactive" bottomOffset={90}>

        <View style={[s.infoCard, { backgroundColor: themeColor + "12", borderColor: themeColor + "30" }]}>
          <View style={s.infoCardRow}>
            <Layers size={14} color={themeColor} />
            <Text style={[s.infoCardText, { color: themeColor }]}>{group.name}</Text>
          </View>
          <View style={s.infoCardRow}>
            <Calendar size={14} color={themeColor} />
            <Text style={[s.infoCardText, { color: themeColor }]}>{editDiary?.lesson_date} · {group.schedule_time}</Text>
          </View>
          <View style={s.infoCardRow}>
            <User size={14} color={themeColor} />
            <Text style={[s.infoCardText, { color: themeColor }]}>{editDiary?.teacher_name} 선생님</Text>
          </View>
        </View>

        <View style={[s.card, { backgroundColor: C.card }]}>
          <View style={s.cardHeader}>
            <View style={[s.cardIcon, { backgroundColor: themeColor + "20" }]}>
              <BookOpen size={15} color={themeColor} />
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
              <BookOpen size={13} color={C.tint} />
              <Text style={s.sentencePickBtnText}>템플릿선택</Text>
            </TouchableOpacity>
          </View>

          {(linkedPhotos.length > 0 || newAlbumPhotos.length > 0 || linkedVideos.length > 0 || newAlbumVideos.length > 0) && (
            <View style={s.photoSection}>
              {linkedPhotos.length > 0 && (
                <View>
                  <Text style={s.photoSectionLabel}>연결된 사진 ({linkedPhotos.length}장)</Text>
                  <View style={s.albumPreviewRow}>
                    {linkedPhotos.map(photo => (
                      <View key={photo.id} style={s.albumThumb}>
                        <ExpoImage
                          source={{ uri: photo.presigned_url ?? `${API_BASE.replace(/\/api$/, "")}${photo.file_url}?token=${token}` }}
                          style={{ width: "100%", height: "100%", borderRadius: 6 }}
                          contentFit="cover"
                        />
                        <Pressable style={s.albumThumbRemove} onPress={() => onRemoveLinkedPhoto(photo.id)} hitSlop={6}>
                          <CircleX size={16} color="#fff" fill="#DC2626" />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                </View>
              )}
              {newAlbumPhotos.length > 0 && (
                <View>
                  <Text style={[s.photoSectionLabel, { color: "#3B82F6" }]}>추가할 사진 ({newAlbumPhotos.length}장)</Text>
                  <View style={s.albumPreviewRow}>
                    {newAlbumPhotos.map(photo => (
                      <View key={photo.id} style={s.albumThumb}>
                        <ExpoImage
                          source={{ uri: photo.presigned_url ?? `${API_BASE.replace(/\/api$/, "")}${photo.file_url}?token=${token}` }}
                          style={{ width: "100%", height: "100%", borderRadius: 6 }}
                          contentFit="cover"
                        />
                        <Pressable style={s.albumThumbRemove} onPress={() => onRemoveNewAlbumPhoto(photo.id)} hitSlop={6}>
                          <CircleX size={16} color="#fff" fill="#374151" />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                </View>
              )}
              {linkedVideos.length > 0 && (
                <View>
                  <Text style={s.photoSectionLabel}>연결된 영상 ({linkedVideos.length}개)</Text>
                  <View style={s.albumPreviewRow}>
                    {linkedVideos.map(video => (
                      <View key={video.id} style={s.albumThumb}>
                        {video.status === 'expired' ? (
                          <View style={{ width: "100%", height: "100%", borderRadius: 6, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center", padding: 4 }}>
                            <CircleAlert size={14} color="#94A3B8" />
                            <Text style={{ fontSize: 8, color: "#94A3B8", textAlign: "center", marginTop: 2 }}>보관기간{"\n"}만료</Text>
                          </View>
                        ) : video.thumbnail_presigned_url ? (
                          <ExpoImage
                            source={{ uri: video.thumbnail_presigned_url }}
                            style={{ width: "100%", height: "100%", borderRadius: 6 }}
                            contentFit="cover"
                          />
                        ) : (
                          <View style={{ width: "100%", height: "100%", borderRadius: 6, backgroundColor: "#1E293B", alignItems: "center", justifyContent: "center" }}>
                            <Layers size={16} color="#94A3B8" />
                          </View>
                        )}
                        <Pressable style={s.albumThumbRemove} onPress={() => onRemoveLinkedVideo(video.id)} hitSlop={6}>
                          <CircleX size={16} color="#fff" fill="#DC2626" />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                </View>
              )}
              {newAlbumVideos.length > 0 && (
                <View>
                  <Text style={[s.photoSectionLabel, { color: "#2EC4B6" }]}>추가할 영상 ({newAlbumVideos.length}개)</Text>
                  <View style={s.albumPreviewRow}>
                    {newAlbumVideos.map(video => (
                      <View key={video.id} style={s.albumThumb}>
                        {video.thumbnail_presigned_url ? (
                          <ExpoImage
                            source={{ uri: video.thumbnail_presigned_url }}
                            style={{ width: "100%", height: "100%", borderRadius: 6 }}
                            contentFit="cover"
                          />
                        ) : (
                          <View style={{ width: "100%", height: "100%", borderRadius: 6, backgroundColor: "#1E293B", alignItems: "center", justifyContent: "center" }}>
                            <Layers size={16} color="#94A3B8" />
                          </View>
                        )}
                        <Pressable style={s.albumThumbRemove} onPress={() => onRemoveNewAlbumVideo(video.id)} hitSlop={6}>
                          <CircleX size={16} color="#fff" fill="#374151" />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          )}

          <Pressable style={s.albumPickerBtn} onPress={onOpenAlbumPicker}>
            <Images size={14} color="#3B82F6" />
            <Text style={s.albumPickerBtnText}>앨범에서 선택</Text>
          </Pressable>
        </View>

        <View style={[s.card, { backgroundColor: C.card }]}>
          <View style={s.cardHeader}>
            <View style={[s.cardIcon, { backgroundColor: "#8B5CF620" }]}>
              <Users size={15} color="#8B5CF6" />
            </View>
            <Text style={[s.cardTitle, { color: C.text }]}>학생별 추가 일지</Text>
            <Text style={s.cardSub}>개별 코멘트 수정</Text>
          </View>

          {activeNotes.map(note => {
            const st: StudentOption = { id: note.student_id, name: note.student_name };
            const stPhotos = studentAlbumPhotos[note.student_id] ?? [];
            const stVideos = studentAlbumVideos[note.student_id] ?? [];
            return (
              <View key={note.id} style={[s.editNoteItem, { backgroundColor: "#EEDDF5", borderColor: "#C4B5FD" }]}>
                <View style={s.editNoteHeader}>
                  <Text style={s.noteName}>{note.student_name}</Text>
                  <Pressable onPress={() => onMarkNoteDeleted(note.id)}>
                    <Trash2 size={15} color={C.error} />
                  </Pressable>
                </View>
                <TextInput style={[s.noteTextarea, { borderColor: "#C4B5FD", color: C.text }]}
                  value={note.note_content}
                  onChangeText={t => onUpdateNoteContent(note.id, t)}
                  multiline numberOfLines={3} textAlignVertical="top"
                  placeholder="개별 코멘트를 입력하세요" placeholderTextColor={C.textMuted} />
                <View style={s.mediaRow}>
                  <Pressable style={[s.mediaBtn, { backgroundColor: "#EFF6FF" }]} onPress={() => onOpenStudentAlbumPicker(st)}>
                    <Images size={13} color="#3B82F6" /><Text style={[s.mediaBtnText, { color: "#3B82F6" }]}>앨범에서 선택</Text>
                  </Pressable>
                </View>
                {(stPhotos.length > 0 || stVideos.length > 0) && (
                  <View style={s.albumPreviewRow}>
                    {stPhotos.map(photo => (
                      <View key={photo.id} style={s.albumThumb}>
                        <ExpoImage source={{ uri: photo.presigned_url ?? `${API_BASE.replace(/\/api$/, "")}${photo.file_url}?token=${token}` }} style={{ width: "100%", height: "100%", borderRadius: 6 }} contentFit="cover" />
                        <Pressable style={s.albumThumbRemove} onPress={() => onRemoveStudentAlbumPhoto(note.student_id, photo.id)} hitSlop={6}>
                          <CircleX size={16} color="#fff" fill="#374151" />
                        </Pressable>
                      </View>
                    ))}
                    {stVideos.map(video => (
                      <View key={video.id} style={s.albumThumb}>
                        {video.thumbnail_presigned_url ? (
                          <ExpoImage source={{ uri: video.thumbnail_presigned_url }} style={{ width: "100%", height: "100%", borderRadius: 6 }} contentFit="cover" />
                        ) : (
                          <View style={{ width: "100%", height: "100%", borderRadius: 6, backgroundColor: "#1E293B", alignItems: "center", justifyContent: "center" }}>
                            <Layers size={16} color="#94A3B8" />
                          </View>
                        )}
                        <Pressable style={s.albumThumbRemove} onPress={() => onRemoveStudentAlbumVideo(note.student_id, video.id)} hitSlop={6}>
                          <CircleX size={16} color="#fff" fill="#374151" />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}

          {editNewNotes.map((note, idx) => {
            const st: StudentOption = { id: note.student_id, name: note.student_name };
            const stPhotos = studentAlbumPhotos[note.student_id] ?? [];
            const stVideos = studentAlbumVideos[note.student_id] ?? [];
            return (
              <View key={idx} style={[s.editNoteItem, { backgroundColor: "#DFF3EC", borderColor: "#6EE7B7" }]}>
                <View style={s.editNoteHeader}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <View style={[s.statusBadge, { backgroundColor: "#E6FFFA" }]}>
                      <Text style={[s.statusBadgeText, { color: "#2EC4B6" }]}>신규</Text>
                    </View>
                    <Text style={[s.noteName, { color: "#2EC4B6" }]}>{note.student_name}</Text>
                  </View>
                  <Pressable onPress={() => onRemoveNewNote(idx)}>
                    <CircleX size={15} color={C.error} />
                  </Pressable>
                </View>
                <Text style={[s.noteContent, { color: C.text }]}>{note.note_content}</Text>
                <View style={s.mediaRow}>
                  <Pressable style={[s.mediaBtn, { backgroundColor: "#EFF6FF" }]} onPress={() => onOpenStudentAlbumPicker(st)}>
                    <Images size={13} color="#3B82F6" /><Text style={[s.mediaBtnText, { color: "#3B82F6" }]}>앨범에서 선택</Text>
                  </Pressable>
                </View>
                {(stPhotos.length > 0 || stVideos.length > 0) && (
                  <View style={s.albumPreviewRow}>
                    {stPhotos.map(photo => (
                      <View key={photo.id} style={s.albumThumb}>
                        <ExpoImage source={{ uri: photo.presigned_url ?? `${API_BASE.replace(/\/api$/, "")}${photo.file_url}?token=${token}` }} style={{ width: "100%", height: "100%", borderRadius: 6 }} contentFit="cover" />
                        <Pressable style={s.albumThumbRemove} onPress={() => onRemoveStudentAlbumPhoto(note.student_id, photo.id)} hitSlop={6}>
                          <CircleX size={16} color="#fff" fill="#374151" />
                        </Pressable>
                      </View>
                    ))}
                    {stVideos.map(video => (
                      <View key={video.id} style={s.albumThumb}>
                        {video.thumbnail_presigned_url ? (
                          <ExpoImage source={{ uri: video.thumbnail_presigned_url }} style={{ width: "100%", height: "100%", borderRadius: 6 }} contentFit="cover" />
                        ) : (
                          <View style={{ width: "100%", height: "100%", borderRadius: 6, backgroundColor: "#1E293B", alignItems: "center", justifyContent: "center" }}>
                            <Layers size={16} color="#94A3B8" />
                          </View>
                        )}
                        <Pressable style={s.albumThumbRemove} onPress={() => onRemoveStudentAlbumVideo(note.student_id, video.id)} hitSlop={6}>
                          <CircleX size={16} color="#fff" fill="#374151" />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}

          {classStudents.length === 0 ? (
            <View style={[s.emptyStudents, { backgroundColor: C.background, borderColor: C.border }]}>
              <Users size={16} color={C.textMuted} />
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
                      <CirclePlus size={15} color={editAddStudent?.id === st.id ? "#8B5CF6" : C.textMuted} />
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
                      <Text style={{ color: C.textSecondary, fontFamily: "Pretendard-Regular", fontSize: 13 }}>취소</Text>
                    </Pressable>
                    <Pressable style={[s.noteBtn, { backgroundColor: "#8B5CF6", borderColor: "#8B5CF6", flex: 1 }]} onPress={onEditAddNote} disabled={!editAddInput.trim()}>
                      <Text style={{ color: "#fff", fontFamily: "Pretendard-Regular", fontSize: 13 }}>추가</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </>
          )}
        </View>

        <View style={[s.footer, { paddingBottom: insets.bottom }]}>
          {editError && (
            <View style={[s.inlineError, { backgroundColor: "#F9DEDA" }]}>
              <CircleAlert size={13} color={C.error} />
              <Text style={[s.inlineErrorText, { color: C.error }]}>{editError}</Text>
            </View>
          )}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable style={[s.cancelBtnFt, { borderColor: C.border }]} onPress={onBack}>
              <Text style={[s.cancelBtnFtText, { color: C.textSecondary }]}>취소</Text>
            </Pressable>
            <Pressable style={[s.saveBtn, { backgroundColor: themeColor, opacity: editSaving ? 0.5 : 1, flex: 2 }]}
              onPress={onSave} disabled={editSaving}>
              {editSaving ? <ActivityIndicator color="#fff" size="small" /> : <><Save size={16} color="#fff" /><Text style={s.saveBtnText}>저장</Text></>}
            </Pressable>
          </View>
        </View>

      </KeyboardAwareScrollView>

      <SentencePicker
        visible={editPickerFor !== null}
        onClose={() => setEditPickerFor(null)}
        onInsert={text => {
          if (editPickerFor === "common") {
            setEditContent(editContent.trim() ? `${editContent.trim()}\n\n${text}` : text);
          }
          setEditPickerFor(null);
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  form:          { padding: 14, gap: 14, paddingBottom: 8 },
  infoCard:      { borderRadius: 14, borderWidth: 1.5, padding: 14, gap: 8 },
  infoCardRow:   { flexDirection: "row", alignItems: "center", gap: 8 },
  infoCardText:  { fontSize: 13, fontFamily: "Pretendard-Regular" },
  card:          { borderRadius: 16, padding: 14, gap: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  cardHeader:    { flexDirection: "row", alignItems: "center", gap: 8 },
  cardIcon:      { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  cardTitle:     { fontSize: 14, fontFamily: "Pretendard-Regular", flex: 1 },
  cardSub:       { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
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
  editNoteItem:  { borderRadius: 12, borderWidth: 1.5, padding: 12, gap: 8 },
  editNoteHeader:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  noteName:      { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#7C3AED" },
  noteContent:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A", lineHeight: 18 },
  noteInput:     { borderRadius: 12, borderWidth: 1.5, padding: 12, gap: 4 },
  noteTextarea:  { borderWidth: 1.5, borderRadius: 10, padding: 10, fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 20, minHeight: 80, textAlignVertical: "top", backgroundColor: "#fff" },
  noteBtn:       { flex: 1, height: 38, borderRadius: 10, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  statusBadge:   { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  statusBadgeText: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  footer:        { gap: 8, padding: 12, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  cancelBtnFt:   { flex: 1, height: 50, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  cancelBtnFtText: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  saveBtn:       { flexDirection: "row", height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", gap: 8 },
  saveBtnText:   { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" },
  inlineError:   { flexDirection: "row", alignItems: "center", gap: 6, padding: 10, borderRadius: 10 },
  inlineErrorText: { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", lineHeight: 17 },
  mediaRow:      { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  mediaBtn:      { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16 },
  mediaBtnText:  { fontSize: 11, fontFamily: "Pretendard-Regular" },
  photoSection:  { gap: 10 },
  photoSectionLabel: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", marginBottom: 6 },
  albumPreviewRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  albumThumb:    { width: 56, height: 56, borderRadius: 8, overflow: "hidden", backgroundColor: "#F1F5F9" },
  albumThumbRemove: { position: "absolute", top: 2, right: 2 },
  albumPickerBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: "#EFF6FF", alignSelf: "flex-start", marginTop: 4 },
  albumPickerBtnText: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#3B82F6" },
});
