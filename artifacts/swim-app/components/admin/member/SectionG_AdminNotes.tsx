/**
 * Section G — 관리 메모 (Admin Notes MVP)
 *
 * WP11: pool_admin 전용 내부 운영 메모.
 * - 학부모/선생님에게 노출 절대 금지 (이 컴포넌트는 admin 전용 화면에서만 렌더링됨)
 * - 카테고리 6종 고정: general, consultation, payment, class, vehicle, caution
 * - N+1 없음: 노트 목록과 작성자를 한 번에 API에서 JOIN 반환
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Modal, Pressable, ScrollView,
  Text, TextInput, View,
} from "react-native";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { LucideIcon } from "@/components/common/LucideIcon";
import { MemberSectionCard } from "./MemberSectionCard";

const C = Colors.light;

const NOTE_MAX_LENGTH = 3000;

type NoteCategory =
  | "general"
  | "consultation"
  | "payment"
  | "class"
  | "vehicle"
  | "caution";

const CATEGORY_LABELS: Record<NoteCategory, string> = {
  general:      "일반",
  consultation: "상담",
  payment:      "결제",
  class:        "수업",
  vehicle:      "차량",
  caution:      "주의",
};

const CATEGORIES: NoteCategory[] = [
  "general", "consultation", "payment", "class", "vehicle", "caution",
];

interface AdminNote {
  id: string;
  category: NoteCategory;
  content: string;
  author_name: string | null;
  created_at: string;
  updated_at: string;
}

interface Props {
  studentId: string;
}

export function SectionG_AdminNotes({ studentId }: Props) {
  const { token } = useAuth();
  const { themeColor } = useBrand();

  const [notes, setNotes]       = useState<AdminNote[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showModal, setShowModal] = useState(false);

  // 편집 상태
  const [editNote, setEditNote]     = useState<AdminNote | null>(null);
  const [editCategory, setEditCategory] = useState<NoteCategory>("general");
  const [editContent, setEditContent]   = useState("");
  const [saving, setSaving]             = useState(false);

  // ── 로드 ────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    try {
      const res = await apiRequest(token, `/admin/students/${studentId}/notes`);
      if (res.ok) {
        const body = await res.json();
        setNotes(body.notes ?? []);
      }
    } catch (e) {
      console.error("[AdminNotes] load error", e);
    } finally {
      setLoading(false);
    }
  }, [studentId, token]);

  useEffect(() => { load(); }, [load]);

  // ── 모달 열기 ───────────────────────────────────────────────────────────
  function openCreate() {
    setEditNote(null);
    setEditCategory("general");
    setEditContent("");
    setShowModal(true);
  }

  function openEdit(note: AdminNote) {
    setEditNote(note);
    setEditCategory(note.category);
    setEditContent(note.content);
    setShowModal(true);
  }

  // ── 저장 (create or update) ─────────────────────────────────────────────
  async function handleSave() {
    const content = editContent.trim();
    if (!content) {
      Alert.alert("오류", "내용을 입력해 주세요.");
      return;
    }
    setSaving(true);
    try {
      let res: Response;
      if (editNote) {
        res = await apiRequest(token, `/admin/students/${studentId}/notes/${editNote.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: editCategory, content }),
        });
      } else {
        res = await apiRequest(token, `/admin/students/${studentId}/notes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: editCategory, content }),
        });
      }
      if (res.ok) {
        setShowModal(false);
        load();
      } else {
        const err = await res.json().catch(() => ({}));
        Alert.alert("오류", err.message || err.error || "저장에 실패했습니다.");
      }
    } catch {
      Alert.alert("오류", "네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  // ── 삭제 ────────────────────────────────────────────────────────────────
  function handleDelete(note: AdminNote) {
    Alert.alert(
      "메모 삭제",
      "이 메모를 삭제하시겠습니까?",
      [
        { text: "취소", style: "cancel" },
        {
          text: "삭제",
          style: "destructive",
          onPress: async () => {
            try {
              const res = await apiRequest(
                token,
                `/admin/students/${studentId}/notes/${note.id}`,
                { method: "DELETE" },
              );
              if (res.ok) {
                load();
              } else {
                Alert.alert("오류", "삭제에 실패했습니다.");
              }
            } catch {
              Alert.alert("오류", "네트워크 오류가 발생했습니다.");
            }
          },
        },
      ],
    );
  }

  // ── caution 색상 ─────────────────────────────────────────────────────────
  function categoryColor(cat: NoteCategory): string {
    return cat === "caution" ? "#DC2626" : themeColor;
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  }

  return (
    <>
      <MemberSectionCard
        title="관리 메모"
        actionLabel="+ 추가"
        actionIcon="plus"
        actionColor={themeColor}
        onAction={openCreate}
      >
        {loading ? (
          <ActivityIndicator color={themeColor} size="small" />
        ) : notes.length === 0 ? (
          <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted }}>
            등록된 메모가 없습니다
          </Text>
        ) : (
          <View style={{ gap: 10 }}>
            {notes.map(note => (
              <View
                key={note.id}
                style={{
                  backgroundColor: note.category === "caution"
                    ? "#FEF2F2"
                    : C.backgroundSoft,
                  borderRadius: 10,
                  padding: 12,
                  gap: 6,
                  borderLeftWidth: 3,
                  borderLeftColor: categoryColor(note.category),
                }}
              >
                {/* 헤더 */}
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{
                    paddingHorizontal: 8, paddingVertical: 2,
                    borderRadius: 6,
                    backgroundColor: categoryColor(note.category) + "20",
                  }}>
                    <Text style={{
                      fontSize: 11, fontFamily: "Pretendard-Regular",
                      color: categoryColor(note.category),
                    }}>
                      {CATEGORY_LABELS[note.category]}
                    </Text>
                  </View>

                  <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                    <Pressable hitSlop={8} onPress={() => openEdit(note)}>
                      <LucideIcon name="pencil" size={14} color={C.textSecondary} />
                    </Pressable>
                    <Pressable hitSlop={8} onPress={() => handleDelete(note)}>
                      <LucideIcon name="trash-2" size={14} color="#DC2626" />
                    </Pressable>
                  </View>
                </View>

                {/* 내용 */}
                <Text style={{
                  fontSize: 13, fontFamily: "Pretendard-Regular",
                  color: C.text, lineHeight: 20,
                }}>
                  {note.content}
                </Text>

                {/* 메타 */}
                <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted }}>
                  {note.author_name ?? "관리자"} · {formatDate(note.created_at)}
                  {note.updated_at !== note.created_at
                    ? ` (수정 ${formatDate(note.updated_at)})`
                    : ""}
                </Text>
              </View>
            ))}
          </View>
        )}
      </MemberSectionCard>

      {/* ── 작성/수정 모달 ── */}
      <Modal
        visible={showModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowModal(false)}
      >
        <View style={{
          flex: 1, backgroundColor: "rgba(0,0,0,0.45)",
          justifyContent: "flex-end",
        }}>
          <View style={{
            backgroundColor: "#fff",
            borderTopLeftRadius: 20, borderTopRightRadius: 20,
            padding: 20, gap: 14, maxHeight: "85%",
          }}>
            {/* 헤더 */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 16, fontFamily: "Pretendard-SemiBold", color: C.text }}>
                {editNote ? "메모 수정" : "메모 추가"}
              </Text>
              <Pressable hitSlop={12} onPress={() => setShowModal(false)}>
                <LucideIcon name="x" size={20} color={C.textSecondary} />
              </Pressable>
            </View>

            {/* 카테고리 선택 */}
            <View style={{ gap: 6 }}>
              <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary }}>
                카테고리
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, paddingRight: 4 }}
              >
                {CATEGORIES.map(cat => {
                  const active = editCategory === cat;
                  const color  = cat === "caution" ? "#DC2626" : themeColor;
                  return (
                    <Pressable
                      key={cat}
                      onPress={() => setEditCategory(cat)}
                      style={{
                        paddingHorizontal: 12, paddingVertical: 7,
                        borderRadius: 20,
                        backgroundColor: active ? color : color + "15",
                        borderWidth: 1,
                        borderColor: active ? color : color + "40",
                      }}
                    >
                      <Text style={{
                        fontSize: 13, fontFamily: "Pretendard-Regular",
                        color: active ? "#fff" : color,
                      }}>
                        {CATEGORY_LABELS[cat]}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            {/* 내용 입력 */}
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary }}>
                  내용
                </Text>
                <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted }}>
                  {editContent.length}/{NOTE_MAX_LENGTH}
                </Text>
              </View>
              <TextInput
                multiline
                value={editContent}
                onChangeText={t => setEditContent(t.slice(0, NOTE_MAX_LENGTH))}
                placeholder="메모 내용을 입력해 주세요"
                placeholderTextColor={C.textMuted}
                maxLength={NOTE_MAX_LENGTH}
                style={{
                  backgroundColor: C.backgroundSoft,
                  borderRadius: 10, padding: 12,
                  fontSize: 14, fontFamily: "Pretendard-Regular",
                  color: C.text, lineHeight: 22,
                  minHeight: 120, textAlignVertical: "top",
                }}
              />
            </View>

            {/* 저장 버튼 */}
            <Pressable
              onPress={handleSave}
              disabled={saving}
              style={{
                height: 48, borderRadius: 12,
                backgroundColor: themeColor,
                alignItems: "center", justifyContent: "center",
              }}
            >
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={{ fontSize: 15, fontFamily: "Pretendard-SemiBold", color: "#fff" }}>
                  {editNote ? "수정 저장" : "메모 추가"}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}
