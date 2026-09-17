/**
 * (admin)/admin-revenue.tsx — 관리자 정산 V2
 *
 * 화면 순서:
 *   월 선택 → 센터 Summary → 선생님 목록 → 선생님 상세(Modal) → 관리자 확인
 *
 * API:
 *   GET /settlement/admin-overview       Pool 전체 뷰 (reflected_amount 포함)
 *   GET /settlement/admin-teacher-detail 선생님별 학생 상세
 *   POST /settlement/finalize            확인 (submitted + has_changed=false만)
 *
 * 계산 없음 — 서버 반환값 표시만.
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View, Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useTabScrollReset } from "@/hooks/useTabScrollReset";
import { KeyboardAwareScrollView, KeyboardAwareScrollViewRef } from "react-native-keyboard-controller";

const C = Colors.light;

/* ─── 헬퍼 ──────────────────────────────────────────────────────────── */
function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("ko-KR") + "원";
}
function fmtNum(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("ko-KR");
}
function curMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function prevMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function nextMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function fmtMonthLabel(ym: string) {
  const [y, m] = ym.split("-");
  return `${y}년 ${parseInt(m, 10)}월`;
}

/* ─── 타입 ──────────────────────────────────────────────────────────── */
interface TeacherRow {
  teacher_id: string;
  teacher_name: string;
  status: "draft" | "submitted" | "confirmed" | null;
  status_label: string;
  has_changed: boolean;
  student_count: number;
  regular_slot_count: number;
  makeup_count: number;
  auto_amount: number;
  adjustment_total: number;
  reflected_amount: number;
  updated_at: string | null;
}

interface PoolSummary {
  student_count: number;
  priced_student_count: number;
  unpriced_student_count: number;
  pool_auto_total: number;
  pool_adjustment_total: number;
  pool_reflected_total: number;
}

interface Overview {
  month: string;
  teachers: TeacherRow[];
  pool_summary: PoolSummary;
  unpriced_students: any[];
}

interface StudentDetail {
  student_id: string;
  student_name: string;
  weekly_count: number;
  pricing_status: string;
  monthly_fee: number | null;
  regular_slot_count: number;
  total_regular_slots: number;
  allocation_ratio: number;
  allocated_auto_amount: number;
  adjustment_amount: number;
  final_amount: number;
  billable_count: number | null;
  sessions_per_month: number | null;
}

interface TeacherDetail {
  teacher_id: string;
  status: string | null;
  auto_amount: number;
  students: StudentDetail[];
}

/* ─── 상태 배지 색상 ─────────────────────────────────────────────────── */
function statusChip(label: string, hasChanged: boolean) {
  if (hasChanged && label === "저장됨")
    return { bg: "#FEF3C7", text: "#92400E", border: "#FCD34D" };
  if (label === "관리자 확인") return { bg: "#DCFCE7", text: "#14532D", border: "#86EFAC" };
  if (label === "저장됨") return { bg: "#DBEAFE", text: "#1E3A5F", border: "#93C5FD" };
  return { bg: "#F1F5F9", text: "#64748B", border: "#CBD5E1" };
}

