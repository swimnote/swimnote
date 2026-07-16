import AsyncStorage from "@react-native-async-storage/async-storage";
import { LucideIcon } from "@/components/common/LucideIcon";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import { Calendar, Check, ChevronRight, CirclePlus, CircleStop, FileText, Mic, Pencil, Plus, Trash2, User, Users, X } from "lucide-react-native";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Colors from "@/constants/colors";
import { apiRequest } from "@/context/AuthContext";
import { TeacherClassGroup } from "@/components/teacher/types";
import {
  classColor, dateLabelFull, getKoDay, parseHour, StudentItem,
} from "./utils";

interface PendingMakeup {
  id: string;
  student_id: string;
  student_name: string;
  absence_date: string;
  original_class_group_name: string | null;
}

const C = Colors.light;

type AudioItem = { uri: string; createdAt: string };

export default function DaySheet({
  dateStr, classes, allClasses, attMap, diarySet, themeColor, poolId,
  memo, onMemoChange, onSaveMemo,
  onClose, onSelectClass,
  onOpenMakeup, onAddClass,
  isAdminTeacher, allStudents, token, isHoliday,
}: {
  dateStr: string;
  classes: TeacherClassGroup[];
  allClasses?: TeacherClassGroup[];
  attMap: Record<string, number>;
  diarySet: Set<string>;
  themeColor: string;
  poolId: string;
  memo: string;
  onMemoChange: (v: string) => void;
  onSaveMemo: () => void;
  onClose: () => void;
  onSelectClass: (g: TeacherClassGroup) => void;
  onOpenMakeup: () => void;
  onAddClass: () => void;
  isAdminTeacher?: boolean;
  allStudents?: StudentItem[];
  token?: string | null;
  isHoliday?: boolean;
}) {
  const [editingMemo, setEditingMemo] = useState(false);
  const [showMemoPanel, setShowMemoPanel] = useState(false);
  const [rosterClass, setRosterClass] = useState<TeacherClassGroup | null>(null);
  const label = dateLabelFull(dateStr);

  const [showMakeupPicker,       setShowMakeupPicker]       = useState(false);
  const [makeupList,             setMakeupList]             = useState<PendingMakeup[]>([]);
  const [makeupLoading,          setMakeupLoading]          = useState(false);
  const [makeupSaving,           setMakeupSaving]           = useState<string | null>(null);
  // 2단계 선택: null = 1단계(학생선택), not null = 2단계(반선택)
  const [selectedMakeupStudent,  setSelectedMakeupStudent]  = useState<PendingMakeup | null>(null);

  async function openMakeupPicker() {
    setSelectedMakeupStudent(null);
    setShowMakeupPicker(true);
    setMakeupLoading(true);
    try {
      const res = await apiRequest(token ?? null, "/teacher/makeups?status=pending");
      if (res.ok) setMakeupList(await res.json());
    } catch {}
    finally { setMakeupLoading(false); }
  }

  async function completeMakeupWithClass(mk: PendingMakeup, classGroup: TeacherClassGroup) {
    if (makeupSaving) return;
    setMakeupSaving(mk.id);
    try {
      const assignRes = await apiRequest(token ?? null, `/teacher/makeups/${mk.id}/assign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class_group_id: classGroup.id, assigned_date: dateStr }),
      });
      if (!assignRes.ok) {
        const body = await assignRes.json().catch(() => ({}));
        Alert.alert("처리 실패", body?.error || "보충수업 배정 중 오류가 발생했습니다.");
        return;
      }
      const completeRes = await apiRequest(token ?? null, `/admin/makeups/${mk.id}/complete`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (completeRes.ok) {
        setMakeupList(prev => prev.filter(m => m.id !== mk.id));
        setSelectedMakeupStudent(null);
        setShowMakeupPicker(false);
      } else {
        const body = await completeRes.json().catch(() => ({}));
        Alert.alert("처리 실패", body?.error || "보충수업 처리 중 오류가 발생했습니다. 다시 시도해주세요.");
      }
    } catch {
      Alert.alert("오류", "네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    }
    finally { setMakeupSaving(null); }
  }

  const [isRecording, setIsRecording] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [audioList, setAudioList] = useState<AudioItem[]>([]);
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [playingUri, setPlayingUri] = useState<string | null>(null);

  const AUDIO_LIST_KEY = `scheduleAudioList_${poolId}_${dateStr}`;

  useEffect(() => {
    AsyncStorage.getItem(AUDIO_LIST_KEY)
      .then(raw => setAudioList(raw ? JSON.parse(raw) : []))
      .catch(() => setAudioList([]));
    return () => { sound?.unloadAsync().catch(() => {}); };
  }, [dateStr, poolId]);

  async function saveAudioList(list: AudioItem[]) {
    setAudioList(list);
    await AsyncStorage.setItem(AUDIO_LIST_KEY, JSON.stringify(list)).catch(() => {});
  }

  async function startRecording() {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) return;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      setRecording(rec);
      setIsRecording(true);
    } catch {}
  }

  async function stopAndSaveRecording() {
    if (!recording) return;
    setIsRecording(false);
    let tempUri: string | null = null;
    try {
      await recording.stopAndUnloadAsync();
      tempUri = recording.getURI();
    } catch {}
    setRecording(null);
    if (!tempUri) return;

    const ts = Date.now();
    let finalUri = tempUri;
    try {
      if (FileSystem.documentDirectory) {
        const dest = `${FileSystem.documentDirectory}scheduleAudio_${poolId}_${dateStr}_${ts}.m4a`;
        await FileSystem.copyAsync({ from: tempUri, to: dest });
        finalUri = dest;
      }
    } catch {}

    const newItem: AudioItem = { uri: finalUri, createdAt: new Date(ts).toISOString() };
    await saveAudioList([...audioList, newItem]);
  }

  async function playAudio(uri: string) {
    try {
      if (sound) { await sound.unloadAsync(); setSound(null); setPlayingUri(null); }
      if (playingUri === uri) return;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const { sound: s } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
      setSound(s); setPlayingUri(uri);
      s.setOnPlaybackStatusUpdate(status => {
        if ("didJustFinish" in status && status.didJustFinish) {
          setPlayingUri(null); setSound(null);
        }
      });
    } catch {}
  }

  async function deleteAudioItem(uri: string) {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    if (playingUri === uri) {
      await sound?.unloadAsync().catch(() => {}); setSound(null); setPlayingUri(null);
    }
    await saveAudioList(audioList.filter(a => a.uri !== uri));
  }

  return (
    <>
    <Modal visible animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={dy.backdrop} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ width: "100%" }}
        >
        <Pressable style={dy.sheet} onPress={() => {}}>
          <View style={dy.handle} />

          <View style={dy.header}>
            <View style={{ flex: 1 }}>
              <Text style={dy.dateTitle}>{label}</Text>
              <Text style={dy.dateSub}>{isHoliday ? "휴무일" : classes.length > 0 ? `수업 ${classes.length}개` : "수업 없음"}</Text>
            </View>
            <View style={dy.headerActions}>
              <Pressable style={dy.iconBtnWrap} onPress={() => setShowMemoPanel(p => !p)}>
                <FileText size={20} color={memo ? "#D97706" : C.textSecondary} />
                {(memo && memo.trim()) ? <View style={dy.redDot} /> : null}
              </Pressable>
              <Pressable style={dy.iconBtnWrap} onPress={isRecording ? stopAndSaveRecording : startRecording}>
                <Mic size={20} color={isRecording ? "#D96C6C" : (audioList.length > 0 ? "#4338CA" : C.textSecondary)} />
                {(audioList.length > 0 && !isRecording) ? <View style={[dy.redDot, { backgroundColor: "#4338CA" }]} /> : null}
              </Pressable>
              <Pressable style={[dy.headerBtn, { backgroundColor: "#EEF2FF", borderWidth: 1, borderColor: "#C7D2FE" }]} onPress={onOpenMakeup}>
                <Users size={13} color="#4F46E5" />
                <Text style={[dy.headerBtnTxt, { color: "#4F46E5" }]}>보충수업</Text>
              </Pressable>
              <Pressable style={[dy.headerBtn, { backgroundColor: C.tint }]} onPress={onAddClass}>
                <Plus size={13} color="#fff" />
                <Text style={[dy.headerBtnTxt, { color: "#fff" }]}>수업 추가</Text>
              </Pressable>
              <Pressable onPress={onClose} style={dy.closeBtn}>
                <X size={20} color={C.textSecondary} />
              </Pressable>
            </View>
          </View>

          <KeyboardAwareScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={{ flexShrink: 1 }}
            contentContainerStyle={{ paddingBottom: 120 }}
            bottomOffset={20}
          >

            {isHoliday && (
              <View style={dy.emptyBox}>
                <Text style={{ fontSize: 32, marginBottom: 8 }}>🏖️</Text>
                <Text style={[dy.emptyTxt, { color: "#D96C6C" }]}>휴무일</Text>
                <Text style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>이 날은 수업이 없습니다</Text>
              </View>
            )}

            {!isHoliday && classes.length === 0 && (
              <View style={dy.emptyBox}>
                <Calendar size={32} color={C.textMuted} />
                <Text style={dy.emptyTxt}>이 날은 수업이 없습니다</Text>
                <Pressable style={[dy.emptyAction, { borderColor: C.tint }]}
                  onPress={() => { onClose(); setTimeout(onAddClass, 200); }}>
                  <CirclePlus size={13} color={C.tint} />
                  <Text style={[dy.emptyActionTxt, { color: C.tint }]}>수업 추가</Text>
                </Pressable>
              </View>
            )}

            {classes.length > 0 && (
              <View style={{ paddingHorizontal: 16, gap: 8, marginBottom: 12 }}>
                {classes.map(g => {
                  const diarDone = diarySet.has(g.id);
                  const attCnt   = attMap[g.id] || 0;
                  const done     = diarDone;
                  const color    = classColor(g.id, g.color);
                  const koDay    = getKoDay(dateStr);
                  const timeLabel = `${koDay}요일 ${g.schedule_time}`;
                  const capLabel  = g.capacity ? `${g.student_count}/${g.capacity}명` : `${g.student_count}명`;
                  return (
                    <Pressable key={g.id} style={[dy.classCard, done && dy.classCardDone]}
                      onPress={() => onSelectClass(g)}>
                      <View style={[dy.colorBar, { backgroundColor: color }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={[dy.classTime, done && dy.strikeText]}>{timeLabel}</Text>
                        <Text style={[dy.className, done && dy.strikeText]} numberOfLines={1}>{g.name}</Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                          <Text style={[dy.classSub, done && { color: C.textMuted }]}>{capLabel}</Text>
                          {attCnt > 0 && (
                            <View style={dy.attBadge}>
                              <Check size={9} color="#2EC4B6" />
                              <Text style={dy.attBadgeTxt}>출결 {attCnt}</Text>
                            </View>
                          )}
                          {diarDone && (
                            <View style={dy.diaryBadge}>
                              <Pencil size={9} color="#7C3AED" />
                              <Text style={dy.diaryBadgeTxt}>일지 완료</Text>
                            </View>
                          )}
                        </View>
                        {isAdminTeacher && g.instructor && (
                          <Pressable
                            style={dy.teacherChip}
                            onPress={(e) => { e.stopPropagation?.(); setRosterClass(g); }}
                            hitSlop={4}
                          >
                            <User size={10} color={themeColor} />
                            <Text style={[dy.teacherChipTxt, { color: themeColor }]}>{g.instructor}</Text>
                          </Pressable>
                        )}
                      </View>
                      <ChevronRight size={16} color={done ? C.textMuted : C.textSecondary} />
                    </Pressable>
                  );
                })}
              </View>
            )}

            {showMemoPanel && (
              <View style={dy.memoSection}>
                <View style={dy.memoHeader}>
                  <FileText size={14} color={C.textSecondary} />
                  <Text style={dy.memoLabel}>날짜 메모</Text>
                  {!editingMemo && (
                    <Pressable onPress={() => setEditingMemo(true)} style={dy.memoEditBtn}>
                      <Text style={[dy.memoEditBtnTxt, { color: C.tint }]}>
                        {memo ? "수정" : "추가"}
                      </Text>
                    </Pressable>
                  )}
                </View>
                {editingMemo ? (
                  <View style={dy.memoEditArea}>
                    <TextInput
                      style={dy.memoInput}
                      value={memo}
                      onChangeText={onMemoChange}
                      placeholder="학부모 요청, 행사, 준비물 등..."
                      placeholderTextColor={C.textMuted}
                      multiline
                      autoFocus
                    />
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                      <Pressable style={dy.memoCancelBtn} onPress={() => setEditingMemo(false)}>
                        <Text style={dy.memoCancelBtnTxt}>취소</Text>
                      </Pressable>
                      <Pressable style={[dy.memoSaveBtn, { backgroundColor: C.tint }]}
                        onPress={() => { onSaveMemo(); setEditingMemo(false); }}>
                        <Text style={dy.memoSaveBtnTxt}>저장</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : memo ? (
                  <Text style={dy.memoContent}>{memo}</Text>
                ) : (
                  <Text style={dy.memoEmpty}>메모 없음</Text>
                )}

                <View style={dy.audioDivider} />
                <View style={dy.audioRow}>
                  <Mic size={13} color={C.textSecondary} />
                  <Text style={dy.audioLabel}>음성 메모</Text>
                  <View style={{ flex: 1 }} />
                  {isRecording ? (
                    <Pressable style={[dy.audioBtn, { backgroundColor: "#F9DEDA" }]} onPress={stopAndSaveRecording}>
                      <CircleStop size={15} color="#D96C6C" />
                      <Text style={[dy.audioBtnTxt, { color: "#D96C6C" }]}>저장</Text>
                    </Pressable>
                  ) : (
                    <Pressable style={[dy.audioBtn, { backgroundColor: C.tintLight }]} onPress={startRecording}>
                      <Mic size={15} color={C.tint} />
                      <Text style={[dy.audioBtnTxt, { color: C.tint }]}>녹음</Text>
                    </Pressable>
                  )}
                </View>
                {isRecording && (
                  <View style={dy.recordingIndicator}>
                    <View style={dy.recordingDot} />
                    <Text style={dy.recordingTxt}>녹음 중... (저장을 눌러 완료)</Text>
                  </View>
                )}
                {audioList.length > 0 && (
                  <View style={dy.audioListBox}>
                    {audioList.map((item, idx) => {
                      const isThis = playingUri === item.uri;
                      const t = new Date(item.createdAt);
                      const timeLabel = `${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}`;
                      return (
                        <View key={item.uri} style={dy.audioListItem}>
                          <FileText size={13} color="#92400E" />
                          <Text style={dy.audioListLabel}>녹음 {idx + 1}  <Text style={dy.audioListTime}>{timeLabel}</Text></Text>
                          <View style={{ flex: 1 }} />
                          <Pressable
                            style={[dy.audioPlayBtn, isThis && { backgroundColor: C.tintLight }]}
                            onPress={() => playAudio(item.uri)}>
                            <LucideIcon name={isThis ? "volume-2" : "play"} size={14}
                              color={C.tint} />
                            <Text style={[dy.audioBtnTxt, { color: C.tint }]}>
                              {isThis ? "재생중" : "재생"}
                            </Text>
                          </Pressable>
                          <Pressable style={dy.audioDelBtn} onPress={() => deleteAudioItem(item.uri)}>
                            <Trash2 size={13} color="#D96C6C" />
                          </Pressable>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            )}
          </KeyboardAwareScrollView>
        </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>

    {/* 보충수업 모달 (2단계) */}
    {showMakeupPicker && (
      <Modal visible animationType="slide" transparent onRequestClose={() => { setShowMakeupPicker(false); setSelectedMakeupStudent(null); }}>
        <Pressable style={dy.backdrop} onPress={() => { setShowMakeupPicker(false); setSelectedMakeupStudent(null); }}>
          <Pressable style={[dy.sheet, { minHeight: "50%" }]} onPress={() => {}}>
            <View style={dy.handle} />

            {/* 단계 1: 보강 대기 학생 선택 */}
            {selectedMakeupStudent === null ? (
              <>
                <View style={[dy.header, { paddingBottom: 12 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={dy.dateTitle}>보충수업</Text>
                    <Text style={dy.dateSub}>보강 대기 학생을 선택하세요</Text>
                  </View>
                  <Pressable onPress={() => setShowMakeupPicker(false)} style={dy.closeBtn}>
                    <X size={20} color={C.textSecondary} />
                  </Pressable>
                </View>
                {makeupLoading ? (
                  <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 40 }}>
                    <ActivityIndicator color="#4F46E5" />
                  </View>
                ) : makeupList.length === 0 ? (
                  <View style={{ alignItems: "center", paddingVertical: 40, gap: 10 }}>
                    <Users size={32} color={C.textMuted} />
                    <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textMuted }}>보강 대기 중인 학생이 없습니다</Text>
                  </View>
                ) : (
                  <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
                    {makeupList.map((mk, idx) => (
                      <Pressable
                        key={`${mk.id}_${idx}`}
                        style={({ pressed }) => [dy.mkRow, idx < makeupList.length - 1 && dy.mkRowBorder, pressed && { opacity: 0.75 }]}
                        onPress={() => setSelectedMakeupStudent(mk)}
                        disabled={!!makeupSaving}
                      >
                        <View style={dy.mkBadge}>
                          <User size={14} color="#4F46E5" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={dy.mkName}>{mk.student_name}</Text>
                          <Text style={dy.mkSub}>결석일 {mk.absence_date}{mk.original_class_group_name ? ` · ${mk.original_class_group_name}` : ""}</Text>
                        </View>
                        <View style={dy.mkCheckBtn}>
                          <Text style={dy.mkCheckTxt}>반 선택 →</Text>
                        </View>
                      </Pressable>
                    ))}
                  </ScrollView>
                )}
              </>
            ) : (
              /* 단계 2: 반 선택 (전체 반 목록) */
              <>
                <View style={[dy.header, { paddingBottom: 12 }]}>
                  <Pressable onPress={() => setSelectedMakeupStudent(null)} style={{ padding: 4, marginRight: 8 }}>
                    <Text style={{ fontSize: 14, color: "#4F46E5", fontFamily: "Pretendard-Regular" }}>← 뒤로</Text>
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <Text style={dy.dateTitle}>{selectedMakeupStudent.student_name}</Text>
                    <Text style={dy.dateSub}>{label} · 합류할 반을 선택하세요</Text>
                  </View>
                  <Pressable onPress={() => { setShowMakeupPicker(false); setSelectedMakeupStudent(null); }} style={dy.closeBtn}>
                    <X size={20} color={C.textSecondary} />
                  </Pressable>
                </View>
                {(() => {
                  const pickList = (allClasses && allClasses.length > 0 ? allClasses : classes);
                  if (pickList.length === 0) {
                    return (
                      <View style={{ alignItems: "center", paddingVertical: 40, gap: 10 }}>
                        <Users size={32} color={C.textMuted} />
                        <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textMuted }}>등록된 수업반이 없습니다</Text>
                      </View>
                    );
                  }
                  return (
                    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
                      {pickList.map((cls, idx) => {
                        const isSaving = makeupSaving === selectedMakeupStudent.id;
                        const isToday = classes.some(c => c.id === cls.id);
                        return (
                          <Pressable
                            key={cls.id}
                            style={({ pressed }) => [dy.mkRow, idx < pickList.length - 1 && dy.mkRowBorder, pressed && { opacity: 0.75 }]}
                            onPress={() => completeMakeupWithClass(selectedMakeupStudent, cls)}
                            disabled={isSaving}
                          >
                            <View style={[dy.mkBadge, { backgroundColor: isToday ? "#F0FDF4" : "#F5F3FF" }]}>
                              <Check size={14} color={isToday ? "#16A34A" : "#7C3AED"} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={dy.mkName}>
                                {cls.name}
                                {isToday ? <Text style={{ fontSize: 11, color: "#16A34A", fontFamily: "Pretendard-Regular" }}> (오늘 수업)</Text> : null}
                              </Text>
                              <Text style={dy.mkSub}>{cls.schedule_days ? cls.schedule_days.split(",").join("·") : ""} {cls.schedule_time || ""}</Text>
                            </View>
                            {isSaving
                              ? <ActivityIndicator size="small" color="#4F46E5" />
                              : <View style={[dy.mkCheckBtn, { backgroundColor: "#EEF2FF" }]}>
                                  <Text style={[dy.mkCheckTxt, { color: "#4F46E5" }]}>배정</Text>
                                </View>
                            }
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  );
                })()}
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    )}

    {/* 학생 명단 모달 (관리자 선생님 전용) */}
    {rosterClass && (
      <Modal visible animationType="slide" transparent onRequestClose={() => setRosterClass(null)}>
        <Pressable style={dy.backdrop} onPress={() => setRosterClass(null)}>
          <Pressable style={[dy.sheet, { minHeight: "50%" }]} onPress={() => {}}>
            <View style={dy.handle} />
            <View style={[dy.header, { paddingBottom: 12 }]}>
              <View style={{ flex: 1 }}>
                <Text style={dy.dateTitle}>{rosterClass.name}</Text>
                <Text style={dy.dateSub}>
                  {rosterClass.instructor ? `담임: ${rosterClass.instructor}` : ""}{" "}
                  · 학생 {(() => {
                    const list = (allStudents ?? []).filter(s =>
                      (Array.isArray(s.assigned_class_ids) && s.assigned_class_ids.includes(rosterClass.id))
                      || s.class_group_id === rosterClass.id
                    );
                    return list.length;
                  })()}명
                </Text>
              </View>
              <Pressable onPress={() => setRosterClass(null)} style={dy.closeBtn}>
                <X size={20} color={C.textSecondary} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
              {(() => {
                const list = (allStudents ?? [])
                  .filter(s =>
                    (Array.isArray(s.assigned_class_ids) && s.assigned_class_ids.includes(rosterClass.id))
                    || s.class_group_id === rosterClass.id
                  )
                  .slice(0, 100);
                if (list.length === 0) {
                  return (
                    <View style={{ alignItems: "center", paddingVertical: 40, gap: 8 }}>
                      <User size={32} color={C.textMuted} />
                      <Text style={{ fontSize: 13, color: C.textMuted }}>배정된 학생이 없습니다</Text>
                    </View>
                  );
                }
                return list.map((s, idx) => (
                  <Pressable
                    key={s.id}
                    style={[dy.rosterRow, idx < list.length - 1 && dy.rosterRowBorder]}
                    onPress={() => {
                      setRosterClass(null);
                      router.push({ pathname: "/(admin)/member-detail" as any, params: { id: s.id } });
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={dy.rosterName}>{s.name}</Text>
                      {s.birth_year ? (
                        <Text style={dy.rosterSub}>{s.birth_year}년생</Text>
                      ) : null}
                    </View>
                    <ChevronRight size={15} color={C.textMuted} />
                  </Pressable>
                ));
              })()}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    )}
    </>
  );
}

const dy = StyleSheet.create({
  backdrop:         { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet:            { backgroundColor: "#fff", borderTopLeftRadius: 22, borderTopRightRadius: 22,
                      minHeight: "55%", maxHeight: "80%", paddingBottom: 8 },
  handle:           { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB",
                      alignSelf: "center", marginTop: 10, marginBottom: 6 },
  header:           { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 16, paddingBottom: 10 },
  dateTitle:        { fontSize: 17, fontFamily: "Pretendard-Regular", color: C.text },
  dateSub:          { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2 },
  headerActions:    { flexDirection: "row", alignItems: "center", gap: 4 },
  iconBtnWrap:      { padding: 6, position: "relative" },
  redDot:           { position: "absolute", top: 4, right: 4, width: 7, height: 7,
                      borderRadius: 4, backgroundColor: "#D96C6C" },
  headerBtn:        { flexDirection: "row", alignItems: "center", gap: 4,
                      paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  headerBtnTxt:     { fontSize: 12, fontFamily: "Pretendard-Regular" },
  closeBtn:         { padding: 6 },
  emptyBox:         { alignItems: "center", paddingVertical: 40, gap: 10 },
  emptyTxt:         { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted },
  emptyAction:      { flexDirection: "row", alignItems: "center", gap: 5,
                      paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5 },
  emptyActionTxt:   { fontSize: 13, fontFamily: "Pretendard-Regular" },
  classCard:        { flexDirection: "row", alignItems: "center", gap: 10, padding: 12,
                      backgroundColor: C.card, borderRadius: 12 },
  classCardDone:    { opacity: 0.65 },
  colorBar:         { width: 4, height: "100%" as any, borderRadius: 2, alignSelf: "stretch" },
  classTime:        { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },
  className:        { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text, marginTop: 2 },
  classSub:         { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  strikeText:       { textDecorationLine: "line-through" },
  attBadge:         { flexDirection: "row", alignItems: "center", gap: 3,
                      backgroundColor: "#E6FFFA", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  attBadgeTxt:      { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#2EC4B6" },
  diaryBadge:       { flexDirection: "row", alignItems: "center", gap: 3,
                      backgroundColor: "#EDE9FE", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  diaryBadgeTxt:    { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#7C3AED" },
  teacherChip:      { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start",
                      paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, marginTop: 5,
                      backgroundColor: "#F0FDF9", borderWidth: 1, borderColor: "#C2E8E5" },
  teacherChipTxt:   { fontSize: 11, fontFamily: "Pretendard-Regular" },
  rosterRow:        { flexDirection: "row", alignItems: "center", paddingVertical: 14 },
  rosterRowBorder:  { borderBottomWidth: 1, borderBottomColor: C.border },
  rosterName:       { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.text },
  rosterSub:        { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2 },
  mkRow:            { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 14 },
  mkRowBorder:      { borderBottomWidth: 1, borderBottomColor: C.border },
  mkBadge:          { width: 32, height: 32, borderRadius: 10, backgroundColor: "#EEF2FF",
                      alignItems: "center", justifyContent: "center" },
  mkName:           { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.text },
  mkSub:            { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2 },
  mkCheckBtn:       { flexDirection: "row", alignItems: "center", gap: 4,
                      paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
                      backgroundColor: "#EEF2FF", borderWidth: 1, borderColor: "#C7D2FE" },
  mkCheckTxt:       { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#4F46E5" },
  memoSection:      { marginHorizontal: 16, marginTop: 8, padding: 14,
                      backgroundColor: "#FFFBF0", borderRadius: 12,
                      borderWidth: 1, borderColor: "#F3E8C0" },
  memoHeader:       { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  memoLabel:        { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, flex: 1 },
  memoEditBtn:      { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: "#fff" },
  memoEditBtnTxt:   { fontSize: 12, fontFamily: "Pretendard-Regular" },
  memoEditArea:     {},
  memoInput:        { borderWidth: 1, borderColor: "#E8DFC0", borderRadius: 8,
                      padding: 10, fontSize: 13, color: C.text, minHeight: 72, textAlignVertical: "top" },
  memoCancelBtn:    { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: C.border, alignItems: "center" },
  memoCancelBtnTxt: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  memoSaveBtn:      { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  memoSaveBtnTxt:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#fff" },
  memoContent:      { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text, lineHeight: 20 },
  memoEmpty:        { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted },
  audioDivider:     { height: 1, backgroundColor: "#F3E8C0", marginVertical: 10 },
  audioRow:         { flexDirection: "row", alignItems: "center", gap: 6 },
  audioLabel:       { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  audioBtn:         { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  audioBtnTxt:      { fontSize: 12, fontFamily: "Pretendard-Regular" },
  recordingIndicator: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  recordingDot:     { width: 8, height: 8, borderRadius: 4, backgroundColor: "#D96C6C" },
  recordingTxt:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#D96C6C" },
  audioListBox:     { marginTop: 8, gap: 6 },
  audioListItem:    { flexDirection: "row", alignItems: "center", gap: 6,
                      backgroundColor: "#fff", padding: 8, borderRadius: 8 },
  audioListLabel:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#92400E" },
  audioListTime:    { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },
  audioPlayBtn:     { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: "#E6FFFA" },
  audioDelBtn:      { padding: 4 },
});
