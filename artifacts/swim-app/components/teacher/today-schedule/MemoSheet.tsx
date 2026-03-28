import { Lock, Mic, Square, Trash2, X } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { Audio } from "expo-av";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View,
} from "react-native";
import Colors from "@/constants/colors";
import { apiRequest } from "@/context/AuthContext";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { API_BASE, ScheduleItem } from "./types";

const C = Colors.light;

export default function MemoSheet({
  visible, item, date, token, themeColor, onClose, onSaved,
}: {
  visible: boolean; item: ScheduleItem | null; date: string;
  token: string | null; themeColor: string;
  onClose: () => void; onSaved: (updated: Partial<ScheduleItem>) => void;
}) {
  const [text, setText]         = useState("");
  const [saving, setSaving]     = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [audioKey, setAudioKey] = useState<string | null>(null);
  const [sound, setSound]       = useState<Audio.Sound | null>(null);
  const [playing, setPlaying]   = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [memoErrMsg, setMemoErrMsg] = useState<string | null>(null);
  const recSecs = useRef(0);
  const recTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [recDisplay, setRecDisplay] = useState("0:00");

  useEffect(() => {
    if (visible && item) {
      setText(item.note_text || "");
      setAudioKey(item.audio_file_url || null);
      setAudioUri(null); setIsRecording(false);
      setRecording(null); setPlaying(false);
    }
  }, [visible, item]);

  async function startRecording() {
    try {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      setRecording(rec); setIsRecording(true);
      recSecs.current = 0; setRecDisplay("0:00");
      recTimer.current = setInterval(() => {
        recSecs.current += 1;
        const m = Math.floor(recSecs.current / 60);
        const s = recSecs.current % 60;
        setRecDisplay(`${m}:${String(s).padStart(2,"0")}`);
      }, 1000);
    } catch { setMemoErrMsg("녹음을 시작할 수 없습니다."); }
  }
  async function stopRecording() {
    if (!recording) return;
    if (recTimer.current) clearInterval(recTimer.current);
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    setRecording(null); setIsRecording(false); setAudioUri(uri || null);
  }
  async function uploadAudio(): Promise<string | null> {
    if (!audioUri) return audioKey;
    setUploadingAudio(true);
    try {
      const formData = new FormData();
      const filename = audioUri.split("/").pop() || "audio.m4a";
      (formData as any).append("audio", { uri: audioUri, name: filename, type: "audio/m4a" } as any);
      const res = await fetch(`${API_BASE}/api/schedule-notes/audio`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData,
      });
      const data = await res.json();
      return data.audio_file_url || null;
    } catch { setMemoErrMsg("음성 업로드에 실패했습니다."); return null; }
    finally { setUploadingAudio(false); }
  }
  async function playAudio() {
    const key = audioKey;
    if (!key && !audioUri) return;
    if (playing) { await sound?.pauseAsync(); setPlaying(false); return; }
    try {
      let playUri = audioUri;
      if (!playUri && key) playUri = `${API_BASE}/api/schedule-notes/audio?key=${encodeURIComponent(key)}`;
      if (!playUri) return;
      const { sound: s } = await Audio.Sound.createAsync({ uri: playUri }, { shouldPlay: true });
      setSound(s); setPlaying(true);
      s.setOnPlaybackStatusUpdate(status => {
        if ((status as any).didJustFinish) { setPlaying(false); s.unloadAsync(); setSound(null); }
      });
    } catch { setMemoErrMsg("재생에 실패했습니다."); }
  }
  async function handleSave() {
    if (!item) return;
    setSaving(true);
    try {
      const uploadedKey = await uploadAudio();
      const res = await apiRequest(token, "/schedule-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_group_id: item.id, schedule_date: date,
          note_text: text.trim() || null,
          audio_file_url: uploadedKey || null,
        }),
      });
      if (res.ok) {
        onSaved({ note_text: text.trim() || null, audio_file_url: uploadedKey || null, has_note: !!(text.trim() || uploadedKey) });
        onClose();
      }
    } finally { setSaving(false); }
  }

  if (!item) return null;
  return (
    <>
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
        <Pressable style={ms.overlay} onPress={onClose} />
        <View style={ms.sheet}>
          <View style={ms.handle} />
          <View style={ms.sheetHeader}>
            <View>
              <Text style={ms.sheetTitle}>개인 메모</Text>
              <Text style={ms.sheetSub}>{item.name} · {item.schedule_time}</Text>
            </View>
            <Pressable onPress={onClose} style={ms.closeBtn}><X size={20} color={C.text} /></Pressable>
          </View>
          <TextInput style={[ms.textArea, { borderColor: C.border }]}
            value={text} onChangeText={setText}
            placeholder="수업 준비 메모, 특이사항 등 자유롭게 작성하세요..."
            placeholderTextColor={C.textMuted} multiline numberOfLines={5} textAlignVertical="top" />
          <View style={[ms.audioBox, { borderColor: C.border }]}>
            <Mic size={16} color={themeColor} />
            <Text style={[ms.audioLabel, { color: C.textSecondary }]}>음성 메모</Text>
            {isRecording ? (
              <View style={ms.recRow}>
                <View style={ms.recDot} />
                <Text style={[ms.recTime, { color: "#D96C6C" }]}>{recDisplay}</Text>
                <Pressable style={[ms.recBtn, { backgroundColor: "#D96C6C" }]} onPress={stopRecording}>
                  <Square size={14} color="#fff" />
                  <Text style={ms.recBtnText}>중지</Text>
                </Pressable>
              </View>
            ) : (
              <View style={ms.recRow}>
                {(audioUri || audioKey) ? (
                  <>
                    <Pressable style={[ms.recBtn, { backgroundColor: themeColor }]} onPress={playAudio}>
                      <LucideIcon name={playing ? "pause" : "play"} size={14} color="#fff" />
                      <Text style={ms.recBtnText}>{playing ? "일시정지" : "재생"}</Text>
                    </Pressable>
                    <Pressable style={[ms.recBtn, { backgroundColor: "#FFFFFF" }]} onPress={() => {
                      if (sound) { sound.unloadAsync(); setSound(null); }
                      setPlaying(false); setAudioUri(null); setAudioKey(null);
                    }}>
                      <Trash2 size={14} color={C.error} />
                      <Text style={[ms.recBtnText, { color: C.error }]}>삭제</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable style={[ms.recBtn, { backgroundColor: "#F9DEDA" }]} onPress={startRecording}>
                    <Mic size={14} color="#D96C6C" />
                    <Text style={[ms.recBtnText, { color: "#D96C6C" }]}>녹음 시작</Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>
          <Text style={ms.privateNote}>
            <Lock size={11} color={C.textMuted} /> 개인 메모는 선생님 본인만 볼 수 있습니다.
          </Text>
          <Pressable style={[ms.saveBtn, { backgroundColor: themeColor, opacity: saving || uploadingAudio ? 0.7 : 1 }]}
            onPress={handleSave} disabled={saving || uploadingAudio}>
            {saving || uploadingAudio
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={ms.saveBtnText}>저장</Text>}
          </Pressable>
        </View>
      </Modal>
      <ConfirmModal visible={!!memoErrMsg} title="오류" message={memoErrMsg ?? ""} confirmText="확인" onConfirm={() => setMemoErrMsg(null)} />
    </>
  );
}

const ms = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet:      { backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 14, paddingBottom: 36 },
  handle:     { width: 36, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: "center", marginBottom: 4 },
  sheetHeader:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { fontSize: 18, fontFamily: "Pretendard-SemiBold", color: C.text },
  sheetSub:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 },
  closeBtn:   { width: 32, height: 32, borderRadius: 10, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  textArea:   { borderWidth: 1.5, borderRadius: 12, padding: 12, minHeight: 110, fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  audioBox:   { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderRadius: 12, padding: 12 },
  audioLabel: { fontSize: 13, fontFamily: "Pretendard-Medium", flex: 1 },
  recRow:     { flexDirection: "row", alignItems: "center", gap: 8 },
  recDot:     { width: 8, height: 8, borderRadius: 4, backgroundColor: "#D96C6C" },
  recTime:    { fontSize: 14, fontFamily: "Pretendard-SemiBold", minWidth: 36 },
  recBtn:     { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  recBtnText: { color: "#fff", fontSize: 12, fontFamily: "Pretendard-Medium" },
  privateNote:{ fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, textAlign: "center" },
  saveBtn:    { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  saveBtnText:{ color: "#fff", fontSize: 15, fontFamily: "Pretendard-Medium" },
});