/* ═══════════════════════════════════════════════════════════════════════
   메인 화면
═══════════════════════════════════════════════════════════════════════ */
export default function AdminRevenueScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();
  const scrollRef = useTabScrollReset<KeyboardAwareScrollViewRef>("admin-revenue");

  const [month, setMonth] = useState(curMonthStr());
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Teacher detail modal
  const [detailTeacher, setDetailTeacher] = useState<TeacherRow | null>(null);
  const [detail, setDetail] = useState<TeacherDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    try {
      const r = await apiRequest(token, `/settlement/admin-overview?month=${month}`);
      if (r.ok) setOverview(await r.json());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, month]);

  useEffect(() => { load(); }, [load]);

  const openDetail = useCallback(async (t: TeacherRow) => {
    setDetailTeacher(t);
    setDetail(null);
    setDetailLoading(true);
    try {
      const r = await apiRequest(token, `/settlement/admin-teacher-detail?teacher_id=${t.teacher_id}&month=${month}`);
      if (r.ok) setDetail(await r.json());
    } finally { setDetailLoading(false); }
  }, [token, month]);

  const closeDetail = useCallback(() => {
    setDetailTeacher(null);
    setDetail(null);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!detailTeacher || !overview) return;
    setConfirming(true);
    try {
      const r = await apiRequest(token, "/settlement/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pool_id: overview.pool_summary ? undefined : undefined,
          month,
          teacher_id: detailTeacher.teacher_id,
        }),
      });
      const json = await r.json();
      if (r.ok) {
        Alert.alert("확인 완료", `${detailTeacher.teacher_name} 선생님 정산이 확인되었습니다.`);
        closeDetail();
        load();
      } else {
        Alert.alert("확인 불가", json.message || "정산 확인에 실패했습니다.");
      }
    } finally { setConfirming(false); }
  }, [token, detailTeacher, month, overview, closeDetail, load]);

  const todayYM = curMonthStr();

  return (
    <View style={s.root}>
      <SubScreenHeader title="정산 관리" />

      {/* 월 선택 */}
      <View style={s.monthRow}>
        <Pressable style={s.monthBtn} onPress={() => setMonth(prevMonth(month))}>
          <LucideIcon name="chevron-left" size={20} color={C.text} />
        </Pressable>
        <Text style={s.monthTxt}>{fmtMonthLabel(month)}</Text>
        <Pressable
          style={[s.monthBtn, month >= todayYM && { opacity: 0.3 }]}
          onPress={() => month < todayYM && setMonth(nextMonth(month))}
          disabled={month >= todayYM}
        >
          <LucideIcon name="chevron-right" size={20} color={C.text} />
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={themeColor} />
      ) : (
        <KeyboardAwareScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
        >
          {/* ─── 센터 Summary ─── */}
          <SummaryCard overview={overview} />

          {/* ─── 선생님 목록 ─── */}
          <Text style={s.sectionTitle}>선생님별 정산</Text>
          {!overview?.teachers?.length ? (
            <Text style={s.emptyTxt}>이 달 정산 데이터가 없습니다.</Text>
          ) : (
            overview.teachers.map(t => (
              <TeacherCard key={t.teacher_id} t={t} onPress={() => openDetail(t)} />
            ))
          )}
        </KeyboardAwareScrollView>
      )}

      {/* ─── 선생님 상세 Modal ─── */}
      <Modal
        visible={!!detailTeacher}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeDetail}
      >
        <TeacherDetailModal
          teacher={detailTeacher}
          detail={detail}
          loading={detailLoading}
          confirming={confirming}
          onClose={closeDetail}
          onConfirm={handleConfirm}
          themeColor={themeColor}
          insets={insets}
        />
      </Modal>
    </View>
  );
}

/* ─── 센터 Summary 카드 ────────────────────────────────────────────── */
function SummaryCard({ overview }: { overview: Overview | null }) {
  if (!overview) return null;
  const ps = overview.pool_summary;
  const unpricedCount = ps.unpriced_student_count ?? 0;
  const autoTotal = ps.pool_auto_total ?? 0;
  const adjTotal = ps.pool_adjustment_total ?? 0;
  const reflectedTotal = ps.pool_reflected_total ?? 0;
  const hasUnpriced = unpricedCount > 0;

  return (
    <View style={s.summaryCard}>
      <Text style={s.summaryMonth}>
        {overview.month.replace("-", "년 ").replace(/^(\d+년 )0?(\d+)$/, "$1$2")}월 정산
      </Text>

      {/* 금액 3개 */}
      <View style={s.amountRow}>
        <AmountItem label="자동 기준 매출" value={autoTotal} />
        <View style={s.amtDivider} />
        <AmountItem label="조정 금액" value={adjTotal} signed />
        <View style={s.amtDivider} />
        <AmountItem label="반영 매출" value={reflectedTotal} highlight />
      </View>

      <View style={s.summaryDivider} />

      {/* 회원 현황 */}
      <View style={s.memberRow}>
        <Text style={s.memberTxt}>
          전체 회원 {fmtNum(ps.student_count)}명
        </Text>
        {hasUnpriced ? (
          <View style={s.unpricedBadge}>
            <LucideIcon name="alert-triangle" size={12} color="#92400E" />
            <Text style={s.unpricedTxt}>수업료 설정 필요 {unpricedCount}명</Text>
          </View>
        ) : (
          <Text style={s.memberTxt}>수업료 설정 완료</Text>
        )}
      </View>

      {/* unpriced CTA */}
      {hasUnpriced && (
        <Pressable
          style={s.unpricedCta}
          onPress={() => router.push("/(admin)/unit-pricing")}
        >
          <LucideIcon name="settings" size={14} color="#1E3A5F" />
          <Text style={s.unpricedCtaTxt}>수업료 설정</Text>
        </Pressable>
      )}
    </View>
  );
}

