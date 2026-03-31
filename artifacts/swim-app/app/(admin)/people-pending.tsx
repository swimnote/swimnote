/**
 * 미배정회원 화면
 * 반 배정이 안 된 학생 명단 관리 + CSV 업로드 + 학부모 초대
 */
import { Check, Download, Search, Upload, X } from "lucide-react-native";
import { router } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, safeJson, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { ConfirmModal } from "@/components/common/ConfirmModal";

const C = Colors.light;
const TAB_BAR_H = Platform.OS === "web" ? 84 : Platform.OS === "android" ? 56 : 49;

interface UnregItem {
  id: string;
  name: string;
  parent_phone?: string;
  parent_name?: string;
  parent_user_id?: string | null;
  invite_status?: string;
  status?: string;
  created_at?: string;
}

type ParseRow = { name: string; parent_phone: string; result: "ok" | "duplicate" | "error"; reason?: string };

const INVITE_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  none:    { label: "초대 전",   color: "#64748B", bg: "#F1F5F9" },
  invited: { label: "초대 완료", color: "#2EC4B6", bg: "#E6FFFA" },
  joined:  { label: "가입 완료", color: "#2EC4B6", bg: "#E6FFFA" },
};

async function readFileText(uri: string): Promise<string> {
  if (Platform.OS === "web") return (await fetch(uri)).text();
  const FS = await import("expo-file-system");
  return FS.readAsStringAsync(uri);
}

function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const startIdx = lines.length > 0 && (lines[0].includes("학생") || lines[0].includes("이름")) ? 1 : 0;
  return lines.slice(startIdx).map(l => {
    const parts = l.split(",").map(p => p.trim().replace(/^"|"$/g, ""));
    return { name: parts[0] ?? "", parent_phone: parts[1] ?? "" };
  }).filter(r => r.name);
}

