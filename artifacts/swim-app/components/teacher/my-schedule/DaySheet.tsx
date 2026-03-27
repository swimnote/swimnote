import AsyncStorage from "@react-native-async-storage/async-storage";
import { LucideIcon } from "@/components/common/LucideIcon";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system";
import { Calendar, Check, ChevronRight, CirclePlus, CircleStop, FileText, Mic, Pencil, Plus, Trash2, X } from "lucide-react-native";
import React, { useEffect, useState } from "react";
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import Colors from "@/constants/colors";
import { TeacherClassGroup } from "@/components/teacher/types";
import {
  classColor, dateLabelFull, getKoDay, parseHour,
} from "./utils";

const C = Colors.light;

type AudioItem = { uri: string; createdAt: string };

export default function DaySheet({
  dateStr, classes, attMap, diarySet, themeColor, poolId,
  memo, onMemoChange, onSaveMemo,
  onClose, onSelectClass,
  onOpenMakeup, onAddClass,
}: {
  dateStr: string;
  classes: TeacherClassGroup[];
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
}) {
  const [editingMemo, setEditingMemo] = useState(false);
  const [showMemoPanel, setShowMemoPanel] = useState(false);
  const label = dateLabelFull(dateStr);

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
    <Modal visible animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={dy.backdrop} onPress={onClose}>
        <Pressable style={dy.sheet} onPress={() => {}}>
          <View style={dy.handle} />

          <View style={dy.header}>
            <View style={{ flex: 1 }}>
              <Text style={dy.dateTitle}>{label}</Text>
              <Text style={dy.dateSub}>{classes.length > 0 ? `수업 ${classes.length}개` : "수업 없음"}</Text>
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
              <Pressable style={[dy.headerBtn, { backgroundColor: C.tint }]} onPress={onAddClass}>
                <Plus size={13} color="#fff" />
                <Text style={[dy.headerBtnTxt, { color: "#fff" }]}>수업 추가</Text>
              </Pressable>
              <Pressable onPress={onClose} style={dy.closeBtn}>
                <X size={20} color={C.textSecondary} />
              </Pressable>
            </View>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }}
            contentContainerStyle={{ paddingBottom: 80 }}>

            {classes.length === 0 && (
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
                  const color    = classColor(g.id);
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
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
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
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const dy = StyleSheet.create({
  backdrop:         { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet:            { position: "absolute", bottom: 0, left: 0, right: 0,
                      backgroundColor: "#fff", borderTopLeftRadius: 22, borderTopRightRadius: 22,
                      maxHeight: "78%", paddingBottom: 8 },
  handle:           { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB",
                      alignSelf: "center", marginTop: 10, marginBottom: 6 },
  header:           { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 16, paddingBottom: 10 },
  dateTitle:        { fontSize: 17, fontFamily: "Pretendard-Bold", color: C.text },
  dateSub:          { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2 },
  headerActions:    { flexDirection: "row", alignItems: "center", gap: 4 },
  iconBtnWrap:      { padding: 6, position: "relative" },
  redDot:           { position: "absolute", top: 4, right: 4, width: 7, height: 7,
                      borderRadius: 4, backgroundColor: "#D96C6C" },
  headerBtn:        { flexDirection: "row", alignItems: "center", gap: 4,
                      paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  headerBtnTxt:     { fontSize: 12, fontFamily: "Pretendard-SemiBold" },
  closeBtn:         { padding: 6 },
  emptyBox:         { alignItems: "center", paddingVertical: 40, gap: 10 },
  emptyTxt:         { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted },
  emptyAction:      { flexDirection: "row", alignItems: "center", gap: 5,
                      paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5 },
  emptyActionTxt:   { fontSize: 13, fontFamily: "Pretendard-SemiBold" },
  classCard:        { flexDirection: "row", alignItems: "center", gap: 10, padding: 12,
                      backgroundColor: C.card, borderRadius: 12 },
  classCardDone:    { opacity: 0.65 },
  colorBar:         { width: 4, height: "100%" as any, borderRadius: 2, alignSelf: "stretch" },
  classTime:        { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },
  className:        { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: C.text, marginTop: 2 },
  classSub:         { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  strikeText:       { textDecorationLine: "line-through" },
  attBadge:         { flexDirection: "row", alignItems: "center", gap: 3,
                      backgroundColor: "#E6FFFA", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  attBadgeTxt:      { fontSize: 10, fontFamily: "Pretendard-SemiBold", color: "#2EC4B6" },
  diaryBadge:       { flexDirection: "row", alignItems: "center", gap: 3,
                      backgroundColor: "#EDE9FE", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  diaryBadgeTxt:    { fontSize: 10, fontFamily: "Pretendard-SemiBold", color: "#7C3AED" },
  memoSection:      { marginHorizontal: 16, marginTop: 8, padding: 14,
                      backgroundColor: "#FFFBF0", borderRadius: 12,
                      borderWidth: 1, borderColor: "#F3E8C0" },
  memoHeader:       { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  memoLabel:        { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: C.textSecondary, flex: 1 },
  memoEditBtn:      { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: "#fff" },
  memoEditBtnTxt:   { fontSize: 12, fontFamily: "Pretendard-SemiBold" },
  memoEditArea:     {},
  memoInput:        { borderWidth: 1, borderColor: "#E8DFC0", borderRadius: 8,
                      padding: 10, fontSize: 13, color: C.text, minHeight: 72, textAlignVertical: "top" },
  memoCancelBtn:    { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: C.border, alignItems: "center" },
  memoCancelBtnTxt: { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: C.textSecondary },
  memoSaveBtn:      { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  memoSaveBtnTxt:   { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: "#fff" },
  memoContent:      { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text, lineHeight: 20 },
  memoEmpty:        { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted },
  audioDivider:     { height: 1, backgroundColor: "#F3E8C0", marginVertical: 10 },
  audioRow:         { flexDirection: "row", alignItems: "center", gap: 6 },
  audioLabel:       { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: C.textSecondary },
  audioBtn:         { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  audioBtnTxt:      { fontSize: 12, fontFamily: "Pretendard-SemiBold" },
  recordingIndicator: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  recordingDot:     { width: 8, height: 8, borderRadius: 4, backgroundColor: "#D96C6C" },
  recordingTxt:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#D96C6C" },
  audioListBox:     { marginTop: 8, gap: 6 },
  audioListItem:    { flexDirection: "row", alignItems: "center", gap: 6,
                      backgroundColor: "#fff", padding: 8, borderRadius: 8 },
  audioListLabel:   { fontSize: 12, fontFamily: "Pretendard-SemiBold", color: "#92400E" },
  audioListTime:    { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },
  audioPlayBtn:     { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: "#E6FFFA" },
  audioDelBtn:      { padding: 4 },
});
