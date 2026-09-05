/**
 * (super)/marketing.tsx — WP12 Super Admin Marketing Message
 *
 * 슈퍼관리자가 Pool / Plan / Role 필터로 대상을 선택하고
 * 마케팅 공지(push + banner)를 발송하는 화면.
 *
 * §Preview: 발송 전 대상 인원 확인 필수.
 * §Send:    accidental global send = target_all=true 명시 필요.
 */
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator, Alert, Pressable, ScrollView,
  StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { LucideIcon } from "@/components/common/LucideIcon";

const C = Colors.light;
const PURPLE = "#7C3AED";

// ── Constants ────────────────────────────────────────────────────────────────
const ALL_PLAN_TYPES = ["swimnote", "x300", "x500", "x1000"] as const;
const ALL_ROLES      = ["ADMIN", "TEACHER", "PARENT"] as const;
type PlanType = typeof ALL_PLAN_TYPES[number];
type Role     = typeof ALL_ROLES[number];

const PLAN_LABELS: Record<PlanType, string> = {
  swimnote: "SwimNote",
  x300:     "X 300",
  x500:     "X 500",
  x1000:    "X 1000",
};

const ROLE_LABELS: Record<Role, string> = {
  ADMIN:   "관리자",
  TEACHER: "선생님",
  PARENT:  "학부모",
};

interface AudiencePreview {
  pool_count:       number;
  user_count:       number;
  admin_count:      number;
  teacher_count:    number;
  parent_count:     number;
  push_token_count: number;
}

// ── Toggle chip ───────────────────────────────────────────────────────────────
function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[s.chip, active && { backgroundColor: PURPLE, borderColor: PURPLE }]}
      onPress={onPress}
    >
      <Text style={[s.chipTxt, active && { color: "#fff" }]}>{label}</Text>
    </Pressable>
  );
}

// ── Field label ───────────────────────────────────────────────────────────────
function FieldLabel({ text }: { text: string }) {
  return <Text style={s.fieldLabel}>{text}</Text>;
}