function downloadTemplate() {
  if (Platform.OS !== "web") return;
  const blob = new Blob(["\uFEFF학생 이름,학부모 전화번호\n홍길동,01012345678"], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "swimnote_회원등록_템플릿.csv"; a.click();
  URL.revokeObjectURL(url);
}

export default function PeoplePendingScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const [unreg, setUnreg] = useState<UnregItem[]>([]);
  const [loadingUnreg, setLoadingUnreg] = useState(false);
  const [q, setQ] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showInviteConfirm, setShowInviteConfirm] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [parseResults, setParseResults] = useState<ParseRow[]>([]);
  const [showValidate, setShowValidate] = useState(false);

  const loadUnreg = useCallback(async () => {
    if (!token) return;
    setLoadingUnreg(true);
    try {
      const r = await apiRequest(token, "/admin/unregistered");
      if (r.ok) setUnreg(await safeJson(r));
    } finally { setLoadingUnreg(false); }
  }, [token]);

  useEffect(() => { loadUnreg(); }, [loadUnreg]);

  const filteredUnreg = unreg.filter(u =>
    !q || u.name?.includes(q) || u.parent_phone?.includes(q)
  );

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === filteredUnreg.length && filteredUnreg.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredUnreg.map(u => u.id)));
    }
  }

  async function sendInvites() {
    if (selectedIds.size === 0) return;
    setInviting(true);
    await apiRequest(token, "/admin/unregistered/invite", {
      method: "POST",
      body: JSON.stringify({ ids: Array.from(selectedIds) }),
    });
    setInviting(false);
    setSelectedIds(new Set());
    loadUnreg();
  }

  async function pickAndUpload() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "application/vnd.ms-excel",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const text = await readFileText(result.assets[0].uri);
      const parsed = parseCsv(text);
      setUploading(true);
      const res = await apiRequest(token, "/admin/unregistered/bulk", {
        method: "POST",
        body: JSON.stringify({ students: parsed }),
      });
      const data = await safeJson(res);
      setUploading(false);
      if (res.ok && data.results) {
        setParseResults(data.results);
        setShowValidate(true);
        loadUnreg();
      }
    } catch {
      setUploading(false);
    }
  }

  const okCount  = parseResults.filter(r => r.result === "ok").length;
  const errCount = parseResults.filter(r => r.result === "error").length;
  const dupCount = parseResults.filter(r => r.result === "duplicate").length;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <SubScreenHeader title="미배정회원 관리" onBack={() => router.back()} />

      {/* 액션 버튼 */}
      <View style={s.uploadRow}>
        <Pressable style={s.tplBtn} onPress={downloadTemplate}>
          <Download size={13} color="#4338CA" />
          <Text style={s.tplBtnTxt}>템플릿 다운로드</Text>
        </Pressable>
        <Pressable
          style={[s.tplBtn, { backgroundColor: themeColor + "18", borderColor: themeColor }]}
          onPress={pickAndUpload}
          disabled={uploading}
        >
          {uploading
            ? <ActivityIndicator size="small" color={themeColor} />
            : <><Upload size={13} color={themeColor} /><Text style={[s.tplBtnTxt, { color: themeColor }]}>CSV 업로드</Text></>
          }
        </Pressable>
      </View>

      {/* 검색 */}
      <View style={s.searchBar}>
        <Search size={15} color={C.textSecondary} />
        <TextInput
          style={s.searchInput}
          value={q}
          onChangeText={setQ}
          placeholder="이름·전화번호 검색"
          placeholderTextColor={C.textSecondary}
        />
        {!!q && <Pressable onPress={() => setQ("")}><X size={15} color={C.textSecondary} /></Pressable>}
      </View>

      {/* 전체 선택 */}
      <Pressable style={s.allSelectRow} onPress={toggleAll}>
        <View style={[s.checkbox,
          selectedIds.size > 0 && selectedIds.size === filteredUnreg.length
            ? { backgroundColor: themeColor, borderColor: themeColor } : {}
        ]}>
          {selectedIds.size > 0 && selectedIds.size === filteredUnreg.length &&
            <Check size={10} color="#fff" />}
        </View>
        <Text style={s.allSelectTxt}>전체 선택 ({filteredUnreg.length}명)</Text>
        {unreg.length > 0 && (
          <View style={[s.countBadge, { backgroundColor: "#D97706" }]}>
            <Text style={s.countBadgeTxt}>미배정 {unreg.length}명</Text>
          </View>
        )}
      </Pressable>

      {loadingUnreg ? (
        <ActivityIndicator style={{ flex: 1 }} color={themeColor} />
      ) : (
        <FlatList
          data={filteredUnreg}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: TAB_BAR_H + (selectedIds.size > 0 ? 80 : 16) }}
          refreshControl={<RefreshControl refreshing={loadingUnreg} onRefresh={loadUnreg} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={s.emptyTxt}>미배정 회원이 없습니다</Text>
              <Text style={[s.emptyTxt, { fontSize: 12, marginTop: 4 }]}>회원등록 후 반을 배정하면 이 목록에서 사라집니다</Text>
            </View>
          }
          renderItem={({ item }) => {
            const inv = INVITE_LABEL[item.invite_status ?? "none"] ?? INVITE_LABEL.none;
            const hasParent = !!item.parent_user_id;
            return (
              <Pressable style={s.card} onPress={() => toggleSelect(item.id)}>
                <View style={s.row}>
                  <View style={[s.checkbox, selectedIds.has(item.id) ? { backgroundColor: themeColor, borderColor: themeColor } : {}]}>
                    {selectedIds.has(item.id) && <Check size={10} color="#fff" />}
                  </View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <Text style={s.name}>{item.name}</Text>
                      {hasParent && (
                        <View style={[s.pill, { backgroundColor: "#E6FFFA" }]}>
                          <Text style={[s.pillTxt, { color: "#2EC4B6" }]}>학부모 연결됨</Text>
                        </View>
                      )}
                      {!hasParent && (
                        <View style={[s.pill, { backgroundColor: inv.bg }]}>
                          <Text style={[s.pillTxt, { color: inv.color }]}>{inv.label}</Text>
                        </View>
                      )}
                    </View>
                    {item.parent_name && (
                      <Text style={s.sub}>학부모: {item.parent_name} {item.parent_phone ? `· ${item.parent_phone}` : ""}</Text>
                    )}
                    {!item.parent_name && item.parent_phone && (
                      <Text style={s.sub}>학부모 전화: {item.parent_phone}</Text>
                    )}
                    <Text style={s.sub2}>등록일: {item.created_at ? new Date(item.created_at).toLocaleDateString("ko-KR") : "-"}</Text>
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      {/* 선택 초대 바 */}
      {selectedIds.size > 0 && (
        <View style={[s.inviteBar, { bottom: TAB_BAR_H }]}>
          <Text style={s.inviteCount}>{selectedIds.size}명 선택됨</Text>
          <Pressable
            style={[s.inviteBtn, { backgroundColor: C.button }]}
            onPress={() => setShowInviteConfirm(true)}
            disabled={inviting}
          >
            {inviting
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={s.inviteBtnTxt}>학부모 초대 발송</Text>
            }
          </Pressable>
        </View>
      )}

      {/* 업로드 결과 Modal */}
      <Modal visible={showValidate} transparent animationType="slide" onRequestClose={() => setShowValidate(false)}>
        <View style={s.modalOverlay}>
          <View style={s.validateSheet}>
            <View style={s.validateHeader}>
              <Text style={s.validateTitle}>업로드 검증 결과</Text>
              <Pressable onPress={() => setShowValidate(false)}><X size={20} color={C.textSecondary} /></Pressable>
            </View>
            <View style={s.validateSummary}>
              <SummaryChip label="정상" count={okCount} color="#2EC4B6" bg="#E6FFFA" />
              <SummaryChip label="중복" count={dupCount} color="#D97706" bg="#FFF1BF" />
              <SummaryChip label="오류" count={errCount} color="#D96C6C" bg="#F9DEDA" />
            </View>
            {okCount > 0 && (
              <Text style={s.validateNote}>정상 {okCount}건이 미배정회원 명단에 추가되었습니다.</Text>
            )}
            <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false}>
              {parseResults.map((row, i) => (
                <View key={i} style={[s.validateRow,
                  row.result === "ok" ? s.rowOk : row.result === "duplicate" ? s.rowDup : s.rowErr
                ]}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.validateName}>{row.name || "(이름 없음)"}</Text>
                    <Text style={s.validatePhone}>{row.parent_phone || "(번호 없음)"}</Text>
                    {row.reason && <Text style={s.validateReason}>{row.reason}</Text>}
                  </View>
                  <Text style={[s.validateBadge,
                    row.result === "ok" ? { color: "#2EC4B6" } :
                    row.result === "duplicate" ? { color: "#D97706" } : { color: "#D96C6C" }
                  ]}>
                    {row.result === "ok" ? "정상" : row.result === "duplicate" ? "중복" : "오류"}
                  </Text>
                </View>
              ))}
            </ScrollView>
            <Pressable style={[s.validateClose, { backgroundColor: C.button }]} onPress={() => setShowValidate(false)}>
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>확인</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* 초대 확인 Modal */}
      <ConfirmModal
        visible={showInviteConfirm}
        title="학부모 초대 발송"
        message={`선택한 ${selectedIds.size}명의 학부모에게 앱 초대 SMS를 발송합니다.`}
        confirmText="발송"
        onConfirm={() => { setShowInviteConfirm(false); sendInvites(); }}
        onCancel={() => setShowInviteConfirm(false)}
      />
    </View>
  );
}