function AmountItem({ label, value, signed, highlight }: {
  label: string; value: number; signed?: boolean; highlight?: boolean;
}) {
  const color = highlight ? "#0F2D50" : signed && value < 0 ? "#DC2626" : C.textPrimary;
  const valStr = signed && value > 0 ? `+${value.toLocaleString("ko-KR")}원` : fmt(value);
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Text style={s.amtLabel}>{label}</Text>
      <Text style={[s.amtValue, { color, fontSize: highlight ? 17 : 15 }]}>{valStr}</Text>
    </View>
  );
}

/* ─── 선생님 카드 ──────────────────────────────────────────────────── */
function TeacherCard({ t, onPress }: { t: TeacherRow; onPress: () => void }) {
  const chip = statusChip(t.status_label, t.has_changed);
  const displayStatus = t.has_changed && t.status_label === "저장됨" ? "저장 후 변경" : t.status_label;

  return (
    <Pressable style={s.teacherCard} onPress={onPress}>
      {/* 상단: 이름 + 상태 */}
      <View style={s.tcHeader}>
        <Text style={s.tcName}>{t.teacher_name || "선생님"}</Text>
        <View style={[s.statusChip, { backgroundColor: chip.bg, borderColor: chip.border }]}>
          <Text style={[s.statusChipTxt, { color: chip.text }]}>{displayStatus}</Text>
        </View>
      </View>

      {/* 회원 / 수업 */}
      <Text style={s.tcMeta}>
        담당 회원 {t.student_count}명 · 정규 {t.regular_slot_count}회 · 완료 보강 {t.makeup_count}회
      </Text>

      {/* 금액 3줄 */}
      <View style={s.tcAmounts}>
        <AmountLine label="자동 기준 매출" value={t.auto_amount} />
        <AmountLine label="조정 금액" value={t.adjustment_total} signed />
        <AmountLine label="반영 매출" value={t.reflected_amount} bold />
      </View>

      <View style={s.tcChevron}>
        <LucideIcon name="chevron-right" size={16} color={C.textSecondary} />
      </View>
    </Pressable>
  );
}

function AmountLine({ label, value, signed, bold }: {
  label: string; value: number; signed?: boolean; bold?: boolean;
}) {
  const color = signed && value < 0 ? "#DC2626" : C.textPrimary;
  const valStr = signed && value > 0 ? `+${value.toLocaleString("ko-KR")}원` : fmt(value);
  return (
    <View style={s.amtLine}>
      <Text style={s.amtLineLabel}>{label}</Text>
      <Text style={[s.amtLineValue, { color, fontWeight: bold ? "700" : "500" }]}>{valStr}</Text>
    </View>
  );
}

