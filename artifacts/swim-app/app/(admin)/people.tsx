/**
 * 사람 탭 — 회원 / 학부모 / 선생님 / 승인 / 미등록
 * 실 DB: /students, /admin/teachers, /admin/parents, /parent-students/pending
 * 미등록: /admin/unregistered (bulk_upload, status=unregistered)
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { PageHeader } from "@/components/common/PageHeader";
import { ConfirmModal } from "@/components/common/ConfirmModal";

const C = Colors.light;
const TAB_BAR_H = Platform.OS === "web" ? 84 : Platform.OS === "android" ? 56 : 49;
const TABS = ["회원", "학부모", "선생님", "승인", "미등록"] as const;
type PeopleTab = typeof TABS[number];

const MEMBER_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  active:              { label: "재원",    color: "#059669", bg: "#D1FAE5" },
  pending_parent_link: { label: "연결대기", color: "#D97706", bg: "#FEF3C7" },
  inactive:            { label: "휴원",    color: "#6B7280", bg: "#F3F4F6" },
  withdrawn:           { label: "탈퇴",    color: "#DC2626", bg: "#FEE2E2" },
  deleted:             { label: "삭제",    color: "#9CA3AF", bg: "#F9FAFB" },
};

const INVITE_STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  none:    { label: "초대 전",   color: "#6B7280", bg: "#F3F4F6" },
  invited: { label: "초대 완료", color: "#2563EB", bg: "#DBEAFE" },
  joined:  { label: "가입 완료", color: "#059669", bg: "#D1FAE5" },
};

type ParseRow = { name: string; parent_phone: string; result: "ok" | "duplicate" | "error"; reason?: string };

function parseCsvText(text: string): { name: string; parent_phone: string }[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rows: { name: string; parent_phone: string }[] = [];
  const startIdx = lines.length > 0 && (lines[0].includes("학생") || lines[0].includes("이름")) ? 1 : 0;
  for (let i = startIdx; i < lines.length; i++) {
    const parts = lines[i].split(",").map(p => p.trim().replace(/^"|"$/g, ""));
    if (parts.length >= 2) {
      rows.push({ name: parts[0], parent_phone: parts[1] });
    }
  }
  return rows;
}

async function readFileText(uri: string): Promise<string> {
  if (Platform.OS === "web") {
    const resp = await fetch(uri);
    return resp.text();
  } else {
    const FS = await import("expo-file-system");
    return FS.readAsStringAsync(uri);
  }
}

function downloadCsvTemplate() {
  const content = "학생 이름,학부모 전화번호\n홍길동,01012345678";
  if (Platform.OS === "web") {
    const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "swimnote_회원등록_템플릿.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
}

export default function PeopleScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();

  const [tab, setTab]         = useState<PeopleTab>("회원");
  const [members, setMembers] = useState<any[]>([]);
  const [parents, setParents] = useState<any[]>([]);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [approvals, setApprovals] = useState<any[]>([]);
  const [unregistered, setUnregistered] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [inviting, setInviting] = useState(false);
  const [showInviteConfirm, setShowInviteConfirm] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [parseResults, setParseResults] = useState<ParseRow[]>([]);
  const [showValidate, setShowValidate] = useState(false);

  const loadData = useCallback(async (which: PeopleTab) => {
    setLoading(true);
    try {
      if (which === "회원") {
        const r = await apiRequest(token, "/students");
        if (r.ok) setMembers(await r.json());
      } else if (which === "학부모") {
        const r = await apiRequest(token, "/admin/parents");
        if (r.ok) setParents(await r.json());
      } else if (which === "선생님") {
        const r = await apiRequest(token, "/admin/teachers");
        if (r.ok) setTeachers(await r.json());
      } else if (which === "승인") {
        const r = await apiRequest(token, "/admin/parent-requests?status=pending");
        if (r.ok) {
          const d = await r.json();
          setApprovals(Array.isArray(d) ? d : d.data || d.items || []);
        }
      } else {
        const r = await apiRequest(token, "/admin/unregistered");
        if (r.ok) setUnregistered(await r.json());
      }
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => {
    loadData(tab);
    setQ("");
    setSelectedIds(new Set());
  }, [tab]);

  const handleApprove = async (id: string, action: "approve" | "reject") => {
    await apiRequest(token, `/admin/parent-requests/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ action }),
    });
    loadData("승인");
  };

  async function pickAndUpload() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "application/vnd.ms-excel",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      const text = await readFileText(asset.uri);
      const parsed = parseCsvText(text);

      setUploading(true);
      const res = await apiRequest(token, "/admin/unregistered/bulk", {
        method: "POST",
        body: JSON.stringify({ students: parsed }),
      });
      const data = await res.json();
      setUploading(false);

      if (res.ok && data.results) {
        setParseResults(data.results as ParseRow[]);
        setShowValidate(true);
        loadData("미등록");
      }
    } catch {
      setUploading(false);
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
    loadData("미등록");
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    const filteredList = unregistered.filter(u =>
      !q || u.name?.includes(q) || u.parent_phone?.includes(q)
    );
    if (selectedIds.size === filteredList.length && filteredList.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredList.map((u: any) => u.id)));
    }
  }

  const filteredUnreg = unregistered.filter(u =>
    !q || u.name?.includes(q) || u.parent_phone?.includes(q)
  );

  const filtered = (() => {
    const lq = q.toLowerCase();
    if (tab === "회원")  return members.filter(m  => !q || m.name?.includes(q) || m.parent_name?.includes(q));
    if (tab === "학부모") return parents.filter(p  => !q || p.name?.includes(q) || p.phone?.includes(q));
    if (tab === "선생님") return teachers.filter(t => !q || t.name?.toLowerCase().includes(lq));
    if (tab === "미등록") return filteredUnreg;
    return approvals;
  })();

  const okCount = parseResults.filter(r => r.result === "ok").length;
  const errCount = parseResults.filter(r => r.result === "error").length;
  const dupCount = parseResults.filter(r => r.result === "duplicate").length;

  return (
    <View style={s.root}>
      <PageHeader
        title="사람"
        rightSlot={
          approvals.length > 0 ? (
            <View style={s.badge}><Text style={s.badgeTxt}>{approvals.length}</Text></View>
          ) : undefined
        }
      />

      {/* 탭 칩 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipRow}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
        {TABS.map(t => (
          <Pressable key={t} onPress={() => setTab(t)}
            style={[s.chip, tab === t && { backgroundColor: themeColor, borderColor: themeColor }]}>
            <Text style={[s.chipTxt, tab === t && { color: "#fff" }]}>{t}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* 미등록 탭 액션 바 */}
      {tab === "미등록" && (
        <View style={s.uploadRow}>
          <Pressable style={s.tplBtn} onPress={downloadCsvTemplate}>
            <Feather name="download" size={13} color="#4338CA" />
            <Text style={s.tplBtnTxt}>템플릿 다운로드</Text>
          </Pressable>
          <Pressable style={[s.tplBtn, { backgroundColor: themeColor + "18", borderColor: themeColor }]}
            onPress={pickAndUpload} disabled={uploading}>
            {uploading
              ? <ActivityIndicator size="small" color={themeColor} />
              : <><Feather name="upload" size={13} color={themeColor} /><Text style={[s.tplBtnTxt, { color: themeColor }]}>CSV 업로드</Text></>
            }
          </Pressable>
        </View>
      )}

      {/* 검색 + 전체선택 */}
      {tab !== "승인" && (
        <View style={{ gap: 0 }}>
          <View style={s.searchBar}>
            <Feather name="search" size={15} color={C.textSecondary} />
            <TextInput style={s.searchInput} value={q} onChangeText={setQ}
              placeholder={
                tab === "회원" ? "이름·보호자 검색" :
                tab === "선생님" ? "이름 검색" :
                tab === "미등록" ? "이름·전화번호 검색" : "이름·연락처 검색"}
              placeholderTextColor={C.textSecondary} />
            {!!q && <Pressable onPress={() => setQ("")}><Feather name="x" size={15} color={C.textSecondary} /></Pressable>}
          </View>
          {tab === "미등록" && (
            <Pressable style={s.allSelectRow} onPress={toggleAll}>
              <View style={[s.checkbox,
                selectedIds.size > 0 && selectedIds.size === filteredUnreg.length
                  ? { backgroundColor: themeColor, borderColor: themeColor }
                  : {}
              ]}>
                {selectedIds.size > 0 && selectedIds.size === filteredUnreg.length &&
                  <Feather name="check" size={10} color="#fff" />}
              </View>
              <Text style={s.allSelectTxt}>전체 선택 ({filteredUnreg.length}명)</Text>
            </Pressable>
          )}
        </View>
      )}

      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={themeColor} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item, i) => item.id || item.link_id || String(i)}
          contentContainerStyle={{
            paddingHorizontal: 16, paddingTop: 6,
            paddingBottom: TAB_BAR_H + (tab === "미등록" && selectedIds.size > 0 ? 80 : 16),
          }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => loadData(tab)} />}
          ListEmptyComponent={<View style={s.empty}><Text style={s.emptyTxt}>항목이 없습니다</Text></View>}
          renderItem={({ item }) => {
            if (tab === "회원")    return <MemberRow item={item} themeColor={themeColor} />;
            if (tab === "학부모")  return <ParentRow item={item} />;
            if (tab === "선생님")  return <TeacherRow item={item} themeColor={themeColor} />;
            if (tab === "미등록")  return (
              <UnregRow item={item} selected={selectedIds.has(item.id)} onToggle={() => toggleSelect(item.id)} />
            );
            return <ApprovalRow item={item} onAction={handleApprove} themeColor={themeColor} />;
          }}
        />
      )}

      {/* 미등록 - 선택 시 하단 초대 버튼 */}
      {tab === "미등록" && selectedIds.size > 0 && (
        <View style={[s.inviteBar, { bottom: TAB_BAR_H }]}>
          <Text style={s.inviteCount}>{selectedIds.size}명 선택됨</Text>
          <Pressable style={[s.inviteBtn, { backgroundColor: themeColor }]}
            onPress={() => setShowInviteConfirm(true)} disabled={inviting}>
            {inviting
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={s.inviteBtnTxt}>학부모 초대 발송</Text>
            }
          </Pressable>
        </View>
      )}

      {/* 업로드 결과 검증 Modal */}
      <Modal visible={showValidate} transparent animationType="slide" onRequestClose={() => setShowValidate(false)}>
        <View style={s.modalOverlay}>
          <View style={s.validateSheet}>
            <View style={s.validateHeader}>
              <Text style={s.validateTitle}>업로드 검증 결과</Text>
              <Pressable onPress={() => setShowValidate(false)}>
                <Feather name="x" size={20} color={C.textSecondary} />
              </Pressable>
            </View>
            <View style={s.validateSummary}>
              <SummaryChip label="정상" count={okCount} color="#059669" bg="#D1FAE5" />
              <SummaryChip label="중복" count={dupCount} color="#D97706" bg="#FEF3C7" />
              <SummaryChip label="오류" count={errCount} color="#DC2626" bg="#FEE2E2" />
            </View>
            {okCount > 0 && (
              <Text style={s.validateNote}>정상 {okCount}건이 미등록회원 명단에 추가되었습니다.</Text>
            )}
            <ScrollView style={s.validateList} showsVerticalScrollIndicator={false}>
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
                    row.result === "ok" ? { color: "#059669" } :
                    row.result === "duplicate" ? { color: "#D97706" } : { color: "#DC2626" }
                  ]}>
                    {row.result === "ok" ? "정상" : row.result === "duplicate" ? "중복" : "오류"}
                  </Text>
                </View>
              ))}
            </ScrollView>
            <Pressable style={[s.validateClose, { backgroundColor: themeColor }]}
              onPress={() => setShowValidate(false)}>
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>확인</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* 초대 발송 확인 */}
      <ConfirmModal
        visible={showInviteConfirm}
        title="학부모 초대 발송"
        message={`선택한 ${selectedIds.size}명의 학부모에게 초대 문자를 발송하시겠습니까?`}
        confirmText="발송"
        cancelText="취소"
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