export default function MarketingScreen() {
  const { token } = useAuth();

  // ── Form state ────────────────────────────────────────────────────────────
  const [title,     setTitle]     = useState("");
  const [content,   setContent]   = useState("");
  const [deepLink,  setDeepLink]  = useState("");
  const [startsAt,  setStartsAt]  = useState("");
  const [endsAt,    setEndsAt]    = useState("");
  const [sendPush,  setSendPush]  = useState(true);
  const [showBanner,setShowBanner]= useState(true);

  // null = 전체 선택 (target_all)
  const [selectedPlans, setSelectedPlans] = useState<PlanType[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<Role[]>([]);
  // Pool ID 텍스트 (comma-separated for simplicity)
  const [poolIdsText, setPoolIdsText] = useState("");

  const [preview,  setPreview]  = useState<AudiencePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending,    setSending]    = useState(false);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function togglePlan(p: PlanType) {
    setSelectedPlans(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
    );
    setPreview(null);
  }

  function toggleRole(r: Role) {
    setSelectedRoles(prev =>
      prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]
    );
    setPreview(null);
  }

  function buildCriteria() {
    const poolIds   = poolIdsText.trim()
      ? poolIdsText.split(",").map(s => s.trim()).filter(Boolean)
      : null;
    const planTypes = selectedPlans.length > 0 ? selectedPlans : null;
    const roles     = selectedRoles.length > 0 ? selectedRoles : null;
    return { pool_ids: poolIds, plan_types: planTypes, roles };
  }

  const isTargetAll = !poolIdsText.trim() && selectedPlans.length === 0 && selectedRoles.length === 0;

  // ── Preview ───────────────────────────────────────────────────────────────
  const handlePreview = useCallback(async () => {
    setPreviewing(true);
    setPreview(null);
    try {
      const r = await apiRequest(token, "/super/marketing/notices/preview", {
        method: "POST",
        body: JSON.stringify(buildCriteria()),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        Alert.alert("미리보기 실패", (err as any).message ?? `HTTP ${r.status}`);
        return;
      }
      const data: AudiencePreview = await r.json();
      setPreview(data);
    } catch (e: any) {
      Alert.alert("오류", e?.message);
    } finally {
      setPreviewing(false);
    }
  }, [token, poolIdsText, selectedPlans, selectedRoles]);

  // ── Send ──────────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!title.trim()) { Alert.alert("필수 입력", "제목을 입력해주세요."); return; }
    if (!content.trim()) { Alert.alert("필수 입력", "내용을 입력해주세요."); return; }

    if (!preview) {
      Alert.alert("확인 필요", "발송 전에 먼저 대상 미리보기를 확인해주세요.");
      return;
    }

    const confirmMsg = preview.pool_count === 0
      ? "대상 수영장이 0개입니다. 그래도 발송하시겠습니까?"
      : `${preview.pool_count}개 수영장 / ${preview.user_count.toLocaleString()}명 / 푸시 ${preview.push_token_count.toLocaleString()}건에 발송합니다.\n\n계속하시겠습니까?`;

    Alert.alert("발송 확인", confirmMsg, [
      { text: "취소", style: "cancel" },
      {
        text: "발송",
        style: "destructive",
        onPress: async () => {
          setSending(true);
          try {
            const criteria = buildCriteria();
            const body = {
              title:       title.trim(),
              content:     content.trim(),
              deep_link:   deepLink.trim() || undefined,
              starts_at:   startsAt.trim() || undefined,
              ends_at:     endsAt.trim()   || undefined,
              send_push:   sendPush,
              show_banner: showBanner,
              ...criteria,
              target_all: isTargetAll ? true : undefined,
            };

            const r = await apiRequest(token, "/super/marketing/notices", {
              method: "POST",
              body: JSON.stringify(body),
            });

            if (!r.ok) {
              const err = await r.json().catch(() => ({}));
              Alert.alert("발송 실패", (err as any).message ?? `HTTP ${r.status}`);
              return;
            }

            const result = await r.json();
            const pushInfo = result.push_scheduled
              ? `예약 발송 (${startsAt})`
              : `즉시 발송 — ${result.push_deliveries ?? 0}건 처리`;

            Alert.alert("발송 완료", `공지 ID: ${result.id}\n${pushInfo}`);

            // Reset form
            setTitle(""); setContent(""); setDeepLink("");
            setStartsAt(""); setEndsAt("");
            setSelectedPlans([]); setSelectedRoles([]); setPoolIdsText("");
            setPreview(null);
          } catch (e: any) {
            Alert.alert("오류", e?.message);
          } finally {
            setSending(false);
          }
        },
      },
    ]);
  }, [token, title, content, deepLink, startsAt, endsAt, sendPush, showBanner,
      selectedPlans, selectedRoles, poolIdsText, preview, isTargetAll]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <SubScreenHeader title="마케팅 메시지" />

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>

        {/* ── 메시지 내용 ─────────────────────────────────────────────── */}
        <View style={s.card}>
          <Text style={s.cardTitle}>메시지 내용</Text>

          <FieldLabel text="제목 *" />
          <TextInput
            style={s.input}
            value={title}
            onChangeText={t => { setTitle(t); setPreview(null); }}
            placeholder="예: 여름 특별 할인 안내"
            placeholderTextColor={C.textSecondary}
          />

          <FieldLabel text="내용 *" />
          <TextInput
            style={[s.input, { height: 100, textAlignVertical: "top" }]}
            value={content}
            onChangeText={t => { setContent(t); setPreview(null); }}
            placeholder="공지 및 푸시 메시지 내용"
            placeholderTextColor={C.textSecondary}
            multiline
          />

          <FieldLabel text="딥 링크 (선택)" />
          <TextInput
            style={s.input}
            value={deepLink}
            onChangeText={setDeepLink}
            placeholder="swimnote://screen 또는 빈값"
            placeholderTextColor={C.textSecondary}
            autoCapitalize="none"
          />
        </View>

        {/* ── 대상 설정 ────────────────────────────────────────────────── */}
        <View style={s.card}>
          <Text style={s.cardTitle}>대상 설정</Text>
          <Text style={s.cardSub}>모두 비워두면 전체 발송 (target_all 자동 설정)</Text>

          <FieldLabel text="플랜 필터 (복수 선택)" />
          <View style={s.chipRow}>
            {ALL_PLAN_TYPES.map(p => (
              <Chip
                key={p}
                label={PLAN_LABELS[p]}
                active={selectedPlans.includes(p)}
                onPress={() => togglePlan(p)}
              />
            ))}
          </View>

          <FieldLabel text="역할 필터 (복수 선택)" />
          <View style={s.chipRow}>
            {ALL_ROLES.map(r => (
              <Chip
                key={r}
                label={ROLE_LABELS[r]}
                active={selectedRoles.includes(r)}
                onPress={() => toggleRole(r)}
              />
            ))}
          </View>

          <FieldLabel text="특정 Pool ID (쉼표 구분, 선택)" />
          <TextInput
            style={s.input}
            value={poolIdsText}
            onChangeText={t => { setPoolIdsText(t); setPreview(null); }}
            placeholder="uuid1, uuid2, ..."
            placeholderTextColor={C.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {/* ── 발송 옵션 ────────────────────────────────────────────────── */}
        <View style={s.card}>
          <Text style={s.cardTitle}>발송 옵션</Text>

          <View style={s.switchRow}>
            <Text style={s.switchLabel}>푸시 알림 발송</Text>
            <Switch value={sendPush} onValueChange={setSendPush} trackColor={{ true: PURPLE }} />
          </View>
          <View style={s.switchRow}>
            <Text style={s.switchLabel}>앱 배너 노출</Text>
            <Switch value={showBanner} onValueChange={setShowBanner} trackColor={{ true: PURPLE }} />
          </View>

          <FieldLabel text="예약 발송 시각 (선택 — 비워두면 즉시)" />
          <TextInput
            style={s.input}
            value={startsAt}
            onChangeText={setStartsAt}
            placeholder="2026-09-15T09:00"
            placeholderTextColor={C.textSecondary}
            autoCapitalize="none"
          />

          <FieldLabel text="노출 종료 시각 (선택)" />
          <TextInput
            style={s.input}
            value={endsAt}
            onChangeText={setEndsAt}
            placeholder="2026-09-30T23:59"
            placeholderTextColor={C.textSecondary}
            autoCapitalize="none"
          />
        </View>

        {/* ── 미리보기 ─────────────────────────────────────────────────── */}
        <Pressable style={s.previewBtn} onPress={handlePreview} disabled={previewing}>
          {previewing
            ? <ActivityIndicator size="small" color={PURPLE} />
            : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <LucideIcon name="users" size={14} color={PURPLE} />
                <Text style={s.previewBtnTxt}>대상 인원 미리보기</Text>
              </View>
            )
          }
        </Pressable>

        {preview && (
          <View style={s.previewBox}>
            <Text style={s.previewTitle}>📊 대상 미리보기</Text>
            <View style={s.previewGrid}>
              <PreviewStat label="수영장" value={preview.pool_count} />
              <PreviewStat label="총 대상" value={preview.user_count} />
              <PreviewStat label="관리자" value={preview.admin_count} />
              <PreviewStat label="선생님" value={preview.teacher_count} />
              <PreviewStat label="학부모" value={preview.parent_count} />
              <PreviewStat label="푸시 가능" value={preview.push_token_count} highlight />
            </View>
          </View>
        )}

        {/* ── 발송 버튼 ────────────────────────────────────────────────── */}
        <Pressable
          style={[s.sendBtn, (!title.trim() || !content.trim() || sending) && { opacity: 0.45 }]}
          onPress={handleSend}
          disabled={!title.trim() || !content.trim() || sending}
        >
          {sending
            ? <ActivityIndicator size="small" color="#fff" />
            : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <LucideIcon name="send" size={16} color="#fff" />
                <Text style={s.sendBtnTxt}>
                  {startsAt.trim() ? "예약 발송" : "즉시 발송"}
                </Text>
              </View>
            )
          }
        </Pressable>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function PreviewStat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <View style={ps.cell}>
      <Text style={[ps.value, highlight && { color: PURPLE }]}>{value.toLocaleString()}</Text>
      <Text style={ps.label}>{label}</Text>
    </View>
  );
}