/* ─── 선생님 상세 Modal ────────────────────────────────────────────── */
function TeacherDetailModal({
  teacher, detail, loading, confirming, onClose, onConfirm, themeColor, insets,
}: {
  teacher: TeacherRow | null;
  detail: TeacherDetail | null;
  loading: boolean;
  confirming: boolean;
  onClose: () => void;
  onConfirm: () => void;
  themeColor: string;
  insets: any;
}) {
  if (!teacher) return null;

  const chip = statusChip(teacher.status_label, teacher.has_changed);
  const displayStatus = teacher.has_changed && teacher.status_label === "저장됨"
    ? "저장 후 변경" : teacher.status_label;

  // confirm 가능 조건: submitted + has_changed=false
  const canConfirm = teacher.status === "submitted" && !teacher.has_changed;
  const showChangedWarning = teacher.status === "submitted" && teacher.has_changed;

  return (
    <View style={[s.modalRoot, { paddingBottom: insets.bottom + 16 }]}>
      {/* 헤더 */}
      <View style={s.modalHeader}>
        <Text style={s.modalTitle}>{teacher.teacher_name || "선생님"}</Text>
        <Pressable onPress={onClose} style={s.modalClose}>
          <LucideIcon name="x" size={20} color={C.text} />
        </Pressable>
      </View>

      {/* 상태 배지 */}
      <View style={s.modalStatusRow}>
        <View style={[s.statusChip, { backgroundColor: chip.bg, borderColor: chip.border }]}>
          <Text style={[s.statusChipTxt, { color: chip.text }]}>{displayStatus}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {/* 선생님 Summary */}
        <View style={s.detailSummary}>
          <DetailRow label="담당 회원" value={`${teacher.student_count}명`} />
          <DetailRow label="정규 수업" value={`${teacher.regular_slot_count}회`} />
          <DetailRow label="완료 보강" value={`${teacher.makeup_count}회`} />
          <View style={s.detailDivider} />
          <DetailRow label="자동 기준 매출" value={fmt(teacher.auto_amount)} />
          <DetailRow label="조정 금액" value={fmt(teacher.adjustment_total)} />
          <DetailRow label="반영 매출" value={fmt(teacher.reflected_amount)} bold />
        </View>

        {/* has_changed 경고 */}
        {showChangedWarning && (
          <View style={s.changedWarning}>
            <LucideIcon name="alert-triangle" size={14} color="#92400E" />
            <Text style={s.changedWarningTxt}>
              저장 후 회원/시간표 정보가 변경되었습니다.{"\n"}선생님이 정산을 다시 저장해야 합니다.
            </Text>
          </View>
        )}

        {/* 학생 목록 */}
        <Text style={[s.sectionTitle, { marginTop: 20 }]}>학생별 정산</Text>
        {loading ? (
          <ActivityIndicator style={{ marginVertical: 24 }} color={themeColor} />
        ) : !detail?.students?.length ? (
          <Text style={s.emptyTxt}>학생 정산 정보가 없습니다.</Text>
        ) : (
          detail.students.map((st, i) => (
            <StudentRow key={st.student_id ?? i} st={st} />
          ))
        )}

        {/* 확인 버튼 */}
        {teacher.status === "confirmed" ? (
          <View style={s.confirmedBadge}>
            <LucideIcon name="check-circle" size={16} color="#14532D" />
            <Text style={s.confirmedBadgeTxt}>관리자 확인 완료</Text>
          </View>
        ) : canConfirm ? (
          <Pressable
            style={[s.confirmBtn, { backgroundColor: themeColor }]}
            onPress={() => Alert.alert(
              "정산 확인",
              `${teacher.teacher_name} 선생님 정산(${fmt(teacher.reflected_amount)})을 확인하시겠습니까?`,
              [
                { text: "취소", style: "cancel" },
                { text: "확인", onPress: onConfirm },
              ]
            )}
            disabled={confirming}
          >
            {confirming
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.confirmBtnTxt}>정산 확인</Text>
            }
          </Pressable>
        ) : teacher.status === null ? (
          <View style={s.infoBox}>
            <Text style={s.infoBoxTxt}>선생님이 아직 정산을 저장하지 않았습니다.</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/* ─── 학생 Row ──────────────────────────────────────────────────────── */
function StudentRow({ st }: { st: StudentDetail }) {
  const [expanded, setExpanded] = useState(false);
  const weekLabel = st.weekly_count === 1 ? "주1회" : st.weekly_count === 2 ? "주2회" : `주${st.weekly_count}회`;
  const isUnpriced = st.pricing_status === "unpriced";

  return (
    <Pressable style={s.studentRow} onPress={() => setExpanded(v => !v)}>
      <View style={s.studentRowMain}>
        <View style={{ flex: 1 }}>
          <Text style={s.studentName}>{st.student_name}</Text>
          <Text style={s.studentMeta}>{weekLabel}</Text>
        </View>
        {isUnpriced ? (
          <Text style={s.unpricedLabel}>수업료 설정 필요</Text>
        ) : (
          <Text style={s.studentFinal}>{fmt(st.final_amount)}</Text>
        )}
        <LucideIcon name={expanded ? "chevron-up" : "chevron-down"} size={14} color={C.textSecondary} />
      </View>
      {expanded && !isUnpriced && (
        <View style={s.studentDetail}>
          <SdRow label="정상 월수업료" value={fmt(st.monthly_fee)} />
          <SdRow label="기준 횟수" value={`${st.sessions_per_month ?? "—"}회`} />
          <SdRow label="전체 정규수업" value={`${st.total_regular_slots}회`} />
          <SdRow label="담당 정규수업" value={`${st.regular_slot_count}회`} />
          <SdRow label="배분비율" value={st.allocation_ratio !== undefined ? `${Math.round(st.allocation_ratio * 100)}%` : "—"} />
          <SdRow label="학생 전체 기준매출" value={fmt((st as any).student_auto_amount)} />
          <SdRow label="선생님 기준매출" value={fmt(st.allocated_auto_amount)} />
          <SdRow label="조정 금액" value={fmt(st.adjustment_amount)} />
          <SdRow label="반영 매출" value={fmt(st.final_amount)} bold />
        </View>
      )}
    </Pressable>
  );
}

function SdRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={s.sdRow}>
      <Text style={s.sdLabel}>{label}</Text>
      <Text style={[s.sdValue, bold && { fontWeight: "700", color: C.textPrimary }]}>{value}</Text>
    </View>
  );
}
function DetailRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={s.detailRow}>
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={[s.detailValue, bold && { fontWeight: "700", color: C.textPrimary }]}>{value}</Text>
    </View>
  );
}

