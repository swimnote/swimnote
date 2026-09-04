/**
 * Section A — 기본 정보 (이름·생년·메모·내부메모)
 * Section-level edit mode: [수정] → 섹션 전체 편집 → 저장/취소
 */
import React, { useState } from "react";
import { Text, View } from "react-native";
import Colors from "@/constants/colors";
import { MemberSectionCard, InfoRow } from "./MemberSectionCard";
import { EditField } from "./EditField";
import type { DetailData } from "./memberDetailTypes";

const C = Colors.light;

interface Props {
  data: DetailData;
  themeColor: string;
  saving: boolean;
  // edit state
  editName: string;        setEditName: (v: string) => void;
  editBirth: string;       setEditBirth: (v: string) => void;
  editMemo: string;        setEditMemo: (v: string) => void;
  editNotes: string;       setEditNotes: (v: string) => void;
  onSave: () => void;
}

export function SectionA_BasicInfo({
  data, themeColor, saving,
  editName, setEditName, editBirth, setEditBirth,
  editMemo, setEditMemo, editNotes, setEditNotes,
  onSave,
}: Props) {
  const [editing, setEditing] = useState(false);

  function handleCancel() {
    // 원본 값으로 리셋
    setEditName(data.name || "");
    setEditBirth(data.birth_year || "");
    setEditMemo(data.memo || "");
    setEditNotes(data.notes || "");
    setEditing(false);
  }

  function handleSave() {
    onSave();
    setEditing(false);
  }

  return (
    <MemberSectionCard
      title="기본 정보"
      actionLabel={editing ? undefined : "수정"}
      actionIcon="edit-2"
      actionColor={themeColor}
      onAction={() => setEditing(true)}
      editing={editing}
      onSave={handleSave}
      onCancel={handleCancel}
      saving={saving}
    >
      {editing ? (
        <View style={{ gap: 10 }}>
          <EditField
            label="이름"
            value={editName}
            onChangeText={v => setEditName(v)}
            placeholder="학생 이름"
          />
          <EditField
            label="출생년도"
            value={editBirth}
            onChangeText={v => setEditBirth(v)}
            placeholder="예) 2015"
            keyboardType="numeric"
          />
          <EditField
            label="메모"
            value={editMemo}
            onChangeText={v => setEditMemo(v)}
            placeholder="수영장 내부 메모"
            multiline
          />
          <EditField
            label="내부 노트"
            value={editNotes}
            onChangeText={v => setEditNotes(v)}
            placeholder="관리자 내부 노트"
            multiline
          />
        </View>
      ) : (
        <View>
          <InfoRow icon="user" label="이름" value={data.name} />
          <InfoRow icon="calendar" label="출생년도" value={data.birth_year} />
          <InfoRow
            icon="calendar"
            label="등록일"
            value={data.created_at ? new Date(data.created_at).toLocaleDateString("ko-KR") : undefined}
          />
          <InfoRow
            icon="map-pin"
            label="등록 경로"
            value={data.registration_path === "admin_created" ? "관리자 직접" : "학부모 요청"}
          />
          {data.memo ? (
            <View style={{ paddingVertical: 8, gap: 4 }}>
              <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary }}>메모</Text>
              <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text, lineHeight: 19 }}>{data.memo}</Text>
            </View>
          ) : null}
          {data.notes ? (
            <View style={{ paddingVertical: 8, gap: 4 }}>
              <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary }}>내부 노트</Text>
              <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 19 }}>{data.notes}</Text>
            </View>
          ) : null}
        </View>
      )}
    </MemberSectionCard>
  );
}
