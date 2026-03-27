import { Feather } from "@expo/vector-icons";
import { Audio } from "expo-av";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest } from "@/context/AuthContext";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { API_BASE, DailyMemo, DailyMemoDateInfo, formatDate } from "./types";

const C = Colors.light;

export default function DailyMemoPage({
  date, token, themeColor, onBack, onSaved,
}: {
  date: string; token: string | null; themeColor: string;
  onBack: () => void;
  onSaved: (date: string, info: DailyMemoDateInfo) => void;
}) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [text, setText]       = useState("");
  const [audioKey, setAudioKey]   = useState<string | null>(null);
  const [audioUri, setAudioUri]   = useState<string | null>(null);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [sound, setSound]     = useState<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playPos, setPlayPos] = useState(0);
  const [playDur, setPlayDur] = useState(0);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [saving, setSaving]   = useState(false);
  const recSecs = useRef(0);
  const recTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [recDisplay, setRecDisplay] = useState("0:00");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await apiRequest(token, `/daily-memos?date=${date}`);
        if (res.ok) {
          const data: DailyMemo | null = await res.json();
          if (data) { setText(data.note_text || ""); setAudioKey(data.audio_file_url || null); }
          else { setText(""); setAudioKey(null); }
        }
      } catch(e) { console.error(e); }
      finally { setLoading(false); }
    })();
    return () => {
      sound?.unloadAsync();
      if (recTimer.current) clearInterval(recTimer.current);
    };
  }, [date]);

  async function startRecording() {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) { Alert.alert("권한 필요", "마이크 권한이 필요합니다."); return; }
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
    } catch (e) { setErrMsg("녹음을 시작할 수 없습니다."); }
  }
  async function stopRecording() {
    if (!recording) return;
    if (recTimer.current) clearInterval(recTimer.current);
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    setRecording(null); setIsRecording(false);
    setAudioUri(uri || null);
  }
  async function playAudio() {
    if (playing) { await sound?.pauseAsync(); setPlaying(false); return; }
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      let playUri = audioUri;
      if (!playUri && audioKey) playUri = `${API_BASE}/api/daily-memos/audio?key=${encodeURIComponent(audioKey)}`;
      if (!playUri) return;
      const { sound: s } = await Audio.Sound.createAsync({ uri: playUri }, { shouldPlay: true });
      setSound(s); setPlaying(true);
      s.setOnPlaybackStatusUpdate(status => {
        const st = status as any;
        if (st.isLoaded) { setPlayPos(st.positionMillis || 0); setPlayDur(st.durationMillis || 0); }
        if (st.didJustFinish) { setPlaying(false); setPlayPos(0); s.unloadAsync(); setSound(null); }
      });
    } catch { setErrMsg("재생에 실패했습니다."); }
  }
  function deleteAudio() {
    if (sound) { sound.unloadAsync(); setSound(null); }
    setPlaying(false); setPlayPos(0); setPlayDur(0); setAudioUri(null); setAudioKey(null);
  }
  async function uploadAudio(): Promise<string | null> {
    if (!audioUri) return audioKey;
    setUploadingAudio(true);
    try {
      const formData = new FormData();
      const filename = audioUri.split("/").pop() || "audio.m4a";
      (formData as any).append("audio", { uri: audioUri, name: filename, type: "audio/m4a" } as any);
      const res = await fetch(`${API_BASE}/api/daily-memos/audio`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData,
      });
      const data = await res.json();
      return data.audio_file_url || null;
    } catch { setErrMsg("음성 업로드에 실패했습니다."); return null; }
    finally { setUploadingAudio(false); }
  }
  async function handleSave() {
    setSaving(true);
    try {
      const uploadedKey = await uploadAudio();
      const res = await apiRequest(token, "/daily-memos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, note_text: text.trim() || null, audio_file_url: uploadedKey || null }),
      });
      if (res.ok) {
        onSaved(date, { date, has_text: !!(text.trim()), has_audio: !!(uploadedKey) });
        onBack();
      } else {
        const d = await res.json();
        setErrMsg(d.error || "저장에 실패했습니다.");
      }
    } finally { setSaving(false); }
  }

  const hasAudio = !!(audioUri || audioKey);
  const progPercent = playDur > 0 ? (playPos / playDur) * 100 : 0;

  if (loading) {
    return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={themeColor} size="large" /></View>;
  }

  return (
    <>
      <View style={{ flex: 1, backgroundColor: C.background }}>
        <View style={[dm.header, { paddingTop: 20, borderBottomColor: C.border }]}>
          <Pressable style={dm.backBtn} onPress={onBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Feather name="arrow-left" size={24} color={C.text} />
          </Pressable>
          <Text style={[dm.headerTitle, { color: C.text }]}>{formatDate(date)}</Text>
          <View style={{ width: 48 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: insets.bottom + 100 }}
          showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={dm.section}>
            <View style={dm.sectionHeader}>
              <Feather name="edit-3" size={16} color={themeColor} />
              <Text style={[dm.sectionTitle, { color: C.text }]}>텍스트 메모</Text>
            </View>
            <TextInput style={[dm.textArea, { borderColor: C.border, color: C.text }]}
              value={text} onChangeText={setText}
              placeholder="수업 준비, 특이사항, 개인 스케줄 등 자유롭게 작성하세요..."
              placeholderTextColor={C.textMuted} multiline numberOfLines={6} textAlignVertical="top" />
          </View>
          <View style={dm.section}>
            <View style={dm.sectionHeader}>
              <Feather name="mic" size={16} color="#4EA7D8" />
              <Text style={[dm.sectionTitle, { color: C.text }]}>음성 메모</Text>
            </View>
            <View style={[dm.audioBox, { borderColor: C.border }]}>
              {isRecording ? (
                <View style={dm.recordingRow}>
                  <View style={dm.recPulse}><View style={dm.recDot} /></View>
                  <Text style={[dm.recTime, { color: "#D96C6C" }]}>{recDisplay}</Text>
                  <Text style={[dm.recLabel, { color: C.textSecondary }]}>녹음 중...</Text>
                  <Pressable style={dm.stopBtn} onPress={stopRecording}>
                    <Feather name="square" size={14} color="#fff" />
                    <Text style={dm.stopBtnText}>중지</Text>
                  </Pressable>
                </View>
              ) : hasAudio ? (
                <View style={{ gap: 12 }}>
                  <View style={dm.playerRow}>
                    <Pressable style={[dm.playerBtn, { backgroundColor: "#4EA7D8" }]} onPress={playAudio}>
                      <Feather name={playing ? "pause" : "play"} size={18} color="#fff" />
                    </Pressable>
                    <View style={{ flex: 1, gap: 4 }}>
                      <View style={[dm.progressTrack, { backgroundColor: C.border }]}>
                        <View style={[dm.progressFill, { width: `${progPercent}%` as any, backgroundColor: "#4EA7D8" }]} />
                      </View>
                      <View style={dm.playerMeta}>
                        <Text style={[dm.playerStatus, { color: playing ? "#4EA7D8" : C.textSecondary }]}>
                          {playing ? "재생 중" : "재생 가능"}
                        </Text>
                        {audioUri && <Text style={[dm.playerStatus, { color: "#E4A93A" }]}>새 녹음 (미저장)</Text>}
                      </View>
                    </View>
                    <Pressable style={dm.deleteAudioBtn} onPress={deleteAudio}>
                      <Feather name="trash-2" size={16} color="#D96C6C" />
                    </Pressable>
                  </View>
                  <Pressable style={[dm.rerecordBtn, { borderColor: C.border }]} onPress={startRecording}>
                    <Feather name="refresh-cw" size={13} color={C.textSecondary} />
                    <Text style={[dm.rerecordText, { color: C.textSecondary }]}>다시 녹음</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable style={dm.startRecBtn} onPress={startRecording}>
                  <View style={[dm.micCircle, { backgroundColor: "#E6FFFA" }]}>
                    <Feather name="mic" size={22} color="#4EA7D8" />
                  </View>
                  <Text style={[dm.startRecText, { color: C.text }]}>녹음 시작</Text>
                  <Text style={[dm.startRecSub, { color: C.textSecondary }]}>탭하면 녹음이 시작됩니다</Text>
                </Pressable>
              )}
            </View>
          </View>
        </ScrollView>
        <View style={[dm.saveWrap, { paddingBottom: insets.bottom + 12, borderTopColor: C.border, backgroundColor: C.background }]}>
          <Pressable style={[dm.saveBtn, { backgroundColor: themeColor, opacity: saving || uploadingAudio ? 0.7 : 1 }]}
            onPress={handleSave} disabled={saving || uploadingAudio}>
            {saving || uploadingAudio
              ? <ActivityIndicator color="#fff" size="small" />
              : <><Feather name="check" size={18} color="#fff" /><Text style={dm.saveBtnText}>저장</Text></>}
          </Pressable>
        </View>
      </View>
      <ConfirmModal visible={!!errMsg} title="오류" message={errMsg ?? ""} confirmText="확인" onConfirm={() => setErrMsg(null)} />
    </>
  );
}