/* ─── StyleSheet ─────────────────────────────────────────────────────── */
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.background },
  monthRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    paddingVertical: 14, gap: 24, borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: "#fff",
  },
  monthBtn: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: "#fff",
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.border,
  },
  monthTxt: { fontSize: 17, fontWeight: "700", color: C.text },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: C.text, marginBottom: 10 },
  emptyTxt: { color: C.textSecondary, fontSize: 14, textAlign: "center", paddingVertical: 24 },

  // Summary Card
  summaryCard: {
    backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: C.border,
    padding: 18, marginBottom: 20,
  },
  summaryMonth: { fontSize: 15, fontWeight: "700", color: C.textPrimary, marginBottom: 14 },
  amountRow: { flexDirection: "row", alignItems: "flex-start" },
  amtDivider: { width: 1, backgroundColor: C.border, marginHorizontal: 4, marginTop: 4, height: 36 },
  amtLabel: { fontSize: 11, color: C.textSecondary, marginBottom: 4, textAlign: "center" },
  amtValue: { fontWeight: "600", textAlign: "center" },
  summaryDivider: { height: 1, backgroundColor: C.border, marginVertical: 12 },
  memberRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  memberTxt: { fontSize: 13, color: C.textSecondary },
  unpricedBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#FEF3C7", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  unpricedTxt: { fontSize: 12, color: "#92400E", fontWeight: "600" },
  unpricedCta: {
    flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10,
    borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 14, backgroundColor: "#F8FAFC",
  },
  unpricedCtaTxt: { fontSize: 13, fontWeight: "600", color: "#1E3A5F" },

  // Teacher Card
  teacherCard: {
    backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: C.border,
    padding: 16, marginBottom: 10, position: "relative",
  },
  tcHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  tcName: { fontSize: 15, fontWeight: "700", color: C.textPrimary },
  tcMeta: { fontSize: 12, color: C.textSecondary, marginBottom: 10 },
  tcAmounts: { gap: 4 },
  tcChevron: { position: "absolute", right: 14, bottom: 14 },

  // Amount Line
  amtLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  amtLineLabel: { fontSize: 13, color: C.textSecondary },
  amtLineValue: { fontSize: 13 },

  // Status chip
  statusChip: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  statusChipTxt: { fontSize: 11, fontWeight: "600" },

  // Modal
  modalRoot: { flex: 1, backgroundColor: C.background },
  modalHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: 16, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: "#fff",
  },
  modalTitle: { fontSize: 17, fontWeight: "700", color: C.textPrimary },
  modalClose: { padding: 4 },
  modalStatusRow: { padding: 12, paddingBottom: 0 },

  // Detail summary
  detailSummary: {
    backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: C.border,
    padding: 14, marginBottom: 12,
  },
  detailRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 },
  detailLabel: { fontSize: 13, color: C.textSecondary },
  detailValue: { fontSize: 13, fontWeight: "500", color: C.textPrimary },
  detailDivider: { height: 1, backgroundColor: C.border, marginVertical: 6 },

  // has_changed warning
  changedWarning: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: "#FEF3C7", borderRadius: 10, padding: 12, marginBottom: 4,
  },
  changedWarningTxt: { flex: 1, fontSize: 13, color: "#78350F", lineHeight: 19 },

  // Student row
  studentRow: {
    backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: C.border,
    marginBottom: 8, overflow: "hidden",
  },
  studentRowMain: {
    flexDirection: "row", alignItems: "center", padding: 12, gap: 8,
  },
  studentName: { fontSize: 14, fontWeight: "600", color: C.textPrimary },
  studentMeta: { fontSize: 12, color: C.textSecondary, marginTop: 1 },
  studentFinal: { fontSize: 14, fontWeight: "700", color: C.textPrimary },
  unpricedLabel: { fontSize: 12, color: "#92400E", fontWeight: "600" },
  studentDetail: { borderTopWidth: 1, borderTopColor: C.border, padding: 12, gap: 4 },
  sdRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  sdLabel: { fontSize: 12, color: C.textSecondary },
  sdValue: { fontSize: 12, color: C.textSecondary, fontWeight: "500" },

  // Confirm
  confirmBtn: {
    borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 20,
  },
  confirmBtnTxt: { color: "#fff", fontSize: 15, fontWeight: "700" },
  confirmedBadge: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#DCFCE7", borderRadius: 10, padding: 14, marginTop: 16,
  },
  confirmedBadgeTxt: { fontSize: 14, fontWeight: "600", color: "#14532D" },
  infoBox: {
    backgroundColor: "#F1F5F9", borderRadius: 10, padding: 14, marginTop: 16,
  },
  infoBoxTxt: { fontSize: 13, color: C.textSecondary, textAlign: "center" },
});
