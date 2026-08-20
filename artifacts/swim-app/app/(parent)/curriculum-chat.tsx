/**
 * curriculum-chat.tsx — WP-C: AI 커리큘럼 검색 채팅 (WP-B 서버 연동)
 *
 * WP-C 변경:
 *   - XModeGuard 제거 → Normal 학부모도 진입 가능
 *   - Normal / NOT_READY → 안내 UI (입력창·추천질문 숨김, AI 호출 없음)
 *   - 422 CURRICULUM_NOT_AVAILABLE / CURRICULUM_NOT_READY → inline 처리 (Alert 제거)
 *   - 답변 복사 버튼 (expo-clipboard + useToast)
 *   - 추천 질문 spec 기준 업데이트
 *   - 다자녀 학생 switcher (useParent)
 *   - 할당량 초과 메시지 spec 기준 업데이트
 *
 * 규칙:
 *   - 서버 history가 source of truth
 *   - optimistic USER bubble → 성공 시 서버 메시지로 교체
 *   - 실패 시 retry (동일 request_id 유지)
 *   - console.log 허용: request_id / status / error_code / remaining quota
 *   - console.log 금지: 학생 이름 / 질문 내용 / 답변 내용 / JWT
 *   - answer_mode / intent 등 내부 enum 사용자 화면 노출 금지
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import * as Clipboard from "expo-clipboard";
import Colors from "@/constants/colors";
import { LucideIcon } from "@/components/common/LucideIcon";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useMode } from "@/context/ModeContext";
import { useParent, type ChildStudent } from "@/context/ParentContext";
import { useToast } from "@/components/common/Toast";

const C = Colors.light;
import { X as XT } from "@/constants/xTheme";
const TEAL    = XT.ai;       // #2C6FAD — AI 강조색 (steel blue)
const TEAL_BG = XT.aiSoft;   // #E8F2FB — AI 배경 (light blue)
const USER_BUBBLE_COLOR = XT.primary;  // #0F2742 — 유저 버블 = 네이비

// ─── Eligibility ──────────────────────────────────────────────────────────────

/**
 * ELIGIBLE   = 검색 가능 (x/x_pending + curriculum ≥ 300)
 * NOT_AVAILABLE = Normal pool (커리큘럼 없음)
 * NOT_READY  = X pool이지만 curriculum < 300
 */
type Eligibility = "ELIGIBLE" | "NOT_AVAILABLE" | "NOT_READY" | "UNKNOWN";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProgressInfo {
  title: string;
  summary: string;
}

interface CurriculumMsg {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  created_at: string;
  result?: {
    current_progress?: ProgressInfo | null;
    next_step?: ProgressInfo | null;
  } | null;
}

interface UsageInfo {
  limit: number;
  used: number;
  remaining: number;
  period: string;
  resets_at: string;
}

