/**
 * (super)/notices.tsx — 공지 관리
 * 슈퍼관리자가 대상별 공지를 등록/수정/삭제.
 * 앱 실행 시 대상 역할에 해당하는 최신 공지가 팝업으로 노출됨(NoticePopup).
 */
import { Bell, BellOff, Lock, Plus, Radio, X } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { type Notice, type NoticeTarget, type NoticeType, NOTICE_TYPE_CFG } from "@/store/noticeStore";
import { useAuth, apiRequest } from "@/context/AuthContext";
import { OtpGateModal } from "@/components/common/OtpGateModal";

const P = "#7C3AED";

const TARGET_CFG: Record<NoticeTarget, { label: string; color: string; bg: string }> = {
  all:     { label: "전체",     color: "#2EC4B6", bg: "#E6FFFA" },
  admin:   { label: "관리자",   color: P,         bg: "#EEDDF5" },
  teacher: { label: "선생님",   color: "#2EC4B6", bg: "#E6FFFA" },
  parent:  { label: "학부모",   color: "#2EC4B6", bg: "#E0F2FE" },
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
          <Radio size={9} color="#2EC4B6" />
          <Text style={nc.latestTxt}>현재 노출 중</Text>
        </View>
      )}
      <View style={nc.top}>
        {/* 공지 유형 */}
        <View style={[nc.typeBadge, { backgroundColor: ntCfg.bg }]}>
          <LucideIcon name={ntCfg.icon as any} size={9} color={ntCfg.color} />
          <Text style={[nc.typeTxt, { color: ntCfg.color }]}>{ntCfg.label}</Text>
        </View>
        {/* 대상 */}
        <View style={[nc.targetBadge, { backgroundColor: cfg.bg }]}>
          <Text style={[nc.targetTxt, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
        {notice.forcedAck && (
          <View style={nc.forcedBadge}>
            <Lock size={10} color="#D96C6C" />
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
  card:         { backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  cardLatest:   { borderColor: "#2EC4B6", borderWidth: 1.5 },
  latestBadge:  { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start",
                  backgroundColor: "#E6FFFA", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7, marginBottom: 6 },
  latestTxt:    { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#2EC4B6" },
  typeBadge:    { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7 },
  typeTxt:      { fontSize: 10, fontFamily: "Pretendard-Regular" },
  top:          { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 8, flexWrap: "wrap" },
  targetBadge:  { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7 },
  targetTxt:    { fontSize: 11, fontFamily: "Pretendard-Regular" },
  forcedBadge:  { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#F9DEDA",
                  paddingHorizontal: 6, paddingVertical: 3, borderRadius: 7 },
  forcedTxt:    { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#D96C6C" },
  date:         { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", marginLeft: "auto" },
  title:        { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#0F172A", marginBottom: 4 },
  content:      { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", lineHeight: 18, marginBottom: 6 },
  by:           { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B", marginBottom: 8 },
  actions:      { flexDirection: "row", gap: 6 },
  btn:          { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  btnTxt:       { fontSize: 12, fontFamily: "Pretendard-Regular" },
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

function mapApiNotice(row: any): Notice {
  return {
    id:         row.id,
    title:      row.title,
    content:    row.content,
    target:     "all" as NoticeTarget,
    noticeType: (row.notice_type as NoticeType) ?? "general",
    showFrom:   row.created_at ?? new Date().toISOString(),
    forcedAck:  false,
    createdAt:  row.created_at ?? new Date().toISOString(),
    createdBy:  row.author_name ?? "슈퍼관리자",
  };
}

export default function NoticesScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();

  const [notices,    setNotices]    = useState<Notice[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [showModal,  setShowModal]  = useState(false);
  const [editId,     setEditId]     = useState<string | null>(null);
  const [form,       setForm]       = useState<FormState>(BLANK);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<"all" | NoticeType>("all");
  const [otpVisible, setOtpVisible] = useState(false);

  const fetchNotices = useCallback(async () => {
    try {
      const res = await apiRequest(token, '/notices?scope=global');
      const data = await res.json();
      if (Array.isArray(data)) {
        setNotices(data.map(mapApiNotice));
      }
    } catch (e) {
      console.error('fetchNotices error:', e);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchNotices(); }, [fetchNotices]);

  const filtered = useMemo(() => {
    if (filterType === "all") return notices;
    return notices.filter(n => n.noticeType === filterType);
  }, [notices, filterType]);

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

  async function handleSave() {
    if (!form.title.trim() || !form.content.trim()) return;
    setSaving(true);
    try {
      if (editId) {
        const pRes = await apiRequest(token, `/notices/${editId}`, {
          method: "PATCH",
          body: JSON.stringify({ title: form.title, content: form.content, notice_type: form.noticeType }),
        });
        if (!pRes.ok) throw new Error(`HTTP ${pRes.status}`);
      } else {
        const pRes = await apiRequest(token, "/notices", {
          method: "POST",
          body: JSON.stringify({
            title:          form.title,
            content:        form.content,
            notice_type:    form.noticeType,
            audience_scope: "global",
          }),
        });
        if (!pRes.ok) throw new Error(`HTTP ${pRes.status}`);
      }
      await fetchNotices();
      setShowModal(false);
    } catch (e) {
      console.error("handleSave error:", e);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    const n = notices.find(x => x.id === id);
    try {
      const dRes = await apiRequest(token, `/notices/${id}`, { method: "DELETE" });
      if (!dRes.ok) throw new Error(`HTTP ${dRes.status}`);
      setNotices(prev => prev.filter(x => x.id !== id));
    } catch (e) {
      console.error("handleDelete error:", e);
    } finally {
      setDeleteConfirm(null);
    }
  }

  const FILTER_ITEMS: { key: "all" | NoticeType; label: string }[] = [
    { key: "all",         label: "전체" },
    { key: "general",     label: "일반" },
    { key: "update",      label: "업데이트" },
    { key: "maintenance", label: "점검/장애" },
    { key: "special",     label: "특별" },
  ];

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="공지 관리" homePath="/(super)/more" />

      {/* 안내 */}
      <View style={s.infoBanner}>
        <Bell size={12} color="#2EC4B6" />
        <Text style={s.infoTxt}>
          최신 공지 1개가 대상 역할에 맞게 앱 실행 시 팝업으로 노출됩니다. 새 공지 등록 시 이전 공지는 대체됩니다.
        </Text>
      </View>

      {/* 필터 + 등록 */}
      <View style={s.filterRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {FILTER_ITEMS.map(f => (
              <Pressable key={f.key} style={[s.filterBtn, filterType === f.key && s.filterActive]}
                onPress={() => setFilterType(f.key as any)}>
                <Text style={[s.filterTxt, filterType === f.key && s.filterActiveTxt]}>{f.label}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
        <Pressable style={s.addBtn} onPress={openCreate}>
          <Plus size={16} color="#fff" />
          <Text style={s.addTxt}>공지 등록</Text>
        </Pressable>
      </View>

      {/* 목록 */}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 16, gap: 10 }}>
        {filtered.length === 0 ? (
          <View style={s.empty}>
            <BellOff size={36} color="#D1D5DB" />
            <Text style={s.emptyTxt}>등록된 공지가 없습니다</Text>
          </View>
        ) : (
          filtered.map((n, idx) => (
            <NoticeCard key={n.id} notice={n} onEdit={openEdit}
              onDelete={(id) => setDeleteConfirm(id)}
              isLatest={idx === 0 && filterType === "all"} />
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
                <X size={20} color="#64748B" />
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
                onPress={() => setOtpVisible(true)} disabled={!form.title.trim() || !form.content.trim()}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Lock size={13} color="#fff" />
                  <Text style={m.saveTxt}>{editId ? "저장" : "등록"}</Text>
                </View>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <OtpGateModal
        visible={otpVisible}
        token={token}
        title={editId ? "공지 수정 OTP 인증" : "공지 등록 OTP 인증"}
        desc="공지 등록·수정은 OTP 인증 후에 적용됩니다."
        onSuccess={() => { setOtpVisible(false); handleSave(); }}
        onCancel={() => setOtpVisible(false)}
      />

      {/* 삭제 확인 */}
      <Modal visible={!!deleteConfirm} transparent animationType="fade">
        <View style={m.overlay}>
          <View style={[m.sheet, { maxHeight: 240 }]}>
            <Text style={[m.title, { marginBottom: 12 }]}>공지 삭제</Text>
            <Text style={{ fontSize: 14, color: "#0F172A", marginBottom: 8 }}>
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
  safe:         { flex: 1, backgroundColor: "#F1F5F9" },
  infoBanner:   { flexDirection: "row", gap: 6, alignItems: "flex-start", backgroundColor: "#E6FFFA",
                  padding: 10, paddingHorizontal: 16 },
  infoTxt:      { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#2EC4B6", flex: 1 },
  filterRow:    { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  filterBtn:    { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: "#FFFFFF" },
  filterActive: { backgroundColor: P },
  filterTxt:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B" },
  filterActiveTxt: { color: "#fff" },
  addBtn:       { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: P,
                  paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  addTxt:       { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#fff" },
  empty:        { alignItems: "center", paddingVertical: 48, gap: 10 },
  emptyTxt:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B" },
});

const m = StyleSheet.create({
  overlay:      { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:        { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "90%" },
  header:       { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title:        { fontSize: 17, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  label:        { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#0F172A", marginBottom: 4, marginTop: 12 },
  input:        { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 10, padding: 10, fontSize: 14,
                  fontFamily: "Pretendard-Regular", color: "#0F172A", backgroundColor: "#F1F5F9" },
  segRow:       { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  segBtn:       { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: "#FFFFFF" },
  segActive:    { backgroundColor: P },
  segTxt:       { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B" },
  segActiveTxt: { color: "#fff" },
  footer:       { flexDirection: "row", gap: 8, marginTop: 20 },
  hint:         { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B", marginBottom: 10, marginTop: -8 },
  cancelBtn:    { flex: 1, padding: 13, borderRadius: 10, backgroundColor: "#FFFFFF", alignItems: "center" },
  cancelTxt:    { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  saveBtn:      { flex: 2, padding: 13, borderRadius: 10, backgroundColor: P, alignItems: "center" },
  saveTxt:      { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
});