const ps = StyleSheet.create({
  cell:  { flex: 1, minWidth: "30%", alignItems: "center", padding: 8 },
  value: { fontSize: 18, fontFamily: "Pretendard-Regular", color: C.text },
  label: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 },
});

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: C.backgroundSoft },
  body:          { padding: 16, gap: 14 },

  card:          { backgroundColor: "#fff", borderRadius: 14, padding: 16, gap: 8 },
  cardTitle:     { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.text, marginBottom: 2 },
  cardSub:       { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginBottom: 4 },

  fieldLabel:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 6 },
  input:         { borderWidth: 1.5, borderColor: C.border, borderRadius: 10, padding: 10,
                   fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text, backgroundColor: C.backgroundSoft },

  chipRow:       { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  chip:          { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: C.border, backgroundColor: "#fff" },
  chipTxt:       { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },

  switchRow:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 },
  switchLabel:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text },

  previewBtn:    { flexDirection: "row", justifyContent: "center", alignItems: "center",
                   borderWidth: 1.5, borderColor: PURPLE, borderRadius: 12,
                   paddingVertical: 12, backgroundColor: "#fff" },
  previewBtnTxt: { fontSize: 14, fontFamily: "Pretendard-Regular", color: PURPLE },

  previewBox:    { backgroundColor: "#F5F3FF", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#DDD6FE" },
  previewTitle:  { fontSize: 14, fontFamily: "Pretendard-Regular", color: PURPLE, marginBottom: 10 },
  previewGrid:   { flexDirection: "row", flexWrap: "wrap", gap: 4 },

  sendBtn:       { backgroundColor: PURPLE, borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  sendBtnTxt:    { fontSize: 16, fontFamily: "Pretendard-Regular", color: "#fff" },
});
