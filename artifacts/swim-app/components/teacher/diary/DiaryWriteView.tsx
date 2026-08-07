import { LucideIcon } from "@/components/common/LucideIcon";
import React, { MutableRefObject, useState } from "react";
import DiaryAIButton from "@/components/ai/features/diary/DiaryAIButton";
import type { DiaryInsertResult } from "@/components/ai/features/diary/useDiaryAI";
import {
  ActivityIndicator, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image as ExpoImage } from "expo-image";
import Colors from "@/constants/colors";
import SentencePicker from "@/components/teacher/SentencePicker";
import { AlbumPhotoInfo, AlbumVideoInfo, StudentNote, StudentOption, UploadedMedia } from "./types";
import { API_BASE } from "@/context/AuthContext";
import { TeacherClassGroup } from "@/components/teacher/types";

const C = Colors.light;

export default function DiaryWriteView({
  group, targetDate, themeColor, myDiaryExists,

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
  onOpenStudentAlbumPicker, studentAlbumPhotos, onRemoveStudentAlbumPhoto,
  studentAlbumVideos, onRemoveStudentAlbumVideo,
  onOpenGroupMyAlbum, onOpenStudentMyAlbum, videoEnabled,
  poolId, teacherId, onAIInsert,
}: {
  group: TeacherClassGroup; targetDate: string; themeColor: string; myDiaryExists: boolean;

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
  onOpenStudentAlbumPicker: (student: StudentOption) => void;
  studentAlbumPhotos: Record<string, AlbumPhotoInfo[]>;
  onRemoveStudentAlbumPhoto: (studentId: string, photoId: string) => void;
  studentAlbumVideos: Record<string, AlbumVideoInfo[]>;
  onRemoveStudentAlbumVideo: (studentId: string, videoId: string) => void;
  onOpenGroupMyAlbum: (kind: "photo" | "video") => void;
  onOpenStudentMyAlbum: (student: StudentOption, kind: "photo" | "video") => void;
  videoEnabled: boolean;
  // AI 연결
  poolId?: string;
  teacherId?: string;
  onAIInsert?: (result: DiaryInsertResult) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1 }}>
      <KeyboardAwareScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} keyboardDismissMode="interactive" bottomOffset={90}>

        {myDiaryExists && (
          <View style={[s.infoBox, { backgroundColor: "#FFF1BF" }]}>
            <LucideIcon name="alert-circle" size={13} color="#D97706" />
            <Text style={s.infoText}>오늘 이미 일지가 작성되어 있습니다. 수정은 "지난 일지"에서 할 수 있습니다.</Text>
          </View>
        )}

        <View style={[s.card, { backgroundColor: C.card }]}>
          <View style={s.cardHeader}>
            <View style={[s.cardIcon, { backgroundColor: themeColor + "20" }]}>
              <LucideIcon name="book-open" size={15} color={themeColor} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.cardTitle, { color: C.text }]}>반 공통 일지</Text>
              <Text style={s.cardSub}>모든 학생에게 공통으로 보이는 내용</Text>
            </View>
            {onAIInsert && (
              <DiaryAIButton
                token={token}
                teacherId={teacherId}
                classId={group.id}
                date={targetDate}
                students={classStudents}
                poolId={poolId}
                themeColor={themeColor}
                existingContent={commonContent}
                onInsert={onAIInsert}
              />
            )}
          </View>

          <TextInput style={[s.textarea, { borderColor: C.border, color: C.text }]}
            value={commonContent} onChangeText={setCommonContent}
            onSelectionChange={e => { commonCursorRef.current = e.nativeEvent.selection.start; }}
            placeholder="오늘 수업 내용을 입력하세요.\n(모든 학생 학부모에게 공통으로 노출됩니다)"
            placeholderTextColor={C.textMuted} multiline numberOfLines={6} textAlignVertical="top" />
          <View style={s.textareaFooter}>
            <Text style={s.charCount}>{commonContent.length}자</Text>
            <TouchableOpacity style={s.sentencePickBtn} onPress={() => setShowPickerFor("common")} activeOpacity={0.7}>
              <LucideIcon name="book-open" size={13} color={C.tint} />
              <Text style={s.sentencePickBtnText}>템플릿선택</Text>
            </TouchableOpacity>
          </View>

          <View style={s.mediaRow}>
            <Pressable style={[s.mediaBtn, { backgroundColor: "#EFF6FF" }]} onPress={onOpenAlbumPicker}>
              <LucideIcon name="image" size={14} color="#3B82F6" /><Text style={[s.mediaBtnText, { color: "#3B82F6" }]}>앨범에서 선택</Text>
            </Pressable>
            <Pressable style={[s.mediaBtn, { backgroundColor: "#FFEDD5" }]} onPress={() => onOpenGroupMyAlbum("photo")}>
              <LucideIcon name="image" size={14} color="#C2410C" /><Text style={[s.mediaBtnText, { color: "#C2410C" }]}>내 사진앨범</Text>
            </Pressable>
            <Pressable style={[s.mediaBtn, { backgroundColor: "#EDE9FE" }]} onPress={() => onOpenGroupMyAlbum("video")}>
              <LucideIcon name="video" size={14} color="#5B21B6" /><Text style={[s.mediaBtnText, { color: "#5B21B6" }]}>내 영상앨범</Text>
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
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.albumPreviewRow} alwaysBounceHorizontal={false}>
                    {selectedAlbumPhotos.map(photo => (
                      <View key={photo.id} style={s.albumThumb}>
                        <ExpoImage
                          source={{ uri: photo.presigned_url ?? `${API_BASE.replace(/\/api$/, "")}${photo.file_url}?token=${token}` }}
                          style={{ width: "100%", height: "100%", borderRadius: 6 }}
                          contentFit="cover"
                        />
                        <Pressable style={s.albumThumbRemove} onPress={() => onRemoveAlbumPhoto(photo.id)} hitSlop={6}>
                          <LucideIcon name="x-circle" size={16} color="#fff" fill="#374151" />
                        </Pressable>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              )}
              {selectedAlbumVideos.length > 0 && (
                <View>
                  <Text style={[s.albumLabel, { color: "#2EC4B6" }]}>첨부 영상 {selectedAlbumVideos.length}개</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.albumPreviewRow} alwaysBounceHorizontal={false}>
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
                            <LucideIcon name="video" size={18} color="#94A3B8" />
                          </View>
                        )}
                        <View style={{ position: "absolute", bottom: 3, left: 3, width: 16, height: 16, borderRadius: 8, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" }}>
                          <LucideIcon name="video" size={8} color="#fff" />
                        </View>
                        <Pressable style={s.albumThumbRemove} onPress={() => onRemoveAlbumVideo(video.id)} hitSlop={6}>
                          <LucideIcon name="x-circle" size={16} color="#fff" fill="#374151" />
                        </Pressable>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>
          )}
        </View>

        <View style={[s.card, { backgroundColor: C.card }]}>
          <View style={s.cardHeader}>
            <View style={[s.cardIcon, { backgroundColor: "#8B5CF620" }]}>
              <LucideIcon name="user" size={15} color="#8B5CF6" />
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
                      <LucideIcon name="x-circle" size={18} color={C.textMuted} />
                    </Pressable>
                  </View>
                  <Text style={s.noteContent}>{note.note_content}</Text>
                  <View style={[s.mediaRow, { marginTop: 4 }]}>
                    <Pressable style={[s.mediaBtn, { backgroundColor: "#EFF6FF" }]} onPress={() => onOpenStudentAlbumPicker(st)}>
                      <LucideIcon name="image" size={13} color="#3B82F6" /><Text style={[s.mediaBtnText, { color: "#3B82F6" }]}>앨범에서 선택</Text>
                    </Pressable>
                    <Pressable style={[s.mediaBtn, { backgroundColor: "#FFEDD5" }]} onPress={() => onOpenStudentMyAlbum(st, "photo")}>
                      <LucideIcon name="image" size={13} color="#C2410C" /><Text style={[s.mediaBtnText, { color: "#C2410C" }]}>내 사진앨범</Text>
                    </Pressable>
                    <Pressable style={[s.mediaBtn, { backgroundColor: "#EDE9FE" }]} onPress={() => onOpenStudentMyAlbum(st, "video")}>
                      <LucideIcon name="video" size={13} color="#5B21B6" /><Text style={[s.mediaBtnText, { color: "#5B21B6" }]}>내 영상앨범</Text>
                    </Pressable>
                  </View>
                  {stMedia.length > 0 && (
                    <View style={s.mediaPreviewRow}>
                      {stMedia.map((m, i) => (
                        <View key={i} style={s.mediaThumb}>
                          {m.uri && m.kind === "photo" ? (
                            <ExpoImage source={{ uri: m.uri }} style={{ width: "100%", height: "100%", borderRadius: 8 }} contentFit="cover" />
                          ) : (
                            <LucideIcon name={m.uploaded ? "check-circle" : m.error ? "alert-circle" : (m.kind === "photo" ? "image" : "video")} size={16}
                              color={m.uploaded ? "#2EC4B6" : m.error ? "#D96C6C" : "#7C3AED"} />
                          )}
                          {m.uploading && <ActivityIndicator size="small" color="#7C3AED" style={{ position: "absolute" }} />}
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
              <LucideIcon name="users" size={16} color={C.textMuted} />
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
                  <LucideIcon name="plus-circle" size={15} color={addNoteStudent?.id === st.id ? "#8B5CF6" : C.textMuted} />
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
                placeholderTextColor={C.textMuted} multiline scrollEnabled={false} textAlignVertical="top" autoFocus />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                <TouchableOpacity style={[s.sentencePickBtn]} onPress={() => setShowPickerFor("note")} activeOpacity={0.7}>
                  <LucideIcon name="book-open" size={12} color="#8B5CF6" />
                  <Text style={[s.sentencePickBtnText, { color: "#8B5CF6" }]}>템플릿</Text>
                </TouchableOpacity>
                <Pressable
                  style={[s.mediaBtn, { backgroundColor: "#EFF6FF" }]}
                  onPress={() => onOpenStudentAlbumPicker(addNoteStudent)}
                >
                  <LucideIcon name="image" size={12} color="#3B82F6" />
                  <Text style={[s.mediaBtnText, { color: "#3B82F6" }]}>앨범선택</Text>
                </Pressable>
                <Pressable
                  style={[s.mediaBtn, { backgroundColor: "#FFEDD5" }]}
                  onPress={() => onOpenStudentMyAlbum(addNoteStudent, "photo")}
                >
                  <LucideIcon name="image" size={12} color="#C2410C" />
                  <Text style={[s.mediaBtnText, { color: "#C2410C" }]}>내 사진앨범</Text>
                </Pressable>
                <Pressable
                  style={[s.mediaBtn, { backgroundColor: "#EDE9FE" }]}
                  onPress={() => onOpenStudentMyAlbum(addNoteStudent, "video")}
                >
                  <LucideIcon name="video" size={12} color="#5B21B6" />
                  <Text style={[s.mediaBtnText, { color: "#5B21B6" }]}>내 영상앨범</Text>
                </Pressable>
              </View>
              {((studentAlbumPhotos[addNoteStudent.id] ?? []).length > 0 || (studentAlbumVideos[addNoteStudent.id] ?? []).length > 0) && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} alwaysBounceHorizontal={false} contentContainerStyle={[s.mediaPreviewRow, { marginTop: 6 }]}>
                  {(studentAlbumPhotos[addNoteStudent.id] ?? []).map((p) => (
                    <Pressable key={p.id} style={s.mediaThumb} onPress={() => onRemoveStudentAlbumPhoto(addNoteStudent.id, p.id)}>
                      <ExpoImage source={{ uri: p.presigned_url || p.file_url }} style={{ width: "100%", height: "100%", borderRadius: 8 }} contentFit="cover" />
                      <View style={{ position: "absolute", top: 2, right: 2, backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 8 }}>
                        <LucideIcon name="x-circle" size={14} color="#fff" />
                      </View>
                    </Pressable>
                  ))}
                  {(studentAlbumVideos[addNoteStudent.id] ?? []).map((v) => (
                    <Pressable key={v.id} style={s.mediaThumb} onPress={() => onRemoveStudentAlbumVideo(addNoteStudent.id, v.id)}>
                      {v.thumbnail_presigned_url ? (
                        <ExpoImage source={{ uri: v.thumbnail_presigned_url }} style={{ width: "100%", height: "100%", borderRadius: 8 }} contentFit="cover" />
                      ) : (
                        <View style={{ width: "100%", height: "100%", borderRadius: 8, backgroundColor: "#1E293B", alignItems: "center", justifyContent: "center" }}>
                          <LucideIcon name="video" size={14} color="#94A3B8" />
                        </View>
                      )}
                      <View style={{ position: "absolute", top: 2, right: 2, backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 8 }}>
                        <LucideIcon name="x-circle" size={14} color="#fff" />
                      </View>
                    </Pressable>
                  ))}
                </ScrollView>
              )}
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

        <View style={[s.footer, { paddingBottom: insets.bottom }]}>
          {formError && (
            <View style={[s.inlineError, { backgroundColor: "#F9DEDA" }]}>
              <LucideIcon name="alert-circle" size={13} color={C.error} />
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
              onPress={() => {
                console.log(`[PRESS SAVE] timestamp=${new Date().toISOString()}`);
                onSave();
              }} disabled={saving || myDiaryExists}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <><LucideIcon name="save" size={16} color="#fff" /><Text style={s.saveBtnText}>저장</Text></>}
            </Pressable>
          </View>
        </View>

      </KeyboardAwareScrollView>

      <SentencePicker
        visible={showPickerFor === "common" || showPickerFor === "note"}
        onClose={() => setShowPickerFor(null)}
        onInsert={text => {
          if (showPickerFor === "common") {
            setCommonContent(commonContent.trim() ? `${commonContent.trim()}\n\n${text}` : text);
          } else if (showPickerFor === "note") {
            setNoteInput(noteInput.trim() ? `${noteInput.trim()}\n\n${text}` : text);
          }
          setShowPickerFor(null);
        }}
      />

    </View>
  );
}

export const s = StyleSheet.create({
  form:          { padding: 14, gap: 14, paddingBottom: 8 },
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
  noteTextarea:  { borderWidth: 1.5, borderRadius: 10, padding: 10, fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 20, minHeight: 130, textAlignVertical: "top", backgroundColor: "#fff" },
  noteBtn:       { flex: 1, height: 38, borderRadius: 10, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  mediaRow:      { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  mediaBtn:      { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 20 },
  mediaBtnText:  { fontSize: 11, fontFamily: "Pretendard-Regular" },
  mediaPreviewRow: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 4 },
  mediaThumb:    { width: 36, height: 36, borderRadius: 8, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  albumLabel:    { fontSize: 11, fontFamily: "Pretendard-Regular", marginBottom: 6 },
  albumPreviewRow: { flexDirection: "row", gap: 6 },
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
  tabBtnText:    { fontSize: 12, lineHeight: 17 },
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

