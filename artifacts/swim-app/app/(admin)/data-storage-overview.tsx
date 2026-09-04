/**
 * 저장공간 현황 — 총 사용량 · 제공 용량 · 남은 용량 · 게이지
 * + 사진 일괄 정리 (6개월 / 1년)
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Modal, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;

function fmtBytes(b: number) {
  if (b === 0) return "0 B";
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

function fmtCount(n: number) {
  return n.toLocaleString("ko-KR") + "장";
}

interface AdminStorage {
  total_bytes: number; quota_bytes: number;
  display_storage: string | null;
  photo_bytes: number; video_bytes: number;
  messenger_bytes: number; diary_bytes: number;
  notice_bytes: number; system_bytes: number;
}

interface CleanupPreview {
  count: number;
  total_size: number;
}

interface ConfirmState {
  visible: boolean;
  before: "6m" | "1y";
  label: string;
  preview: CleanupPreview;
}

export default function DataStorageOverviewScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();
  const [storage, setStorage] = useState<AdminStorage | null>(null);
  const [loading, setLoading] = useState(true);

  const [preview6m, setPreview6m] = useState<CleanupPreview | null>(null);
  const [preview1y, setPreview1y] = useState<CleanupPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const loadStorage = useCallback(async () => {
    try {
      const res = await apiRequest(token, "/admin/storage");
      if (res.ok) setStorage(await res.json());
    } catch (e) { console.error(e); }
  }, [token]);

  const loadCleanupPreviews = useCallback(async () => {
    setPreviewLoading(true);
    try {
      const [r6m, r1y] = await Promise.all([
        apiRequest(token, "/photos/cleanup-preview?before=6m"),
        apiRequest(token, "/photos/cleanup-preview?before=1y"),
      ]);
      if (r6m.ok) setPreview6m(await r6m.json());
      if (r1y.ok) setPreview1y(await r1y.json());
    } catch (e) { console.error(e); }
    finally { setPreviewLoading(false); }
  }, [token]);

  const load = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadStorage(), loadCleanupPreviews()]);
    setLoading(false);
  }, [loadStorage, loadCleanupPreviews]);

  useEffect(() => { load(); }, [load]);

  const handleDeletePress = (before: "6m" | "1y") => {
    const preview = before === "6m" ? preview6m : preview1y;
    if (!preview || preview.count === 0) return;
    setConfirm({
      visible: true,
      before,
      label: before === "6m" ? "6개월 이상 사진" : "1년 이상 사진",
      preview,
    });
  };

  const executeCleanup = async () => {
    if (!confirm) return;
    setDeleting(true);
    setConfirm(prev => prev ? { ...prev, visible: false } : null);
    try {
      const res = await apiRequest(token, "/photos/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ before: confirm.before }),
      });
      const data = await res.json();
      if (res.ok) {
        Alert.alert(
          "삭제 완료",
          `${data.deleted.toLocaleString("ko-KR")}장 삭제\n${fmtBytes(data.freed_bytes)} 확보`
        );
        await Promise.all([loadStorage(), loadCleanupPreviews()]);
      } else {
        Alert.alert("오류", data.error || "삭제 중 오류가 발생했습니다.");
      }
    } catch (e) {
      Alert.alert("오류", "네트워크 오류가 발생했습니다.");
    } finally {
      setDeleting(false);
      setConfirm(null);
    }
  };

  const used  = storage?.total_bytes ?? 0;
  const quota = storage?.quota_bytes ?? 512 * 1024 * 1024;
  const free  = Math.max(0, quota - used);
  const pct   = quota > 0 ? Math.min(100, (used / quota) * 100) : 0;
  const gaugeColor = pct >= 90 ? "#D96C6C" : pct >= 70 ? "#E4A93A" : themeColor;
  const quotaLabel = storage?.display_storage ?? fmtBytes(quota);

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader title="저장공간 현황" />

      {loading ? (
        <ActivityIndicator color={themeColor} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
        >
          {/* 게이지 카드 */}
          <View style={[s.card, { backgroundColor: C.card }]}>
            <Text style={s.cardTitle}>전체 사용률</Text>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 12 }}>
              <Text style={[s.bigNum, { color: gaugeColor }]}>{pct.toFixed(1)}%</Text>
              <Text style={s.sub}>사용 중</Text>
            </View>
            <View style={s.gaugeWrap}>
              <View style={[s.gaugeBar, { width: `${pct}%` as any, backgroundColor: gaugeColor }]} />
            </View>
          </View>

          {/* 수치 카드 3개 */}
          {[
            { label: "사용량",    display: fmtBytes(used),   icon: "hard-drive"   as const, color: gaugeColor },
            { label: "제공 용량", display: quotaLabel,        icon: "server"       as const, color: C.textSecondary },
            { label: "남은 용량", display: fmtBytes(free),   icon: "check-circle" as const, color: C.brandStrong },
          ].map(item => (
            <View key={item.label} style={[s.statCard, { backgroundColor: C.card }]}>
              <View style={[s.statIcon, { backgroundColor: C.backgroundSoft }]}>
                <LucideIcon name={item.icon} size={22} color={item.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.statLabel}>{item.label}</Text>
                <Text style={[s.statValue, { color: item.color }]}>{item.display}</Text>
              </View>
            </View>
          ))}

          {/* ─── 사진 일괄 정리 ─── */}
          <View style={{ marginTop: 8 }}>
            <Text style={s.sectionTitle}>사진 일괄 정리</Text>
            <Text style={s.sectionDesc}>기간이 지난 사진을 삭제해 저장공간을 확보합니다.</Text>
          </View>

          {previewLoading ? (
            <ActivityIndicator color={themeColor} style={{ marginVertical: 8 }} />
          ) : (
            <>
              {/* 6개월 카드 */}
              <CleanupCard
                label="6개월 이상 사진"
                preview={preview6m}
                onDelete={() => handleDeletePress("6m")}
                deleting={deleting}
                themeColor="#D96C6C"
              />
              {/* 1년 카드 */}
              <CleanupCard
                label="1년 이상 사진"
                preview={preview1y}
                onDelete={() => handleDeletePress("1y")}
                deleting={deleting}
                themeColor="#B91C1C"
              />
            </>
          )}
        </ScrollView>
      )}

      {/* 확인 모달 */}
      {confirm && (
        <Modal
          visible={confirm.visible}
          transparent
          animationType="fade"
          onRequestClose={() => setConfirm(null)}
        >
          <View style={s.overlay}>
            <View style={[s.modal, { backgroundColor: C.card }]}>
              <View style={s.modalIconWrap}>
                <LucideIcon name="trash-2" size={28} color="#D96C6C" />
              </View>
              <Text style={s.modalTitle}>{confirm.label}</Text>
              <Text style={s.modalCount}>{fmtCount(confirm.preview.count)}</Text>
              <Text style={s.modalSize}>{fmtBytes(confirm.preview.total_size)} 확보 예정</Text>
              <Text style={s.modalWarn}>정말 삭제하시겠습니까?{"\n"}삭제된 사진은 복구할 수 없습니다.</Text>
              <View style={s.modalBtns}>
                <TouchableOpacity
                  style={[s.modalBtn, s.cancelBtn]}
                  onPress={() => setConfirm(null)}
                >
                  <Text style={s.cancelTxt}>취소</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.modalBtn, s.deleteBtn]}
                  onPress={executeCleanup}
                >
                  <Text style={s.deleteTxt}>삭제</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

