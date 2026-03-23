/**
 * (super)/notices.tsx — 공지 관리
 * 슈퍼관리자가 대상별 공지를 등록/수정/삭제.
 * 앱 실행 시 대상 역할에 해당하는 최신 공지가 팝업으로 노출됨(NoticePopup).
 */
import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useNoticeStore, type Notice, type NoticeTarget, type NoticeType, NOTICE_TYPE_CFG } from "@/store/noticeStore";
import { useAuditLogStore } from "@/store/auditLogStore";
import { useAuth } from "@/context/AuthContext";

const P = "#7C3AED";

const TARGET_CFG: Record<NoticeTarget, { label: string; color: string; bg: string }> = {
  all:     { label: "전체",     color: "#1F8F86", bg: "#DDF2EF" },
  admin:   { label: "관리자",   color: P,         bg: "#EEDDF5" },
  teacher: { label: "선생님",   color: "#1F8F86", bg: "#DDF2EF" },
  parent:  { label: "학부모",   color: "#1F8F86", bg: "#E0F2FE" },
};

function NoticeCard({ notice, onEdit, onDelete, isLatest }: {
  notice: Notice;
  onEdit: (n: Notice) => void;
  onDelete: (id: string) => void;
  isLatest?: boolean;
}) {
  const cfg = TARGET_CFG[notice.target];
  const ntCfg = NOTICE_TYPE_CFG[notice.noticeType ?? "general"];
  const d = new Date(notice.createdAt);
  const dateStr = isNaN(d.getTime()) ? "—" : d.toLocaleDateString("ko-KR");

  return (
    <View style={[nc.card, isLatest && nc.cardLatest]}>
      {isLatest && (
        <View style={nc.latestBadge}>
          <Feather name="radio" size={9} color="#1F8F86" />
          <Text style={nc.latestTxt}>현재 노출 중</Text>
        </View>
      )}
      <View style={nc.top}>
        {/* 공지 유형 */}
        <View style={[nc.typeBadge, { backgroundColor: ntCfg.bg }]}>
          <Feather name={ntCfg.icon as any} size={9} color={ntCfg.color} />
          <Text style={[nc.typeTxt, { color: ntCfg.color }]}>{ntCfg.label}</Text>
        </View>
        {/* 대상 */}
        <View style={[nc.targetBadge, { backgroundColor: cfg.bg }]}>
          <Text style={[nc.targetTxt, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
        {notice.forcedAck && (
          <View style={nc.forcedBadge}>
            <Feather name="lock" size={10} color="#D96C6C" />
            <Text style={nc.forcedTxt}>강제 확인</Text>
          </View>
        )}
        <Text style={nc.date}>{dateStr}</Text>
      </View>
      <Text style={nc.title} numberOfLines={1}>{notice.title}</Text>
      <Text style={nc.content} numberOfLines={2}>{notice.content}</Text>
      <Text style={nc.by}>등록: {notice.createdBy} · 노출시작: {notice.showFrom ? new Date(notice.showFrom).toLocaleDateString("ko-KR") : "즉시"}</Text>
      <View style={nc.actions}>
        <Pressable style={[nc.btn, { backgroundColor: "#EEDDF5" }]} onPress={() => onEdit(notice)}>
          <Text style={[nc.btnTxt, { color: P }]}>수정</Text>
        </Pressable>
        <Pressable style={[nc.btn, { backgroundColor: "#F9DEDA" }]} onPress={() => onDelete(notice.id)}>
          <Text style={[nc.btnTxt, { color: "#D96C6C" }]}>삭제</Text>
        </Pressable>
      </View>
    </View>
  );
}

const nc = StyleSheet.create({
  card:         { backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#E9E2DD" },
  cardLatest:   { borderColor: "#1F8F86", borderWidth: 1.5 },
  latestBadge:  { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start",
                  backgroundColor: "#DDF2EF", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7, marginBottom: 6 },
  latestTxt:    { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#1F8F86" },
  typeBadge:    { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7 },
  typeTxt:      { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  top:          { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 8, flexWrap: "wrap" },
  targetBadge:  { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7 },
  targetTxt:    { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  forcedBadge:  { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#F9DEDA",
                  paddingHorizontal: 6, paddingVertical: 3, borderRadius: 7 },
  forcedTxt:    { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#D96C6C" },
  date:         { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9A948F", marginLeft: "auto" },
  title:        { fontSize: 15, fontFamily: "Inter_700Bold", color: "#1F1F1F", marginBottom: 4 },
  content:      { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6F6B68", lineHeight: 18, marginBottom: 6 },
  by:           { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9A948F", marginBottom: 8 },
  actions:      { flexDirection: "row", gap: 6 },
  btn:          { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  btnTxt:       { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});

interface FormState {
  title: string; content: string;
  target: NoticeTarget; noticeType: NoticeType; showFrom: string; forcedAck: boolean;
}

const BLANK: FormState = {
  title: "", content: "", target: "all",
  noticeType: "general",
  showFrom: new Date().toISOString().slice(0, 16), // "YYYY-MM-DDTHH:mm"
  forcedAck: true,
};

export default function NoticesScreen() {
  const { adminUser } = useAuth();
  const actorName = adminUser?.name ?? "슈퍼관리자";

  const notices      = useNoticeStore(s => s.notices);
  const createNotice = useNoticeStore(s => s.createNotice);
  const updateNotice = useNoticeStore(s => s.updateNotice);
  const deleteNotice = useNoticeStore(s => s.deleteNotice);
  const createLog    = useAuditLogStore(s => s.createLog);

  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(BLANK);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [filterTarget, setFilterTarget] = useState<"all" | NoticeTarget>("all");

  const filtered = useMemo(() => {
    if (filterTarget === "all") return notices;
    return notices.filter(n => n.target === filterTarget);
  }, [notices, filterTarget]);

  function openCreate() {
    setEditId(null);
    setForm(BLANK);
    setShowModal(true);
  }

  function openEdit(n: Notice) {
    setEditId(n.id);
    setForm({
      title: n.title, content: n.content, target: n.target,
      noticeType: n.noticeType ?? "general",
      showFrom: n.showFrom ? new Date(n.showFrom).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16),
      forcedAck: n.forcedAck,
    });
    setShowModal(true);
  }

  function handleSave() {
    if (!form.title.trim() || !form.content.trim()) return;
    // showFrom을 ISO 문자열로 안전 변환
    const showFromISO = form.showFrom ? new Date(form.showFrom).toISOString() : new Date().toISOString();
    const payload = { ...form, showFrom: showFromISO };
    if (editId) {
      updateNotice(editId, payload);
      createLog({ category: "공지관리", title: `공지 수정: ${form.title}`, actorName, impact: "medium",
        detail: `대상: ${form.target} / 유형: ${form.noticeType}` });
    } else {
      const n = createNotice({ ...payload, createdBy: actorName });
      createLog({ category: "공지관리", title: `공지 등록: ${n.title}`, actorName, impact: "medium",
        detail: `대상: ${form.target} / 유형: ${form.noticeType} / 강제확인: ${form.forcedAck}` });
    }
    setShowModal(false);
  }

  function handleDelete(id: string) {
    const n = notices.find(x => x.id === id);
    deleteNotice(id);
    createLog({ category: "공지관리", title: `공지 삭제: ${n?.title ?? id}`, actorName, impact: "medium", detail: "삭제" });
    setDeleteConfirm(null);
  }

  const FILTER_TARGETS = ["all", "all_notice", "admin", "teacher", "parent"] as const;
  const FILTER_ITEMS: { key: "all" | NoticeTarget; label: string }[] = [
    { key: "all",     label: "전체" },
    { key: "admin",   label: "관리자" },
    { key: "teacher", label: "선생님" },
    { key: "parent",  label: "학부모" },
  ];

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="공지 관리" homePath="/(super)/dashboard" />

      {/* 안내 */}
      <View style={s.infoBanner}>
        <Feather name="bell" size={12} color="#1F8F86" />
        <Text style={s.infoTxt}>
          최신 공지 1개가 대상 역할에 맞게 앱 실행 시 팝업으로 노출됩니다. 새 공지 등록 시 이전 공지는 대체됩니다.
        </Text>
      </View>

      {/* 필터 + 등록 */}
      <View style={s.filterRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {FILTER_ITEMS.map(f => (
              <Pressable key={f.key} style={[s.filterBtn, filterTarget === f.key && s.filterActive]}
                onPress={() => setFilterTarget(f.key)}>
                <Text style={[s.filterTxt, filterTarget === f.key && s.filterActiveTxt]}>{f.label}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
        <Pressable style={s.addBtn} onPress={openCreate}>
          <Feather name="plus" size={16} color="#fff" />
          <Text style={s.addTxt}>공지 등록</Text>
        </Pressable>
      </View>

      {/* 목록 */}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 10 }}>
        {filtered.length === 0 ? (
          <View style={s.empty}>
            <Feather name="bell-off" size={36} color="#D1D5DB" />
            <Text style={s.emptyTxt}>등록된 공지가 없습니다</Text>
          </View>
        ) : (
          filtered.map((n, idx) => (
            <NoticeCard key={n.id} notice={n} onEdit={openEdit}
              onDelete={(id) => setDeleteConfirm(id)}
              isLatest={idx === 0 && filterTarget === "all"} />
          ))
        )}
      </ScrollView>

      {/* 등록/수정 모달 */}
      <Modal visible={showModal} transparent animationType="slide">
        <View style={m.overlay}>
          <View style={m.sheet}>
            <View style={m.header}>
              <Text style={m.title}>{editId ? "공지 수정" : "공지 등록"}</Text>
              <Pressable onPress={() => setShowModal(false)}>
                <Feather name="x" size={20} color="#6F6B68" />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={m.label}>제목 *</Text>
              <TextInput style={m.input} value={form.title} onChangeText={v => setForm(f => ({ ...f, title: v }))}
                placeholder="공지 제목을 입력하세요" />
              <Text style={m.label}>내용 *</Text>
              <TextInput style={[m.input, { height: 120, textAlignVertical: "top" }]}
                value={form.content} onChangeText={v => setForm(f => ({ ...f, content: v }))}
                placeholder="공지 내용을 입력하세요" multiline />
              <Text style={m.label}>공지 유형</Text>
              <View style={m.segRow}>
                {(Object.keys(NOTICE_TYPE_CFG) as NoticeType[]).map(t => (
                  <Pressable key={t} style={[m.segBtn, form.noticeType === t && { backgroundColor: NOTICE_TYPE_CFG[t].bg, borderColor: NOTICE_TYPE_CFG[t].color }]}
                    onPress={() => setForm(f => ({ ...f, noticeType: t }))}>
                    <Text style={[m.segTxt, form.noticeType === t && { color: NOTICE_TYPE_CFG[t].color }]}>
                      {NOTICE_TYPE_CFG[t].label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={m.label}>대상</Text>
              <View style={m.segRow}>
                {(["all","admin","teacher","parent"] as NoticeTarget[]).map(t => (
                  <Pressable key={t} style={[m.segBtn, form.target === t && m.segActive]}
                    onPress={() => setForm(f => ({ ...f, target: t }))}>
                    <Text style={[m.segTxt, form.target === t && m.segActiveTxt]}>
                      {TARGET_CFG[t].label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={m.label}>노출 시작일시</Text>
              <TextInput style={m.input} value={form.showFrom}
                onChangeText={v => setForm(f => ({ ...f, showFrom: v }))}
                placeholder="YYYY-MM-DDTHH:mm (예: 2026-04-01T09:00)"
                autoCapitalize="none" />
              <Text style={m.hint}>입력 형식: 2026-04-01T09:00 — 빈값이면 즉시 노출</Text>
              <Text style={m.label}>강제 확인 여부</Text>
              <View style={m.segRow}>
                <Pressable style={[m.segBtn, form.forcedAck && m.segActive]}
                  onPress={() => setForm(f => ({ ...f, forcedAck: true }))}>
                  <Text style={[m.segTxt, form.forcedAck && m.segActiveTxt]}>강제 확인</Text>
                </Pressable>
                <Pressable style={[m.segBtn, !form.forcedAck && m.segActive]}
                  onPress={() => setForm(f => ({ ...f, forcedAck: false }))}>
                  <Text style={[m.segTxt, !form.forcedAck && m.segActiveTxt]}>선택 확인</Text>
                </Pressable>
              </View>
            </ScrollView>
            <View style={m.footer}>
              <Pressable style={m.cancelBtn} onPress={() => setShowModal(false)}>
                <Text style={m.cancelTxt}>취소</Text>
              </Pressable>
              <Pressable style={[m.saveBtn, (!form.title.trim() || !form.content.trim()) && { opacity: 0.4 }]}
                onPress={handleSave} disabled={!form.title.trim() || !form.content.trim()}>
                <Text style={m.saveTxt}>{editId ? "저장" : "등록"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* 삭제 확인 */}
      <Modal visible={!!deleteConfirm} transparent animationType="fade">
        <View style={m.overlay}>
          <View style={[m.sheet, { maxHeight: 240 }]}>
            <Text style={[m.title, { marginBottom: 12 }]}>공지 삭제</Text>
            <Text style={{ fontSize: 14, color: "#1F1F1F", marginBottom: 8 }}>
              이 공지를 삭제하면 앱에서 더 이상 노출되지 않습니다.
            </Text>
            <Text style={{ fontSize: 13, color: "#D96C6C", marginBottom: 20 }}>
              삭제된 공지는 복구되지 않습니다.
            </Text>
            <View style={m.footer}>
              <Pressable style={m.cancelBtn} onPress={() => setDeleteConfirm(null)}>
                <Text style={m.cancelTxt}>취소</Text>
              </Pressable>
              <Pressable style={[m.saveBtn, { backgroundColor: "#D96C6C" }]} onPress={() => handleDelete(deleteConfirm!)}>
                <Text style={m.saveTxt}>삭제</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#FBF8F6" },
  infoBanner:   { flexDirection: "row", gap: 6, alignItems: "flex-start", backgroundColor: "#DDF2EF",
                  padding: 10, paddingHorizontal: 16 },
  infoTxt:      { fontSize: 11, fontFamily: "Inter_400Regular", color: "#1F8F86", flex: 1 },
  filterRow:    { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  filterBtn:    { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: "#F6F3F1" },
  filterActive: { backgroundColor: P },
  filterTxt:    { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#6F6B68" },
  filterActiveTxt: { color: "#fff" },
  addBtn:       { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: P,
                  paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  addTxt:       { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
  empty:        { alignItems: "center", paddingVertical: 48, gap: 10 },
  emptyTxt:     { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9A948F" },
});

const m = StyleSheet.create({
  overlay:      { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:        { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "90%" },
  header:       { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title:        { fontSize: 17, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  label:        { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#1F1F1F", marginBottom: 4, marginTop: 12 },
  input:        { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 10, padding: 10, fontSize: 14,
                  fontFamily: "Inter_400Regular", color: "#1F1F1F", backgroundColor: "#FBF8F6" },
  segRow:       { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  segBtn:       { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: "#F6F3F1" },
  segActive:    { backgroundColor: P },
  segTxt:       { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#6F6B68" },
  segActiveTxt: { color: "#fff" },
  footer:       { flexDirection: "row", gap: 8, marginTop: 20 },
  hint:         { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9A948F", marginBottom: 10, marginTop: -8 },
  cancelBtn:    { flex: 1, padding: 13, borderRadius: 10, backgroundColor: "#F6F3F1", alignItems: "center" },
  cancelTxt:    { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#1F1F1F" },
  saveBtn:      { flex: 2, padding: 13, borderRadius: 10, backgroundColor: P, alignItems: "center" },
  saveTxt:      { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