interface PendingMsg {
  requestId: string;
  content: string;
  status: "sending" | "failed";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function newRequestId(): string {
  const h = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  return `curriculum_${h()}${h()}-${h()}-${h()}-${Date.now().toString(36)}`;
}

function fmtTime(raw: string): string {
  try {
    const d = new Date(raw);
    return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function fmtResetsAt(raw: string): string {
  try {
    const d = new Date(raw);
    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  } catch {
    return "";
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProgressCard({
  label,
  title,
  summary,
}: {
  label: string;
  title: string;
  summary: string;
}) {
  return (
    <View style={s.progressCard}>
      <Text style={s.progressLabel}>{label}</Text>
      <Text style={s.progressTitle}>{title}</Text>
      {summary ? <Text style={s.progressSummary}>{summary}</Text> : null}
    </View>
  );
}

function TypingIndicator() {
  return (
    <View style={s.typingWrap}>
      <View style={s.aiIcon}>
        <LucideIcon name="bot" size={14} color={TEAL} />
      </View>
      <View style={[s.assistantBubble, s.typingBubble]}>
        <ActivityIndicator size="small" color={TEAL} />
        <Text style={s.typingText}>커리큘럼을 확인하고 있어요…</Text>
      </View>
    </View>
  );
}

/** 커리큘럼 검색 불가 안내 화면 (Normal / NOT_READY) */
function UnavailableView({ reason }: { reason: "NOT_AVAILABLE" | "NOT_READY" }) {
  const _ = reason; // suppress unused-var — both codes share same message
  return (
    <View style={s.unavailableWrap}>
      <View style={s.unavailableIconWrap}>
        <LucideIcon name="book-x" size={36} color={C.textMuted} />
      </View>
      <Text style={s.unavailableTitle}>커리큘럼 검색 불가</Text>
      <Text style={s.unavailableDesc}>
        현재 수영장에 AI 검색용 커리큘럼이 등록되어 있지 않아{"\n"}
        커리큘럼 AI 검색을 이용할 수 없습니다.
      </Text>
    </View>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function CurriculumChatScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { mode } = useMode();
  const { students } = useParent();
  const { showToast, ToastComponent } = useToast();

  const { studentId: paramStudentId, studentName: paramStudentName } =
    useLocalSearchParams<{ studentId: string; studentName?: string }>();

  // ── Active student ─────────────────────────────────────────────────────────

  const [activeStudentId, setActiveStudentId] = useState<string>(
    paramStudentId ?? "",
  );
  const [showStudentPicker, setShowStudentPicker] = useState(false);

  const activeStudent: ChildStudent | null =
    students.find((s) => s.id === activeStudentId) ??
    (students.length > 0
      ? students.find((s) => s.id === paramStudentId) ?? students[0]
      : null);

  const displayName = activeStudent?.name ?? paramStudentName ?? "아이";

  // ── Chat state ─────────────────────────────────────────────────────────────

  const [serverMessages, setServerMessages] = useState<CurriculumMsg[]>([]);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState("");
  const [pendingMsg, setPendingMsg] = useState<PendingMsg | null>(null);
  const [currentRequestId, setCurrentRequestId] = useState<string>(newRequestId);
  const [eligibility, setEligibility] = useState<Eligibility>("UNKNOWN");

  const scrollRef = useRef<ScrollView>(null);

  // Determine eligibility from pool mode (no API call needed for Normal)
  useEffect(() => {
    if (mode === "normal") {
      setEligibility("NOT_AVAILABLE");
      setLoading(false);
    } else if (mode === "x" || mode === "x_pending") {
      // eligibility confirmed after history load / first send
      setEligibility("ELIGIBLE");
    }
    // mode === null: still loading, keep UNKNOWN
  }, [mode]);

  const isEligible = eligibility === "ELIGIBLE";
  const isExhausted = usage !== null && usage.remaining <= 0;
  const canSend = isEligible && !isExhausted && !sending && input.trim().length > 0;

  // ── History load ───────────────────────────────────────────────────────────

  const loadHistory = useCallback(
    async (studentId: string, quiet = false) => {
      if (!studentId) return;
      if (!quiet) setLoading(true);
      try {
        const res = await apiRequest(
          token,
          `/parent/students/${studentId}/curriculum-search/history`,
        );
        if (res.ok) {
          const data = await res.json();
          setServerMessages(data.messages ?? []);
          if (data.usage) setUsage(data.usage);
        }
      } catch {
        // network error on history load — show empty
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [token],
  );

  // Load history on mount (only if eligible)
  useEffect(() => {
    if (mode === "normal") return; // Normal → no history needed
    if (activeStudentId) loadHistory(activeStudentId);
  }, [activeStudentId, loadHistory, mode]);

  // ── Student switch ─────────────────────────────────────────────────────────

  function handleStudentSwitch(student: ChildStudent) {
    setShowStudentPicker(false);
    if (student.id === activeStudentId) return;
    setActiveStudentId(student.id);
    setServerMessages([]);
    setPendingMsg(null);
    setInput("");
    setCurrentRequestId(newRequestId());
    if (mode !== "normal") {
      loadHistory(student.id);
    }
  }

  // ── Scroll helpers ─────────────────────────────────────────────────────────

  const scrollToBottom = useCallback((animated = true) => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated }), 140);
  }, []);

  useEffect(() => {
    if (!loading && serverMessages.length > 0) scrollToBottom(false);
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Send / Retry ───────────────────────────────────────────────────────────

  async function handleSend(queryOverride?: string, retry = false) {
    if (!isEligible || sending || isExhausted) return;

    const content = retry
      ? (pendingMsg?.content ?? "").trim()
      : (queryOverride ?? input).trim();
    const requestId = retry
      ? (pendingMsg?.requestId ?? currentRequestId)
      : currentRequestId;

    if (!content) return;

    if (!retry) {
      setInput("");
      setPendingMsg({ requestId, content, status: "sending" });
    } else {
      setPendingMsg((prev) => (prev ? { ...prev, status: "sending" } : null));
    }
    setSending(true);
    scrollToBottom();

    try {
      const res = await apiRequest(
        token,
        `/parent/students/${activeStudentId}/curriculum-search`,
        {
          method: "POST",
          body: JSON.stringify({ request_id: requestId, query: content }),
        },
      );

      if (res.ok) {
        const data = await res.json();
        if (data.usage) setUsage(data.usage);
        console.log("[curriculum-chat] success", {
          requestId,
          remaining: data.usage?.remaining,
        });

        const now = new Date().toISOString();
        const userMsg: CurriculumMsg = {
          id: `local_u_${requestId}`,
          role: "USER",
          content,
          created_at: now,
        };
        const assistantMsg: CurriculumMsg = {
          id: `local_a_${requestId}`,
          role: "ASSISTANT",
          content: data.result?.answer ?? "",
          created_at: now,
          result: {
            current_progress: data.result?.current_progress ?? null,
            next_step:        data.result?.next_step        ?? null,
          },
        };

        setPendingMsg(null);
        setServerMessages((prev) => [...prev, userMsg, assistantMsg]);
        setCurrentRequestId(newRequestId());
        scrollToBottom();
      } else {
        const errData = await res.json().catch(() => ({}));
        const code: string = errData.code ?? "";
        console.log("[curriculum-chat] error", { requestId, status: res.status, code });

        if (
          res.status === 429 ||
          code === "PARENT_CURRICULUM_MONTHLY_LIMIT_REACHED"
        ) {
          if (errData.usage) setUsage(errData.usage);
          setPendingMsg(null);
        } else if (res.status === 401) {
          setPendingMsg(null);
          // 세션 만료 — silent; let AuthContext handle
        } else if (res.status === 403) {
          setPendingMsg(null);
          // 접근 권한 없음 — silent
        } else if (
          res.status === 422 &&
          (code === "CURRICULUM_NOT_AVAILABLE" ||
            code === "CURRICULUM_SEARCH_NOT_ELIGIBLE")
        ) {
          setPendingMsg(null);
          setEligibility("NOT_AVAILABLE");
        } else if (res.status === 422 && code === "CURRICULUM_NOT_READY") {
          setPendingMsg(null);
          setEligibility("NOT_READY");
        } else {
          // Retryable (5xx, timeout, ENGINE error)
          setPendingMsg((prev) => (prev ? { ...prev, status: "failed" } : null));
        }
      }
    } catch {
      // Network failure → retryable
      console.log("[curriculum-chat] network error", { requestId });
      setPendingMsg((prev) => (prev ? { ...prev, status: "failed" } : null));
    } finally {
      setSending(false);
    }
  }

  // ── Copy ───────────────────────────────────────────────────────────────────

  async function handleCopy(text: string) {
    try {
      await Clipboard.setStringAsync(text);
      showToast("복사되었습니다", "success");
    } catch {
      showToast("복사에 실패했습니다", "error");
    }
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  function renderUserBubble(
    id: string,
    content: string,
    time: string,
    pending?: { status: "sending" | "failed"; onRetry: () => void },
  ) {
    const isFailed = pending?.status === "failed";
    return (
      <View key={id} style={s.userRow}>
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          {isFailed && (
            <Pressable
              onPress={pending!.onRetry}
              style={s.retryBtn}
              hitSlop={8}
            >
              <LucideIcon name="rotate-ccw" size={12} color="#fff" />
              <Text style={s.retryTxt}>다시 시도</Text>
            </Pressable>
          )}
          <View style={[s.userBubble, isFailed && s.userBubbleFailed]}>
            <Text style={s.userText}>{content}</Text>
          </View>
          {time ? (
            <Text style={[s.timeText, { textAlign: "right" }]}>{time}</Text>
          ) : pending?.status === "sending" ? (
            <ActivityIndicator size="small" color={C.textMuted} style={{ marginRight: 2 }} />
          ) : null}
        </View>
      </View>
    );
  }

  function renderAssistantBubble(msg: CurriculumMsg) {
    return (
      <View key={msg.id} style={s.assistantRow}>
        <View style={s.aiIcon}>
          <LucideIcon name="bot" size={14} color={TEAL} />
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <View style={s.assistantBubble}>
            <Text style={s.assistantText}>{msg.content}</Text>
            {msg.result?.current_progress ? (
              <ProgressCard
                label="현재 단계"
                title={msg.result.current_progress.title}
                summary={msg.result.current_progress.summary}
              />
            ) : null}
            {msg.result?.next_step ? (
              <ProgressCard
                label="다음 단계"
                title={msg.result.next_step.title}
                summary={msg.result.next_step.summary}
              />
            ) : null}
            {/* Copy button */}
            {msg.content ? (
              <Pressable
                onPress={() => handleCopy(msg.content)}
                style={({ pressed }) => [s.copyBtn, { opacity: pressed ? 0.6 : 1 }]}
                hitSlop={6}
              >
                <LucideIcon name="copy" size={12} color={C.textMuted} />
                <Text style={s.copyTxt}>복사</Text>
              </Pressable>
            ) : null}
          </View>
          {msg.created_at ? (
            <Text style={s.timeText}>{fmtTime(msg.created_at)}</Text>
          ) : null}
        </View>
      </View>
    );
  }

  // ── Sample questions ───────────────────────────────────────────────────────

  const SAMPLE_QUESTIONS = [
    "지금 어디까지 배웠나요?",
    "최근에는 무엇을 배우고 있나요?",
    "자유형은 어디까지 했나요?",
    "다음 단계는 무엇인가요?",
  ];

  function renderEmpty() {
    return (
      <View style={s.emptyWrap}>
        <View style={s.emptyIconWrap}>
          <LucideIcon name="bot" size={36} color={TEAL} />
        </View>
        <Text style={s.emptyTitle}>AI 커리큘럼 검색</Text>
        <Text style={s.emptyDesc}>
          우리 아이의 수영 교육과정에 대해 물어보세요.
        </Text>
        <View style={s.sampleWrap}>
          {SAMPLE_QUESTIONS.map((q) => (
            <Pressable
              key={q}
              style={({ pressed }) => [s.sampleChip, { opacity: pressed ? 0.7 : 1 }]}
              onPress={() => {
                if (!isExhausted && !sending) handleSend(q, false);
              }}
            >
              <Text style={s.sampleText}>{q}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  // ── Usage banner ───────────────────────────────────────────────────────────

  function renderUsageBanner() {
    if (!usage || !isEligible) return null;
    const { used, limit, remaining, resets_at } = usage;

    if (remaining <= 0) {
      return (
        <View style={[s.usageBanner, s.usageBannerExhausted]}>
          <LucideIcon name="lock" size={14} color="#D97706" />
          <Text style={[s.usageTxt, { color: "#D97706" }]}>
            이번 달 AI 커리큘럼 검색 이용 횟수를 모두 사용했습니다.{" "}
            {resets_at
              ? `${fmtResetsAt(resets_at)}에 초기화됩니다.`
              : "다음 달에 다시 이용할 수 있습니다."}
          </Text>
        </View>
      );
    }

    return (
      <View style={s.usageBanner}>
        <LucideIcon name="message-circle" size={13} color={C.textMuted} />
        <Text style={[s.usageTxt, { color: C.textSecondary }]}>
          이번 달 AI 검색 {used}/{limit}회
        </Text>
      </View>
    );
  }

  // ── Student picker modal ───────────────────────────────────────────────────

  const hasMultipleStudents = students.length > 1;

  function renderStudentPicker() {
    return (
      <Modal
        visible={showStudentPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowStudentPicker(false)}
      >
        <Pressable
          style={s.pickerOverlay}
          onPress={() => setShowStudentPicker(false)}
        >
          <Pressable style={s.pickerSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={s.pickerTitle}>자녀 선택</Text>
            {students.map((st) => (
              <Pressable
                key={st.id}
                style={({ pressed }) => [
                  s.pickerItem,
                  st.id === activeStudentId && s.pickerItemActive,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
                onPress={() => handleStudentSwitch(st)}
              >
                <Text
                  style={[
                    s.pickerItemText,
                    st.id === activeStudentId && { color: TEAL, fontWeight: "600" as const },
                  ]}
                >
                  {st.name ?? "자녀"}
                </Text>
                {st.id === activeStudentId && (
                  <LucideIcon name="check" size={16} color={TEAL} />
                )}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  // ── Title (with optional student switcher) ─────────────────────────────────

  const headerSubtitle = hasMultipleStudents ? undefined : displayName;

  // ── Main render ────────────────────────────────────────────────────────────

  const hasMessages = serverMessages.length > 0 || pendingMsg !== null;

  // While poolMode is still loading (null), show loader
  const modeLoading = mode === null;

  return (
    <>
      <KeyboardAvoidingView
        style={[s.root, { backgroundColor: C.background }]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}
      >
        {/* Header */}
        <ParentScreenHeader
          title="AI 커리큘럼 검색"
          subtitle={headerSubtitle}
          onBack={() => router.back()}
        />

        {/* Multi-child switcher strip */}
        {hasMultipleStudents && (
          <Pressable
            style={({ pressed }) => [s.studentStrip, { opacity: pressed ? 0.7 : 1 }]}
            onPress={() => setShowStudentPicker(true)}
          >
            <LucideIcon name="user" size={14} color={C.textSecondary} />
            <Text style={s.studentStripText}>{displayName}</Text>
            <LucideIcon name="chevron-down" size={14} color={C.textMuted} />
          </Pressable>
        )}

        {renderUsageBanner()}

        {/* ── Message / Content area ── */}
        {modeLoading || loading ? (
          <View style={s.centerWrap}>
            <ActivityIndicator color={TEAL} size="large" />
          </View>
        ) : !isEligible && eligibility !== "UNKNOWN" ? (
          /* Unavailable (Normal / NOT_READY) */
          <ScrollView
            style={s.scroll}
            contentContainerStyle={[
              s.scrollContent,
              { paddingBottom: Math.max(insets.bottom + 8, 16) },
            ]}
          >
            <UnavailableView reason={eligibility as "NOT_AVAILABLE" | "NOT_READY"} />
          </ScrollView>
        ) : (
          <ScrollView
            ref={scrollRef}
            style={s.scroll}
            contentContainerStyle={[
              s.scrollContent,
              { paddingBottom: Math.max(insets.bottom + 8, 16) },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Empty state with sample questions */}
            {!hasMessages && renderEmpty()}

            {/* Server messages */}
            {serverMessages.map((msg) =>
              msg.role === "USER"
                ? renderUserBubble(msg.id, msg.content, fmtTime(msg.created_at))
                : renderAssistantBubble(msg),
            )}

            {/* Optimistic / pending bubble */}
            {pendingMsg &&
              renderUserBubble(
                `pending_${pendingMsg.requestId}`,
                pendingMsg.content,
                "",
                {
                  status: pendingMsg.status,
                  onRetry: () => handleSend(undefined, true),
                },
              )}

            {/* Typing indicator */}
            {sending && <TypingIndicator />}
          </ScrollView>
        )}

        {/* ── Input bar — only for eligible users ── */}
        {isEligible && (
          <View
            style={[
              s.inputBar,
              {
                borderTopColor: C.border,
                backgroundColor: C.card,
                paddingBottom: Math.max(insets.bottom, 10),
              },
            ]}
          >
            {isExhausted ? (
              <View style={s.exhaustedBar}>
                <LucideIcon name="lock" size={15} color={C.textMuted} />
                <Text style={[s.exhaustedTxt, { color: C.textSecondary }]}>
                  이번 달 AI 커리큘럼 검색 이용 횟수를 모두 사용했습니다.
                  다음 달에 다시 이용할 수 있습니다.
                </Text>
              </View>
            ) : (
              <>
                <TextInput
                  style={[
                    s.textInput,
                    {
                      color: C.text,
                      backgroundColor: C.background,
                      borderColor: C.border,
                    },
                  ]}
                  placeholder="커리큘럼에 대해 질문하세요"
                  placeholderTextColor={C.textMuted}
                  value={input}
                  onChangeText={setInput}
                  multiline
                  maxLength={500}
                  returnKeyType="default"
                  blurOnSubmit={false}
                  editable={!isExhausted && !sending}
                  onSubmitEditing={() => { /* multiline — prevent accidental send */ }}
                />
                <Pressable
                  onPress={() => handleSend()}
                  disabled={!canSend}
                  style={[
                    s.sendBtn,
                    { backgroundColor: canSend ? XT.primary : C.border },
                  ]}
                  hitSlop={4}
                >
                  {sending ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <LucideIcon name="send" size={18} color="#fff" />
                  )}
                </Pressable>
              </>
            )}
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Student picker modal */}
      {renderStudentPicker()}

      {/* Toast */}
      <ToastComponent />
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },

  // Student switcher strip
  studentStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: C.backgroundSoft ?? "#F9FAFB",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  studentStripText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Pretendard-Regular",
    color: C.textSecondary,
  },

  // Usage banner
  usageBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: C.backgroundSoft ?? "#F9FAFB",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  usageBannerExhausted: {
    backgroundColor: "#FFF7ED",
    borderBottomColor: "#FDE68A",
  },
  usageTxt: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Pretendard-Regular",
    lineHeight: 18,
  },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 4 },

  centerWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  // Unavailable state
  unavailableWrap: {
    alignItems: "center",
    paddingTop: 80,
    paddingHorizontal: 24,
    gap: 12,
  },
  unavailableIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: C.backgroundSoft ?? "#F9FAFB",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  unavailableTitle: {
    fontSize: 18,
    fontFamily: "Pretendard-Regular",
    fontWeight: "600" as const,
    color: C.text,
  },
  unavailableDesc: {
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
    color: C.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },

  // Empty state (eligible, no messages)
  emptyWrap: {
    alignItems: "center",
    paddingTop: 60,
    paddingHorizontal: 24,
    gap: 12,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: TEAL_BG,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: "Pretendard-Regular",
    color: C.text,
  },
  emptyDesc: {
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
    color: C.textSecondary,
    textAlign: "center",
    lineHeight: 21,
  },
  sampleWrap: {
    width: "100%",
    gap: 8,
    marginTop: 8,
  },
  sampleChip: {
    backgroundColor: TEAL_BG,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  sampleText: {
    fontSize: 13,
    fontFamily: "Pretendard-Regular",
    color: TEAL,
    textAlign: "center",
  },

  // USER bubble (right-aligned)
  userRow: {
    alignItems: "flex-end",
    marginBottom: 10,
    paddingLeft: 40,
  },
  userBubble: {
    backgroundColor: USER_BUBBLE_COLOR,
    borderRadius: 18,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: "100%",
  },
  userBubbleFailed: {
    backgroundColor: C.border,
  },
  userText: {
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
    color: "#fff",
    lineHeight: 22,
  },

  // Retry button
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#EF4444",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  retryTxt: {
    fontSize: 11,
    fontFamily: "Pretendard-Regular",
    color: "#fff",
  },

  // ASSISTANT bubble (left-aligned)
  assistantRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 10,
    paddingRight: 40,
  },
  aiIcon: {
    width: 28,
    height: 28,
    borderRadius: 10,
    backgroundColor: TEAL_BG,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 2,
  },
  assistantBubble: {
    backgroundColor: C.card,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    gap: 10,
  },
  assistantText: {
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
    color: C.text,
    lineHeight: 22,
  },

  // Copy button (inside assistant bubble)
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingVertical: 2,
  },
  copyTxt: {
    fontSize: 11,
    fontFamily: "Pretendard-Regular",
    color: C.textMuted,
  },

  // Progress card inside ASSISTANT bubble
  progressCard: {
    backgroundColor: TEAL_BG,
    borderRadius: 10,
    padding: 10,
    gap: 3,
  },
  progressLabel: {
    fontSize: 11,
    fontFamily: "Pretendard-Regular",
    color: TEAL,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  progressTitle: {
    fontSize: 13,
    fontFamily: "Pretendard-Regular",
    fontWeight: "600" as const,
    color: C.text,
    lineHeight: 19,
  },
  progressSummary: {
    fontSize: 12,
    fontFamily: "Pretendard-Regular",
    color: C.textSecondary,
    lineHeight: 18,
  },

  // Typing indicator
  typingWrap: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 10,
    paddingRight: 40,
  },
  typingBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
  },
  typingText: {
    fontSize: 13,
    fontFamily: "Pretendard-Regular",
    color: C.textSecondary,
    fontStyle: "italic" as const,
  },

  // Time
  timeText: {
    fontSize: 10,
    fontFamily: "Pretendard-Regular",
    color: C.textMuted,
    marginHorizontal: 4,
  },

  // Input bar
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  textInput: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 10 : 8,
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
    maxHeight: 120,
    minHeight: 42,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },

  // Exhausted input replacement
  exhaustedBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  exhaustedTxt: {
    fontSize: 13,
    fontFamily: "Pretendard-Regular",
    flex: 1,
    lineHeight: 19,
  },

  // Student picker modal
  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  pickerSheet: {
    backgroundColor: C.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 32,
    gap: 4,
  },
  pickerTitle: {
    fontSize: 15,
    fontFamily: "Pretendard-Regular",
    fontWeight: "600" as const,
    color: C.text,
    marginBottom: 12,
  },
  pickerItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  pickerItemActive: {
    // active item — text color changed inline
  },
  pickerItemText: {
    fontSize: 15,
    fontFamily: "Pretendard-Regular",
    color: C.text,
  },
});
