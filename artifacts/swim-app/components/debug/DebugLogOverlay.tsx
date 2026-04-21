import * as Clipboard from "expo-clipboard";
import React, { useCallback, useEffect, useRef } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useDebugLog } from "@/context/DebugLogContext";

const LEVEL_COLOR: Record<string, string> = {
  log: "#E2FFE2",
  warn: "#FFF8D0",
  error: "#FFE0E0",
};
const LEVEL_LABEL: Record<string, string> = {
  log: "LOG ",
  warn: "WARN",
  error: "ERR ",
};

export function DebugLogOverlay() {
  const { logs, isVisible, hideOverlay, clearLogs } = useDebugLog();
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (isVisible && logs.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 80);
    }
  }, [isVisible, logs.length]);

  const handleCopy = useCallback(async () => {
    const text = logs
      .map((e) => `[${e.time}][${LEVEL_LABEL[e.level]}] ${e.msg}`)
      .join("\n");
    await Clipboard.setStringAsync(text);
  }, [logs]);

  if (!isVisible) return null;

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="slide"
      onRequestClose={hideOverlay}
      statusBarTranslucent
    >
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        {/* 헤더 */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>🔍 AUTH DEBUG LOG</Text>
          <Text style={styles.headerSub}>{logs.length}건 · 최근 300개 보관</Text>
          <View style={styles.headerBtns}>
            <TouchableOpacity style={styles.btn} onPress={handleCopy}>
              <Text style={styles.btnText}>복사</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnRed]} onPress={clearLogs}>
              <Text style={styles.btnText}>초기화</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnDark]} onPress={hideOverlay}>
              <Text style={styles.btnText}>닫기</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 범례 */}
        <View style={styles.legend}>
          {[
            { color: "#E2FFE2", label: "LOG" },
            { color: "#FFF8D0", label: "WARN" },
            { color: "#FFE0E0", label: "ERROR" },
          ].map(({ color, label }) => (
            <View key={label} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: color, borderColor: "#ccc", borderWidth: 1 }]} />
              <Text style={styles.legendText}>{label}</Text>
            </View>
          ))}
          <Text style={styles.legendHint}>5번 탭해서 열기/닫기</Text>
        </View>

        {/* 로그 목록 */}
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator
          onContentSizeChange={() =>
            scrollRef.current?.scrollToEnd({ animated: false })
          }
        >
          {logs.length === 0 ? (
            <Text style={styles.emptyText}>
              아직 로그가 없습니다.{"\n"}로그인을 시도하면 여기에 표시됩니다.
            </Text>
          ) : (
            logs.map((entry) => (
              <View
                key={entry.id}
                style={[
                  styles.logRow,
                  { backgroundColor: LEVEL_COLOR[entry.level] ?? "#fff" },
                ]}
              >
                <Text style={styles.logTime}>{entry.time}</Text>
                <Text style={styles.logMsg} selectable>
                  {entry.msg}
                </Text>
              </View>
            ))
          )}
        </ScrollView>

        {/* 하단 닫기 */}
        <Pressable style={styles.closeBar} onPress={hideOverlay}>
          <Text style={styles.closeBarText}>▼ 닫기</Text>
        </Pressable>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#111",
  },
  header: {
    backgroundColor: "#1a1a2e",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  headerTitle: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  headerSub: {
    color: "#aaa",
    fontSize: 11,
  },
  headerBtns: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  btn: {
    backgroundColor: "#2EC4B6",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  btnRed: {
    backgroundColor: "#EF4444",
  },
  btnDark: {
    backgroundColor: "#555",
  },
  btnText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  legend: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#222",
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 10,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    color: "#ccc",
    fontSize: 10,
  },
  legendHint: {
    color: "#555",
    fontSize: 10,
    flex: 1,
    textAlign: "right",
  },
  scroll: {
    flex: 1,
    backgroundColor: "#1e1e1e",
  },
  scrollContent: {
    padding: 8,
    gap: 3,
  },
  emptyText: {
    color: "#666",
    fontSize: 13,
    textAlign: "center",
    marginTop: 40,
    lineHeight: 22,
  },
  logRow: {
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  logTime: {
    fontSize: 9,
    color: "#666",
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
    marginBottom: 1,
  },
  logMsg: {
    fontSize: 11,
    color: "#111",
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
    lineHeight: 16,
  },
  closeBar: {
    backgroundColor: "#1a1a2e",
    alignItems: "center",
    paddingVertical: 12,
  },
  closeBarText: {
    color: "#aaa",
    fontSize: 13,
  },
});