interface CleanupCardProps {
  label: string;
  preview: CleanupPreview | null;
  onDelete: () => void;
  deleting: boolean;
  themeColor: string;
}

function CleanupCard({ label, preview, onDelete, deleting, themeColor }: CleanupCardProps) {
  const count = preview?.count ?? 0;
  const size  = preview?.total_size ?? 0;
  const empty = count === 0;

  return (
    <View style={[s.cleanCard, { backgroundColor: C.card }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
        <View style={[s.cleanIcon, { backgroundColor: C.backgroundSoft }]}>
          <LucideIcon name="image" size={20} color={C.textSecondary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.cleanLabel}>{label}</Text>
          {empty ? (
            <Text style={s.cleanEmpty}>삭제 대상 없음</Text>
          ) : (
            <>
              <Text style={[s.cleanCount, { color: themeColor }]}>
                {count.toLocaleString("ko-KR")}장
              </Text>
              <Text style={s.cleanSize}>{fmtBytes(size)} 확보 가능</Text>
            </>
          )}
        </View>
      </View>
      <TouchableOpacity
        style={[s.deleteButton, empty && s.deleteBtnDisabled]}
        onPress={onDelete}
        disabled={empty || deleting}
        activeOpacity={0.75}
      >
        <LucideIcon name="trash-2" size={16} color={empty ? "#CBD5E1" : "#FFF"} />
        <Text style={[s.deleteBtnTxt, empty && { color: "#CBD5E1" }]}>삭제</Text>
      </TouchableOpacity>
    </View>
  );
}

const C2 = Colors.light;
const s = StyleSheet.create({
  card:        { borderRadius: 18, padding: 20, shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  cardTitle:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginBottom: 4 },
  bigNum:      { fontSize: 40, fontFamily: "Pretendard-Regular" },
  sub:         { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginBottom: 6 },
  gaugeWrap:   { height: 12, backgroundColor: C.border, borderRadius: 6, overflow: "hidden" },
  gaugeBar:    { height: 12, borderRadius: 6 },
  statCard:    { flexDirection: "row", alignItems: "center", gap: 16, padding: 16, borderRadius: 18, shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  statIcon:    { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  statLabel:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginBottom: 2 },
  statValue:   { fontSize: 22, fontFamily: "Pretendard-Regular" },

  sectionTitle: { fontSize: 16, fontFamily: "Pretendard-Regular", color: C.textPrimary, marginBottom: 4 },
  sectionDesc:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },

  cleanCard:   { flexDirection: "row", alignItems: "center", padding: 16, borderRadius: 18, gap: 12, shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  cleanIcon:   { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  cleanLabel:  { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textPrimary, marginBottom: 2 },
  cleanCount:  { fontSize: 20, fontFamily: "Pretendard-Regular" },
  cleanSize:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 1 },
  cleanEmpty:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2 },
  deleteButton:     { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#D96C6C", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12 },
  deleteBtnDisabled:{ backgroundColor: C.backgroundSoft },
  deleteBtnTxt:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#FFF" },

  overlay:     { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", padding: 24 },
  modal:       { width: "100%", borderRadius: 24, padding: 28, alignItems: "center", gap: 6 },
  modalIconWrap:{ width: 56, height: 56, borderRadius: 16, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center", marginBottom: 8 },
  modalTitle:  { fontSize: 17, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  modalCount:  { fontSize: 32, fontFamily: "Pretendard-Regular", color: "#D96C6C", marginTop: 4 },
  modalSize:   { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  modalWarn:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted, textAlign: "center", marginTop: 12, lineHeight: 20 },
  modalBtns:   { flexDirection: "row", gap: 12, marginTop: 20, width: "100%" },
  modalBtn:    { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: "center" },
  cancelBtn:   { backgroundColor: C.backgroundSoft },
  cancelTxt:   { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  deleteBtn:   { backgroundColor: "#D96C6C" },
  deleteTxt:   { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#FFF" },
});