function SummaryChip({ label, count, color, bg }: { label: string; count: number; color: string; bg: string }) {
  return (
    <View style={[s.summaryChip, { backgroundColor: bg }]}>
      <Text style={[s.summaryLabel, { color }]}>{label} {count}건</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root:           { flex: 1, backgroundColor: C.background },

  uploadRow:      { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
  tplBtn:         { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 9, borderRadius: 10, borderWidth: 1.5, borderColor: "#4338CA", backgroundColor: "#E6FFFA" },
  tplBtnTxt:      { fontSize: 12, fontWeight: "700", color: "#4338CA" },

  searchBar:      { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginBottom: 4, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: "#FFFFFF", borderRadius: 10 },
  searchInput:    { flex: 1, fontSize: 14, color: C.text },
  allSelectRow:   { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  allSelectTxt:   { flex: 1, fontSize: 13, color: C.textSecondary },
  countBadge:     { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 },
  countBadgeTxt:  { color: "#fff", fontSize: 11, fontWeight: "700" },
  checkbox:       { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: "#D1D5DB", alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },

  card:           { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 8, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  row:            { flexDirection: "row", alignItems: "center" },
  name:           { fontSize: 15, fontWeight: "700", color: C.text },
  sub:            { fontSize: 12, color: C.textSecondary, marginTop: 3 },
  sub2:           { fontSize: 11, color: C.textSecondary, marginTop: 1 },
  pill:           { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  pillTxt:        { fontSize: 11, fontWeight: "600" },
  empty:          { paddingVertical: 40, alignItems: "center" },
  emptyTxt:       { color: C.textSecondary, fontSize: 14 },

  inviteBar:      { position: "absolute", left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  inviteCount:    { fontSize: 14, fontWeight: "600", color: C.text },
  inviteBtn:      { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  inviteBtnTxt:   { fontSize: 14, fontWeight: "700", color: "#fff" },

  modalOverlay:   { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  validateSheet:  { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "80%", paddingBottom: 32 },
  validateHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 },
  validateTitle:  { fontSize: 17, fontWeight: "700", color: C.text },
  validateSummary:{ flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 8 },
  summaryChip:    { flex: 1, borderRadius: 8, paddingVertical: 8, alignItems: "center" },
  summaryLabel:   { fontSize: 13, fontWeight: "700" },
  validateNote:   { fontSize: 12, color: "#4338CA", paddingHorizontal: 16, marginBottom: 8, fontWeight: "600" },
  validateRow:    { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#F1F5F9" },
  rowOk:          { backgroundColor: "#DFF3EC" },
  rowDup:         { backgroundColor: "#FFFBEB" },
  rowErr:         { backgroundColor: "#FFF1F2" },
  validateName:   { fontSize: 14, fontWeight: "600", color: C.text },
  validatePhone:  { fontSize: 12, color: C.textSecondary, marginTop: 1 },
  validateReason: { fontSize: 11, color: "#D96C6C", marginTop: 2 },
  validateBadge:  { fontSize: 12, fontWeight: "700" },
  validateClose:  { marginHorizontal: 16, marginTop: 12, paddingVertical: 13, borderRadius: 12, alignItems: "center" },
});
