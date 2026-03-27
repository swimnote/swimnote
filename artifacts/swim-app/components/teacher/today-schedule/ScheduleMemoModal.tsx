import { ArrowLeft, Info } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest } from "@/context/AuthContext";
import { DailyMemoDateInfo } from "./types";
import MiniCalendar from "./MiniCalendar";
import DailyMemoPage from "./DailyMemoPage";

const C = Colors.light;

export default function ScheduleMemoModal({
  visible, token, themeColor, onClose,
}: {
  visible: boolean; token: string | null; themeColor: string; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const now = new Date();
  const [year, setYear]     = useState(now.getFullYear());
  const [month, setMonth]   = useState(now.getMonth() + 1);
  const [memoInfo, setMemoInfo] = useState<DailyMemoDateInfo[]>([]);
  const [loadingDates, setLoadingDates] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const loadDates = useCallback(async (y: number, m: number) => {
    setLoadingDates(true);
    try {
      const res = await apiRequest(token, `/daily-memos/dates?year=${y}&month=${m}`);
      if (res.ok) setMemoInfo(await res.json());
    } finally { setLoadingDates(false); }
  }, [token]);

  useEffect(() => {
    if (visible) { loadDates(year, month); }
  }, [visible, year, month]);

  function handleChangeMonth(y: number, m: number) {
    setYear(y); setMonth(m); setMemoInfo([]);
  }
  function handleMemoSaved(date: string, info: DailyMemoDateInfo) {
    setMemoInfo(prev => {
      const filtered = prev.filter(m => m.date !== date);
      if (info.has_text || info.has_audio) return [...filtered, info];
      return filtered;
    });
  }

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={() => {
      if (selectedDate) setSelectedDate(null); else onClose();
    }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.background }} edges={["top","left","right"]}>
        {selectedDate ? (
          <DailyMemoPage
            date={selectedDate} token={token} themeColor={themeColor}
            onBack={() => setSelectedDate(null)}
            onSaved={handleMemoSaved}
          />
        ) : (
          <>
            <View style={[sm.header, { borderBottomColor: C.border, paddingTop: 20 }]}>
              <Pressable style={sm.backBtn} onPress={onClose}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <ArrowLeft size={24} color={C.text} />
              </Pressable>
              <Text style={[sm.headerTitle, { color: C.text }]}>스케줄 메모</Text>
              <View style={{ width: 48 }} />
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 24 }}
              showsVerticalScrollIndicator={false}>
              {loadingDates && <ActivityIndicator color={themeColor} style={{ marginBottom: 4 }} />}
              <MiniCalendar
                year={year} month={month}
                memoInfo={memoInfo}
                onSelectDate={setSelectedDate}
                onChangeMonth={handleChangeMonth}
              />
              <View style={[sm.tipBox, { backgroundColor: C.tintLight }]}>
                <Info size={13} color={themeColor} />
                <Text style={[sm.tipText, { color: themeColor }]}>
                  날짜를 탭하면 메모를 작성하거나 편집할 수 있습니다.
                </Text>
              </View>
            </ScrollView>
          </>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const sm = StyleSheet.create({
  header:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 14, borderBottomWidth: 1 },
  backBtn:     { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  headerTitle: { fontSize: 17, fontFamily: "Pretendard-Bold" },
  tipBox:      { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 12 },
  tipText:     { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", lineHeight: 18 },
});
