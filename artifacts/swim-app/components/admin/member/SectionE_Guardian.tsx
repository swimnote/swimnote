/**
 * Section E — 보호자 / 연락처
 * parent_name, parent_phone, parent_phone2~4 모두 표시
 * WP-M2 타입: DetailData.parent_phone2~4 (정식 선언)
 * [수정] → section edit mode → 저장/취소
 * 전화/문자 shortcut
 * parent account 연결 상태 표시
 */
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { LucideIcon } from "@/components/common/LucideIcon";
import { callPhone, sendSms, formatPhone } from "@/utils/phoneUtils";
import { MemberSectionCard } from "./MemberSectionCard";
import { EditField } from "./EditField";
import type { DetailData } from "./memberDetailTypes";

const C = Colors.light;

interface Props {
  data: DetailData;
  themeColor: string;
  saving: boolean;
  editParentName: string;        setEditParentName: (v: string) => void;
  editParentPhone: string;       setEditParentPhone: (v: string) => void;
  editParentPhone2: string;      setEditParentPhone2: (v: string) => void;
  editParentPhone3: string;      setEditParentPhone3: (v: string) => void;
  editParentPhone4: string;      setEditParentPhone4: (v: string) => void;
  onSave: () => void;
}

function PhoneRow({ label, phone, color }: { label: string; phone: string; color: string }) {
  const formatted = formatPhone(phone);
  return (
    <View style={{
      flexDirection: "row", alignItems: "center", gap: 10,
      paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border,
    }}>
      <Text style={{ width: 72, fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary }}>{label}</Text>
      <Text style={{ flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text }}>{formatted}</Text>
      <Pressable onPress={() => callPhone(phone)} style={{ padding: 6 }}>
        <LucideIcon name="phone" size={16} color="#22C55E" />
      </Pressable>
      <Pressable onPress={() => sendSms(phone)} style={{ padding: 6 }}>
        <LucideIcon name="message-circle" size={16} color="#3B82F6" />
      </Pressable>
    </View>
  );
}

export function SectionE_Guardian({
  data, themeColor, saving,
  editParentName, setEditParentName,
  editParentPhone, setEditParentPhone,
  editParentPhone2, setEditParentPhone2,
  editParentPhone3, setEditParentPhone3,
  editParentPhone4, setEditParentPhone4,
  onSave,
}: Props) {
  const [editing, setEditing] = useState(false);

  const isLinked = !!(data as any).parent_user_id;

  function handleCancel() {
    setEditParentName(data.parent_name || "");
    setEditParentPhone(data.parent_phone || "");
    setEditParentPhone2((data as any).parent_phone2 || "");
    setEditParentPhone3((data as any).parent_phone3 || "");
    setEditParentPhone4((data as any).parent_phone4 || "");
    setEditing(false);
  }

  function handleSave() {
    onSave();
    setEditing(false);
  }

  const phones = [
    { label: "보호자 1", phone: data.parent_phone },
    { label: "보호자 2", phone: (data as any).parent_phone2 },
    { label: "보호자 3", phone: (data as any).parent_phone3 },
    { label: "보호자 4", phone: (data as any).parent_phone4 },
  ].filter(p => p.phone);

  return (
    <MemberSectionCard
      title="보호자 / 연락처"
      actionLabel={editing ? undefined : "수정"}
      actionIcon="edit-2"
      actionColor={themeColor}
      onAction={() => setEditing(true)}
      editing={editing}
      onSave={handleSave}
      onCancel={handleCancel}
      saving={saving}
    >
      {/* 학부모 앱 연결 상태 */}
      <View style={{
        flexDirection: "row", alignItems: "center", gap: 10, padding: 12,
        borderRadius: 12,
        backgroundColor: isLinked ? C.brandSoft : C.backgroundSoft,
      }}>
        <LucideIcon
          name={isLinked ? "check-circle" : "x-circle"}
          size={20}
          color={isLinked ? C.brandStrong : C.textMuted}
        />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: isLinked ? C.brandStrong : C.textMuted }}>
            {isLinked ? "학부모 앱 연결됨" : "학부모 앱 미연결"}
          </Text>
          {(data as any).parent_account_name && (
            <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 }}>
              {(data as any).parent_account_name}
            </Text>
          )}
          {!isLinked && (
            <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2 }}>
              학부모 앱에서 가입하면 자동 연결됩니다
            </Text>
          )}
        </View>
      </View>

      {editing ? (
        <View style={{ gap: 10 }}>
          <EditField label="보호자 이름" value={editParentName} onChangeText={setEditParentName} placeholder="보호자 이름" />
          <EditField label="연락처 1" value={editParentPhone} onChangeText={setEditParentPhone} placeholder="010-0000-0000" keyboardType="phone-pad" />
          <EditField label="연락처 2" value={editParentPhone2} onChangeText={setEditParentPhone2} placeholder="010-0000-0000 (선택)" keyboardType="phone-pad" />
          <EditField label="연락처 3" value={editParentPhone3} onChangeText={setEditParentPhone3} placeholder="010-0000-0000 (선택)" keyboardType="phone-pad" />
          <EditField label="연락처 4" value={editParentPhone4} onChangeText={setEditParentPhone4} placeholder="010-0000-0000 (선택)" keyboardType="phone-pad" />
        </View>
      ) : (
        <View>
          {/* 보호자 이름 */}
          <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border }}>
            <LucideIcon name="user" size={13} color={C.textMuted} />
            <Text style={{ width: 80, marginLeft: 8, fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary }}>보호자 이름</Text>
            <Text style={{ flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text }}>{data.parent_name || "미입력"}</Text>
          </View>
          {/* 전화번호들 */}
          {phones.length === 0 ? (
            <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted, paddingVertical: 10 }}>연락처가 없습니다</Text>
          ) : (
            phones.map(p => <PhoneRow key={p.label} label={p.label} phone={p.phone!} color={themeColor} />)
          )}
        </View>
      )}
    </MemberSectionCard>
  );
}