const dm = StyleSheet.create({
  header:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: 1 },
  backBtn:       { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  headerTitle:   { fontSize: 16, fontFamily: "Pretendard-Bold", flex: 1, textAlign: "center" },
  section:       { gap: 10 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle:  { fontSize: 15, fontFamily: "Pretendard-SemiBold" },
  textArea:      { borderWidth: 1.5, borderRadius: 14, padding: 14, minHeight: 130, fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 22 },
  audioBox:      { borderWidth: 1.5, borderRadius: 14, padding: 16, gap: 0 },
  recordingRow:  { flexDirection: "row", alignItems: "center", gap: 10 },
  recPulse:      { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  recDot:        { width: 10, height: 10, borderRadius: 5, backgroundColor: "#D96C6C" },
  recTime:       { fontSize: 16, fontFamily: "Pretendard-Bold", minWidth: 44 },
  recLabel:      { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular" },
  stopBtn:       { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: "#D96C6C" },
  stopBtnText:   { color: "#fff", fontSize: 13, fontFamily: "Pretendard-SemiBold" },
  playerRow:     { flexDirection: "row", alignItems: "center", gap: 12 },
  playerBtn:     { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  progressTrack: { height: 4, borderRadius: 2, overflow: "hidden" },
  progressFill:  { height: 4, borderRadius: 2 },
  playerMeta:    { flexDirection: "row", gap: 10 },
  playerStatus:  { fontSize: 11, fontFamily: "Pretendard-Medium" },
  deleteAudioBtn:{ width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: "#F9DEDA" },
  rerecordBtn:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5 },
  rerecordText:  { fontSize: 13, fontFamily: "Pretendard-Medium" },
  startRecBtn:   { alignItems: "center", gap: 8, paddingVertical: 16 },
  micCircle:     { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center" },
  startRecText:  { fontSize: 15, fontFamily: "Pretendard-SemiBold" },
  startRecSub:   { fontSize: 12, fontFamily: "Pretendard-Regular" },
  saveWrap:      { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1 },
  saveBtn:       { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  saveBtnText:   { color: "#fff", fontSize: 16, fontFamily: "Pretendard-SemiBold" },
});