function UnregRow({ item, selected, onToggle }: { item: any; selected: boolean; onToggle: () => void }) {
  const inv = INVITE_STATUS_LABEL[item.invite_status || "none"] || INVITE_STATUS_LABEL.none;
  const isAssigned = item.status !== "unregistered";
  return (
    <Pressable style={s.card} onPress={onToggle}>
      <View style={s.row}>
        <View style={[s.checkbox, selected ? { backgroundColor: "#1A5CFF", borderColor: "#1A5CFF" } : {}]}>
          {selected && <Feather name="check" size={10} color="#fff" />}
        </View>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Text style={s.name}>{item.name}</Text>
            <View style={[s.pill, { backgroundColor: inv.bg }]}>
              <Text style={[s.pillTxt, { color: inv.color }]}>{inv.label}</Text>
            </View>
            {isAssigned && (
              <View style={[s.pill, { backgroundColor: "#D1FAE5" }]}>
                <Text style={[s.pillTxt, { color: "#059669" }]}>정상회원 전환</Text>
              </View>
            )}
          </View>
          <Text style={s.sub}>학부모: {item.parent_phone || "-"}</Text>
          <Text style={s.sub2}>등록일: {item.created_at ? new Date(item.created_at).toLocaleDateString("ko-KR") : "-"}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function MemberRow({ item, themeColor }: { item: any; themeColor: string }) {
  const st = MEMBER_STATUS[item.status] || MEMBER_STATUS.active;
  return (
    <Pressable style={s.card} onPress={() => router.push({ pathname: "/(admin)/member-detail", params: { id: item.id } })}>
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Text style={s.name}>{item.name}</Text>
            <View style={[s.pill, { backgroundColor: st.bg }]}>
              <Text style={[s.pillTxt, { color: st.color }]}>{st.label}</Text>
            </View>
          </View>
          <Text style={s.sub}>{item.class_group_name || "반 미배정"}  {item.instructor ? `· ${item.instructor}` : ""}</Text>
          <Text style={s.sub2}>보호자: {item.parent_name || "-"}  {item.parent_phone || ""}</Text>
        </View>
        <Feather name="chevron-right" size={18} color={C.textSecondary} />
      </View>
    </Pressable>
  );
}

function ParentRow({ item }: { item: any }) {
  const children: any[] = item.children || [];
  const isLinked = children.some((c: any) => c.ps_status === "active");
  return (
    <View style={s.card}>
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <Text style={s.name}>{item.name}</Text>
          <Text style={s.sub}>연락처: {item.phone || "-"}</Text>
          {children.length > 0 && (
            <Text style={s.sub2}>자녀: {children.map((c: any) => c.name).join(", ")}</Text>
          )}
        </View>
        <View style={[s.pill, { backgroundColor: isLinked ? "#D1FAE5" : "#FEF3C7" }]}>
          <Text style={[s.pillTxt, { color: isLinked ? "#059669" : "#D97706" }]}>
            {isLinked ? "연결완료" : "연결대기"}
          </Text>
        </View>
      </View>
    </View>
  );
}

function TeacherRow({ item, themeColor }: { item: any; themeColor: string }) {
  return (
    <Pressable style={s.card}
      onPress={() => router.push({ pathname: "/(admin)/teacher-hub", params: { id: item.id, name: item.name } })}>
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <Text style={s.name}>{item.name}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            <Chip label={`담당반 ${item.class_count ?? 0}`} />
            <Chip label={`회원 ${item.student_count ?? 0}`} />
            <Chip label={`오늘출결 ${item.today_att ?? 0}`} />
            <Chip label={`오늘일지 ${item.today_diary ?? 0}`} />
            {(item.makeup_waiting ?? 0) > 0 && <Chip label={`보강대기 ${item.makeup_waiting}`} warn />}
          </View>
        </View>
        <Feather name="chevron-right" size={18} color={C.textSecondary} />
      </View>
    </Pressable>
  );
}

function Chip({ label, warn }: { label: string; warn?: boolean }) {
  return (
    <View style={[s.chip2, warn && { backgroundColor: "#FEE2E2" }]}>
      <Text style={[s.chip2Txt, warn && { color: "#DC2626" }]}>{label}</Text>
    </View>
  );
}

function ApprovalRow({ item, onAction, themeColor }: {
  item: any; onAction: (id: string, a: "approve" | "reject") => void; themeColor: string
}) {
  const linkId = item.link_id || item.id;
  return (
    <View style={s.card}>
      <Text style={s.name}>{item.parent?.name || item.parent_name || "학부모"}  자녀: {item.student?.name || item.student_name || item.child_name || "미지정"}</Text>
      <Text style={s.sub}>연락처: {item.parent?.phone || item.parent_phone || item.phone || "-"}</Text>
      <Text style={s.sub2}>{new Date(item.requested_at || item.created_at).toLocaleDateString("ko-KR")}</Text>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
        <Pressable style={[s.actionBtn, { backgroundColor: themeColor }]} onPress={() => onAction(linkId, "approve")}>
          <Text style={s.actionBtnTxt}>승인</Text>
        </Pressable>
        <Pressable style={[s.actionBtn, { backgroundColor: "#FEE2E2" }]} onPress={() => onAction(linkId, "reject")}>
          <Text style={[s.actionBtnTxt, { color: "#DC2626" }]}>거절</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root:           { flex: 1, backgroundColor: C.background },
  badge:          { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: "#EF4444", alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  badgeTxt:       { color: "#fff", fontSize: 11, fontWeight: "700" },
  chipRow:        { flexGrow: 0, paddingVertical: 6 },
  chip:           { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: C.border, backgroundColor: "#fff" },
  chipTxt:        { fontSize: 13, fontWeight: "600", color: C.textSecondary },
  chip2:          { backgroundColor: "#F3F4F6", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  chip2Txt:       { fontSize: 11, color: C.textSecondary },
  uploadRow:      { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 6 },
  tplBtn:         { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 9, borderRadius: 10, borderWidth: 1.5, borderColor: "#4338CA", backgroundColor: "#EEF2FF" },
  tplBtnTxt:      { fontSize: 12, fontWeight: "700", color: "#4338CA" },
  searchBar:      { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginBottom: 4, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: "#F3F4F6", borderRadius: 10 },
  searchInput:    { flex: 1, fontSize: 14, color: C.text },
  allSelectRow:   { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  allSelectTxt:   { fontSize: 13, color: C.textSecondary },
  checkbox:       { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: "#D1D5DB", alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  card:           { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 8, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  row:            { flexDirection: "row", alignItems: "center" },
  name:           { fontSize: 15, fontWeight: "700", color: C.text },
  sub:            { fontSize: 12, color: C.textSecondary, marginTop: 3 },
  sub2:           { fontSize: 11, color: C.textSecondary, marginTop: 1 },
  pill:           { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  pillTxt:        { fontSize: 11, fontWeight: "600" },
  actionBtn:      { flex: 1, borderRadius: 8, paddingVertical: 9, alignItems: "center" },
  actionBtnTxt:   { fontSize: 13, fontWeight: "700", color: "#fff" },
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
  validateList:   { flexShrink: 1 },
  validateRow:    { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  rowOk:          { backgroundColor: "#F0FDF4" },
  rowDup:         { backgroundColor: "#FFFBEB" },
  rowErr:         { backgroundColor: "#FFF1F2" },
  validateName:   { fontSize: 14, fontWeight: "600", color: C.text },
  validatePhone:  { fontSize: 12, color: C.textSecondary, marginTop: 1 },
  validateReason: { fontSize: 11, color: "#DC2626", marginTop: 2 },
  validateBadge:  { fontSize: 12, fontWeight: "700" },
  validateClose:  { marginHorizontal: 16, marginTop: 12, paddingVertical: 13, borderRadius: 12, alignItems: "center" },
});
