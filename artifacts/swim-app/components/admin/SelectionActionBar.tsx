import { Feather } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator, Pressable, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const C = Colors.light;

interface Props {
  visible: boolean;
  selectedCount: number;
  totalCount: number;
  isAllSelected: boolean;
  deleting: boolean;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDeleteSelected: () => void;
  onExit: () => void;
}

export function SelectionActionBar({
  visible, selectedCount, totalCount, isAllSelected,
  deleting, onSelectAll, onClearSelection, onDeleteSelected, onExit,
}: Props) {
  const insets = useSafeAreaInsets();
  if (!visible) return null;

  return (
    <View style={[s.bar, { paddingBottom: insets.bottom + 8 }]}>
      <View style={s.row}>
        {/* 전체선택 체크박스 */}
        <Pressable style={s.checkRow} onPress={onSelectAll}>
          <View style={[s.checkbox, isAllSelected && { backgroundColor: C.tint, borderColor: C.tint }]}>
            {isAllSelected && <Feather name="check" size={12} color="#fff" />}
          </View>
          <Text style={s.checkLabel}>
            {isAllSelected ? "전체해제" : `전체선택`}
          </Text>
        </Pressable>

        {/* 선택 개수 */}
        <View style={s.countBadge}>
          <Text style={s.countText}>선택됨 {selectedCount}개</Text>
        </View>

        {/* 삭제 버튼 */}
        <Pressable
          style={[s.deleteBtn, selectedCount === 0 && s.deleteBtnDisabled]}
          onPress={selectedCount > 0 ? onDeleteSelected : undefined}
          disabled={selectedCount === 0 || deleting}
        >
          {deleting
            ? <ActivityIndicator size={14} color="#fff" />
            : <Feather name="trash-2" size={14} color="#fff" />
          }
          <Text style={s.deleteBtnText}>
            {deleting ? "삭제 중..." : `삭제 (${selectedCount})`}
          </Text>
        </Pressable>

        {/* 선택모드 종료 */}
        <Pressable style={s.exitBtn} onPress={onExit}>
          <Feather name="x" size={18} color={C.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    position: "absolute",
    bottom: 0, left: 0, right: 0,
    zIndex: 1000,
    backgroundColor: C.card,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 10,
    paddingHorizontal: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 30,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  checkbox: {
    width: 20, height: 20, borderRadius: 6,
    borderWidth: 2, borderColor: C.border,
    backgroundColor: C.background,
    alignItems: "center", justifyContent: "center",
  },
  checkLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: C.textSecondary },
  countBadge: {
    flex: 1,
    backgroundColor: C.tintLight, paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 8, alignItems: "center",
  },
  countText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.tint },
  deleteBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#DC2626", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
  },
  deleteBtnDisabled: { backgroundColor: "#D1D5DB" },
  deleteBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
  exitBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
});
