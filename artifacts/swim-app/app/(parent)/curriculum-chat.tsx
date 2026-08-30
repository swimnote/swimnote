/**
 * curriculum-chat.tsx — WP-D: Multi-Conversation History
 *
 * WP-C 변경 유지:
 *   - XModeGuard 제거 → Normal 학부모도 진입 가능
 *   - Normal / x_pending → 이용 불가 UI (입력창/추천질문 없음)
 *   - 서버 history GET의 eligible/reason authority
 *   - 답변 복사 버튼, quota 표시, retryable 실패 처리
 *   - 다자녀 switcher (studentId-scoped race-safe)
 *
 * WP-D 신규:
 *   - activeConversationId + activeConversationIdRef
 *   - conversationList 대화 목록
 *   - POST /conversations → 새 대화 생성 (quota 0, AI 0)
 *   - GET /conversations → 대화 목록 조회
 *   - GET /history?conversation_id= → 특정 대화 messages
 *   - POST /curriculum-search 에 conversation_id 포함 (additive)
 *   - 헤더 우측: 새 대화(+) + 대화목록(list) 버튼
 *   - 대화 목록 BottomSheet — title, 날짜, preview
 *   - 대화 선택/복원 (race guard: studentId + conversationId 이중 guard)
 *   - 학생 전환 시 conversationId/conversationList 초기화
 *
 * 규칙:
 *   - 서버 history가 source of truth
 *   - console.log 허용: request_id / status / error_code / remaining quota
 *   - console.log 금지: 학생 이름 / 질문 내용 / 답변 내용 / JWT
 *   - answer_mode / intent 등 내부 enum 사용자 화면 노출 금지
 *   - GPT title generation 금지. AI 비용 0.
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
const TEAL    = XT.ai;       // #2C6FAD — AI 강조색
const TEAL_BG = XT.aiSoft;   // #E8F2FB — AI 배경
const USER_BUBBLE_COLOR = XT.primary;  // #0F2742 — 유저 버블

// ─── Eligibility ──────────────────────────────────────────────────────────────

/**
 * ELIGIBLE         = 검색 가능 (x mode + curriculum 1개 이상)
 * NOT_AVAILABLE    = Normal 또는 x_pending (X MODE 아님)
 * NOT_REGISTERED   = X MODE이지만 커리큘럼 미등록 (active version 없거나 items 0개)
 * NOT_READY        = (레거시) 준비중 — 현재 실제 발생하지 않음, backward-compat 유지
 * UNKNOWN          = 아직 결정 전 (mode loading 또는 history 로딩 중)
 */
type Eligibility = "ELIGIBLE" | "NOT_AVAILABLE" | "NOT_REGISTERED" | "NOT_READY" | "UNKNOWN";

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
  retryableError?: boolean;
}

/** WP-D: 대화 목록 항목 */
interface ConversationItem {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  last_message_preview: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function newRequestId(): string {
  const h = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  return `curriculum_${h()}${h()}-${h()}-${h()}-${Date.now().toString(36)}`;
}

function fmtTime(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

function fmtResetsAt(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return "";
    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  } catch { return ""; }
}

function fmtDate(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return "";
    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  } catch { return ""; }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProgressCard({ label, title, summary }: { label: string; title: string; summary: string }) {
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

/** 커리큘럼 검색 불가 안내 — eligibility 상태별 메시지 분리 */
function UnavailableView({ eligibility }: { eligibility: Eligibility }) {
  let title = "커리큘럼 검색 불가";
  let desc: string;

  if (eligibility === "NOT_REGISTERED") {
    desc =
      "우리 수영장은 아직 커리큘럼 등록을 하지 않아\nAI 커리큘럼 검색이 활성화되지 않았습니다.";
  } else if (eligibility === "NOT_READY") {
    desc =
      "AI 커리큘럼 검색을 준비 중입니다.\n잠시 후 다시 이용해주세요.";
  } else {
    // NOT_AVAILABLE — Normal / x_pending
    desc =
      "현재 수영장에 AI 검색용 커리큘럼이 등록되어 있지 않아\n커리큘럼 AI 검색을 이용할 수 없습니다.";
  }

  return (
    <View style={s.unavailableWrap}>
      <View style={s.unavailableIconWrap}>
        <LucideIcon name="book-x" size={36} color={C.textMuted} />
      </View>
      <Text style={s.unavailableTitle}>{title}</Text>
      <Text style={s.unavailableDesc}>{desc}</Text>
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

  const [activeStudentId, setActiveStudentId] = useState<string>(paramStudentId ?? "");
  // Ref mirrors state for race-safe async callbacks
  const activeStudentIdRef = useRef<string>(paramStudentId ?? "");
  const [showStudentPicker, setShowStudentPicker] = useState(false);

  const activeStudent: ChildStudent | null =
    students.find((st) => st.id === activeStudentId) ??
    (students.length > 0
      ? (students.find((st) => st.id === paramStudentId) ?? students[0])
      : null);

  const displayName = activeStudent?.name ?? paramStudentName ?? "아이";

  // ── WP-D: Active conversation ──────────────────────────────────────────────

  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  // Ref mirrors state for race-safe async callbacks
  const activeConversationIdRef = useRef<string | null>(null);
  const [conversationList, setConversationList] = useState<ConversationItem[]>([]);
  const [showConversationList, setShowConversationList] = useState(false);
  const [listLoading, setListLoading] = useState(false);

  // ── Chat state ─────────────────────────────────────────────────────────────

  const [serverMessages, setServerMessages] = useState<CurriculumMsg[]>([]);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState("");
  const [pendingMsg, setPendingMsg] = useState<PendingMsg | null>(null);
  const [currentRequestId, setCurrentRequestId] = useState<string>(newRequestId);

  /**
   * Eligibility lifecycle — fully server-authoritative:
   *   - Starts as UNKNOWN (spinner shown)
   *   - history GET response sets eligible/reason → ELIGIBLE | NOT_AVAILABLE | NOT_READY
   *   - POST 422 can also update (belt-and-suspenders)
   *   - Global useMode() NOT used for eligibility (supports multi-pool children)
   */
  const [eligibility, setEligibility] = useState<Eligibility>("UNKNOWN");

  const scrollRef = useRef<ScrollView>(null);

  const isEligible    = eligibility === "ELIGIBLE";
  const isUnavailable = eligibility === "NOT_AVAILABLE" || eligibility === "NOT_REGISTERED" || eligibility === "NOT_READY";
  const isUnknown     = eligibility === "UNKNOWN";
  const isExhausted   = usage !== null && usage.remaining <= 0;
  const canSend       = isEligible && !isExhausted && !sending && input.trim().length > 0;

  // ── WP-D: Load conversation list ───────────────────────────────────────────

  const loadConversationList = useCallback(
    async (studentId: string) => {
      if (!studentId || !token) return;
      const requestedStudentId = studentId;
      setListLoading(true);
      try {
        const res = await apiRequest(
          token,
          `/parent/students/${requestedStudentId}/curriculum-search/conversations`,
        );
        if (activeStudentIdRef.current !== requestedStudentId) return;
        if (res.ok) {
          const data = await res.json();
          if (activeStudentIdRef.current !== requestedStudentId) return;
          setConversationList(data.conversations ?? []);
        }
      } catch {
        // fail silently — not critical path
      } finally {
        if (activeStudentIdRef.current === requestedStudentId) {
          setListLoading(false);
        }
      }
    },
    [token],
  );

  // ── History load — server-authoritative eligibility, studentId+conversationId scoped ─

  const loadHistory = useCallback(
    async (studentId: string, conversationId: string | null) => {
      if (!studentId || !token) return;
      const requestedStudentId      = studentId;
      const requestedConversationId = conversationId;
      // Tracks the conversation id as resolved by THIS request.
      // When the server returns a conversation_id for a null-id request we
      // update this so the finally guard recognises the transition as valid.
      let resolvedConversationId = requestedConversationId;
      setHistoryLoading(true);
      try {
        const url = conversationId
          ? `/parent/students/${requestedStudentId}/curriculum-search/history?conversation_id=${encodeURIComponent(conversationId)}`
          : `/parent/students/${requestedStudentId}/curriculum-search/history`;

        const res = await apiRequest(token, url);

        // Discard stale response — student or conversation changed during await
        if (
          activeStudentIdRef.current      !== requestedStudentId ||
          activeConversationIdRef.current !== requestedConversationId
        ) return;

        if (res.ok) {
          const data = await res.json();
          if (
            activeStudentIdRef.current      !== requestedStudentId ||
            activeConversationIdRef.current !== requestedConversationId
          ) return;

          // Server-authoritative eligibility via additive fields
          if (data.eligible === false) {
            const reason: string = data.reason ?? "";
            setEligibility(
              reason === "CURRICULUM_NOT_REGISTERED" ? "NOT_REGISTERED" :
              reason === "CURRICULUM_NOT_READY"      ? "NOT_READY"      :
              "NOT_AVAILABLE",
            );
            setServerMessages([]);
            if (data.usage) setUsage(data.usage);
            return;
          }

          // eligible: true
          setEligibility("ELIGIBLE");

          // WP-D: server가 반환한 conversation_id로 activeConversationId 동기화.
          // resolvedConversationId도 업데이트해 finally guard가 이 전환을
          // stale로 오판하지 않도록 한다.
          if (data.conversation_id && !requestedConversationId) {
            // 기존 앱 호환: conversation_id 없이 요청했을 때 서버가 반환한 id 사용
            resolvedConversationId = data.conversation_id;
            setActiveConversationId(data.conversation_id);
            activeConversationIdRef.current = data.conversation_id;
          }

          setServerMessages(data.messages ?? []);
          if (data.usage) setUsage(data.usage);
        } else {
          // HTTP error on history load — allow entry; POST surfaces the real error
          setEligibility("ELIGIBLE");
        }
      } catch {
        if (
          activeStudentIdRef.current      !== requestedStudentId ||
          activeConversationIdRef.current !== requestedConversationId
        ) return;
        setEligibility("ELIGIBLE");
      } finally {
        // Guard: only reset loading for the request that is still current.
        // Two valid cases:
        //   (a) conversationId was unchanged throughout — straightforward match.
        //   (b) conversationId was null and this request resolved it from the
        //       server — ref was updated by us, so match against resolvedConversationId.
        const isCurrentRequest =
          activeStudentIdRef.current === requestedStudentId &&
          (
            activeConversationIdRef.current === requestedConversationId ||
            (
              requestedConversationId === null &&
              resolvedConversationId  !== null &&
              activeConversationIdRef.current === resolvedConversationId
            )
          );
        if (isCurrentRequest) {
          setHistoryLoading(false);
        }
      }
    },
    [token],
  );

  // Load history + conversation list on mount
  useEffect(() => {
    if (activeStudentId) {
      loadHistory(activeStudentId, activeConversationId);
      loadConversationList(activeStudentId);
    }
  }, [activeStudentId, loadHistory, loadConversationList]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scroll helpers ─────────────────────────────────────────────────────────

  const scrollToBottom = useCallback((animated = true) => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated }), 140);
  }, []);

  useEffect(() => {
    if (!historyLoading && serverMessages.length > 0) scrollToBottom(false);
  }, [historyLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── WP-D: Create new conversation ─────────────────────────────────────────

  async function createNewConversation() {
    if (!activeStudentId || !token || sending) return;
    const requestedStudentId = activeStudentIdRef.current;

    try {
      const res = await apiRequest(
        token,
        `/parent/students/${requestedStudentId}/curriculum-search/conversations`,
        { method: "POST", body: JSON.stringify({}) },
      );
      if (activeStudentIdRef.current !== requestedStudentId) return;

      if (res.ok) {
        const data = await res.json();
        const newConvId: string = data.id;

        // Update ref before state to invalidate in-flight callbacks
        activeConversationIdRef.current = newConvId;
        setActiveConversationId(newConvId);

        // Reset chat state for the new empty conversation
        setServerMessages([]);
        setPendingMsg(null);
        setInput("");
        setSending(false);
        setCurrentRequestId(newRequestId());
        setEligibility("ELIGIBLE"); // new conv doesn't change eligibility

        // Refresh list
        const newItem: ConversationItem = {
          id:                   newConvId,
          title:                null,
          created_at:           data.created_at ?? new Date().toISOString(),
          updated_at:           data.created_at ?? new Date().toISOString(),
          last_message_at:      null,
          last_message_preview: null,
        };
        setConversationList((prev) => [newItem, ...prev]);
      } else {
        showToast("새 대화를 시작하지 못했습니다.", "error");
      }
    } catch {
      showToast("새 대화를 시작하지 못했습니다.", "error");
    }
  }

  // ── WP-D: Switch conversation ──────────────────────────────────────────────

  function switchConversation(conv: ConversationItem) {
    setShowConversationList(false);
    if (conv.id === activeConversationId) return;

    const currentStudentId = activeStudentIdRef.current;

    // Update refs before state (invalidate in-flight callbacks)
    activeConversationIdRef.current = conv.id;
    setActiveConversationId(conv.id);

    // Reset chat state
    setServerMessages([]);
    setPendingMsg(null);
    setInput("");
    setSending(false);
    setCurrentRequestId(newRequestId());
    setHistoryLoading(false);
    setEligibility("UNKNOWN");

    // Load messages for selected conversation
    loadHistory(currentStudentId, conv.id);
  }

  // ── Student switch — resets state, reloads history (server re-determines eligibility) ─

  function handleStudentSwitch(student: ChildStudent) {
    setShowStudentPicker(false);
    if (student.id === activeStudentId) return;

    // Update refs first (before state) so any in-flight response is discarded
    activeStudentIdRef.current = student.id;
    // Reset conversation refs too
    activeConversationIdRef.current = null;
    setActiveConversationId(null);

    setActiveStudentId(student.id);

    // Reset all conversation state for the incoming student
    setConversationList([]);
    setServerMessages([]);
    setPendingMsg(null);
    setInput("");
    setSending(false);
    setCurrentRequestId(newRequestId());
    setHistoryLoading(false);
    setEligibility("UNKNOWN");
    // usage stays: per parent-account, not per student
  }

  // ── Send / Retry — studentId+conversationId scoped (race safe) ────────────

  async function handleSend(queryOverride?: string, retry = false) {
    if (!isEligible || sending || isExhausted) return;

    // Capture student + conversation IDs at call time
    const sentStudentId      = activeStudentIdRef.current;
    const sentConversationId = activeConversationIdRef.current;

    const content = retry
      ? (pendingMsg?.content ?? "").trim()
      : (queryOverride ?? input).trim();
    const requestId = retry
      ? (pendingMsg?.requestId ?? currentRequestId)
      : currentRequestId;

    if (!content || !sentStudentId) return;

    if (!retry) {
      setInput("");
      setPendingMsg({ requestId, content, status: "sending" });
    } else {
      setPendingMsg((prev) => (prev ? { ...prev, status: "sending", retryableError: false } : null));
    }
    setSending(true);
    scrollToBottom();

    try {
      // WP-D: conversation_id additive field
      const body: Record<string, string> = { request_id: requestId, query: content };
      if (sentConversationId) body.conversation_id = sentConversationId;

      const res = await apiRequest(
        token,
        `/parent/students/${sentStudentId}/curriculum-search`,
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      );

      // Guard: discard if student or conversation changed while in-flight
      if (
        activeStudentIdRef.current      !== sentStudentId ||
        activeConversationIdRef.current !== sentConversationId
      ) return;

      if (res.ok) {
        const data = await res.json();
        if (
          activeStudentIdRef.current      !== sentStudentId ||
          activeConversationIdRef.current !== sentConversationId
        ) return;

        if (data.usage) setUsage(data.usage);
        console.log("[curriculum-chat] success", { requestId, remaining: data.usage?.remaining });

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

        // WP-D: update conversation list with latest preview
        if (sentConversationId) {
          setConversationList((prev) =>
            prev.map((c) =>
              c.id === sentConversationId
                ? {
                    ...c,
                    last_message_at:      now,
                    last_message_preview: data.result?.answer?.slice(0, 100) ?? null,
                    updated_at:           now,
                    // Update title if it was "새 대화" or null — server already updated DB
                    title: c.title === null || c.title === "새 대화"
                      ? (content.length > 30 ? content.slice(0, 30) + "…" : content)
                      : c.title,
                  }
                : c,
            ),
          );
        }

        scrollToBottom();
      } else {
        const errData = await res.json().catch(() => ({}));
        const code: string = errData.code ?? "";
        console.log("[curriculum-chat] error", { requestId, status: res.status, code });

        if (activeStudentIdRef.current !== sentStudentId) return;

        if (res.status === 429 || code === "PARENT_CURRICULUM_MONTHLY_LIMIT_REACHED" || code === "QUOTA_EXCEEDED") {
          if (errData.usage) setUsage(errData.usage);
          setPendingMsg(null);
        } else if (res.status === 401 || res.status === 403) {
          setPendingMsg(null);
        } else if (
          res.status === 422 &&
          (code === "CURRICULUM_NOT_AVAILABLE" || code === "CURRICULUM_SEARCH_NOT_ELIGIBLE")
        ) {
          setPendingMsg(null);
          setEligibility("NOT_AVAILABLE");
        } else if (res.status === 422 && code === "CURRICULUM_NOT_REGISTERED") {
          setPendingMsg(null);
          setEligibility("NOT_REGISTERED");
        } else if (res.status === 422 && code === "CURRICULUM_NOT_READY") {
          setPendingMsg(null);
          setEligibility("NOT_READY");
        } else {
          // Retryable (5xx, timeout, ENGINE error)
          setPendingMsg((prev) => (prev ? { ...prev, status: "failed", retryableError: true } : null));
        }
      }
    } catch {
      if (activeStudentIdRef.current !== sentStudentId) return;
      console.log("[curriculum-chat] network error", { requestId });
      setPendingMsg((prev) => (prev ? { ...prev, status: "failed", retryableError: true } : null));
    } finally {
      if (
        activeStudentIdRef.current      === sentStudentId &&
        activeConversationIdRef.current === sentConversationId
      ) {
        setSending(false);
      }
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
    pending?: { status: "sending" | "failed"; retryableError?: boolean; onRetry: () => void },
  ) {
    const isFailed = pending?.status === "failed";
    const showErrMsg = isFailed && pending?.retryableError;
    return (
      <View key={id} style={s.msgBlock}>
        {/* Retryable error message above bubble */}
        {showErrMsg && (
          <View style={s.retryableErrRow}>
            <Text style={s.retryableErrTxt}>
              답변을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
            </Text>
          </View>
        )}
        <View style={s.userRow}>
          <View style={{ alignItems: "flex-end", gap: 4 }}>
            {isFailed && (
              <Pressable onPress={pending!.onRetry} style={s.retryBtn} hitSlop={8}>
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
      </View>
    );
  }

  /**
   * 답변 텍스트를 단락 + 섹션 제목으로 렌더링.
   *
   * 제목 인식 정책 (보수적):
   *   `**제목**` 형식 전체 라인만 SemiBold로 처리.
   *   plain text 자동 제목 판정 없음 — 짧은 본문 문장을 오인할 위험이 있어 제거.
   *
   * 나머지:
   *   - 빈 줄 → height:6 단락 간격 (연속 빈 줄은 하나로 합침)
   *   - 본문 → Regular, 잔여 `**...**` 마커는 텍스트만 추출(리터럴 노출 방지)
   *
   * 보장:
   *   - 빈 문자열 / 한 문단 / 긴 답변 / 연속 빈 줄 → crash 없음
   *   - 복사 원문은 msg.content 그대로 사용 (이 함수와 무관)
   */
  function renderFormattedText(text: string) {
    if (!text) return null;
    const lines = text.split("\n");
    const nodes: React.ReactNode[] = [];
    let prevWasSpacer = true; // 연속 빈 줄 collapse용

    lines.forEach((line, i) => {
      const trimmed = line.trim();

      // ── 빈 줄 ────────────────────────────────────────────────────────────
      if (!trimmed) {
        if (!prevWasSpacer) {
          nodes.push(<View key={`sp-${i}`} style={{ height: 6 }} />);
          prevWasSpacer = true;
        }
        return;
      }

      // ── **제목** 전체 라인 → SemiBold (backward-compat) ─────────────────
      const mdTitle = trimmed.match(/^\*\*([^*]+)\*\*$/);
      if (mdTitle) {
        nodes.push(
          <Text key={`t-${i}`} style={[s.assistantText, s.assistantSectionTitle]}>
            {mdTitle[1]}
          </Text>,
        );
        prevWasSpacer = false;
        return;
      }

      // ── 본문: 잔여 **마커** 제거 후 Regular 렌더링 ───────────────────────
      const body = trimmed.replace(/\*\*([^*]+)\*\*/g, "$1");
      nodes.push(
        <Text key={`l-${i}`} style={s.assistantText}>{body}</Text>,
      );
      prevWasSpacer = false;
    });

    return <>{nodes}</>;
  }

  function renderAssistantBubble(msg: CurriculumMsg) {
    return (
      <View key={msg.id} style={s.assistantRow}>
        <View style={s.aiIcon}>
          <LucideIcon name="bot" size={14} color={TEAL} />
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <View style={s.assistantBubble}>
            {renderFormattedText(msg.content)}
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
        <Text style={s.emptyDesc}>우리 아이의 수영 교육과정에 대해 물어보세요.</Text>
        <View style={s.sampleWrap}>
          {SAMPLE_QUESTIONS.map((q) => (
            <Pressable
              key={q}
              style={({ pressed }) => [s.sampleChip, { opacity: pressed ? 0.7 : 1 }]}
              onPress={() => { if (!isExhausted && !sending) handleSend(q, false); }}
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
            이번 달 AI 교육과정 검색 4회를 모두 사용했어요.{" "}
            {resets_at ? `${fmtResetsAt(resets_at)}에 초기화됩니다.` : "다음 달에 다시 이용할 수 있습니다."}
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

  // ── WP-D: Conversation list modal ─────────────────────────────────────────

  function renderConversationList() {
    return (
      <Modal
        visible={showConversationList}
        transparent
        animationType="slide"
        onRequestClose={() => setShowConversationList(false)}
      >
        <Pressable style={s.pickerOverlay} onPress={() => setShowConversationList(false)}>
          <Pressable style={s.convListSheet} onPress={(e) => e.stopPropagation()}>
            <View style={s.convListHeader}>
              <Text style={s.pickerTitle}>대화 목록</Text>
              <Pressable onPress={() => setShowConversationList(false)} hitSlop={8}>
                <LucideIcon name="x" size={18} color={C.textMuted} />
              </Pressable>
            </View>

            {listLoading ? (
              <View style={s.convListLoadingWrap}>
                <ActivityIndicator color={TEAL} />
              </View>
            ) : conversationList.length === 0 ? (
              <View style={s.convListEmptyWrap}>
                <Text style={s.convListEmptyText}>대화 기록이 없습니다.</Text>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
                {conversationList.map((conv) => {
                  const isActive = conv.id === activeConversationId;
                  return (
                    <Pressable
                      key={conv.id}
                      style={({ pressed }) => [
                        s.convItem,
                        isActive && s.convItemActive,
                        { opacity: pressed ? 0.7 : 1 },
                      ]}
                      onPress={() => switchConversation(conv)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[s.convItemTitle, isActive && { color: TEAL }]}
                          numberOfLines={1}
                        >
                          {conv.title ?? "새 대화"}
                        </Text>
                        {conv.last_message_preview ? (
                          <Text style={s.convItemPreview} numberOfLines={1}>
                            {conv.last_message_preview}
                          </Text>
                        ) : null}
                        <Text style={s.convItemDate}>
                          {fmtDate(conv.last_message_at ?? conv.created_at)}
                        </Text>
                      </View>
                      {isActive && (
                        <LucideIcon name="check" size={16} color={TEAL} />
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
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
        <Pressable style={s.pickerOverlay} onPress={() => setShowStudentPicker(false)}>
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

  // ── Main render ────────────────────────────────────────────────────────────

  const hasMessages = serverMessages.length > 0 || pendingMsg !== null;

  // Show spinner while history is loading or eligibility not yet determined
  const showSpinner = historyLoading || isUnknown;

  return (
    <>
      <KeyboardAvoidingView
        style={[s.root, { backgroundColor: C.background }]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}
      >
        {/* Header — WP-D: 새 대화(+) + 대화목록 버튼 우측 추가 */}
        <ParentScreenHeader
          title="AI 커리큘럼 검색"
          subtitle={hasMultipleStudents ? undefined : displayName}
          onBack={() => router.back()}
          rightSlot={
            <View style={s.headerActions}>
              {/* 대화 목록 버튼 */}
              <Pressable
                onPress={() => {
                  loadConversationList(activeStudentId);
                  setShowConversationList(true);
                }}
                style={({ pressed }) => [s.headerBtn, { opacity: pressed ? 0.6 : 1 }]}
                hitSlop={8}
              >
                <LucideIcon name="history" size={20} color={C.textSecondary} />
              </Pressable>
              {/* 새 대화 버튼 */}
              <Pressable
                onPress={createNewConversation}
                disabled={sending}
                style={({ pressed }) => [s.headerBtn, { opacity: pressed ? 0.6 : 1 }]}
                hitSlop={8}
              >
                <LucideIcon name="square-pen" size={20} color={C.textSecondary} />
              </Pressable>
            </View>
          }
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

        {/* ── Content area ── */}
        {showSpinner ? (
          <View style={s.centerWrap}>
            <ActivityIndicator color={TEAL} size="large" />
          </View>
        ) : isUnavailable ? (
          /* NOT_AVAILABLE / NOT_REGISTERED / NOT_READY — no input, no sample questions, no AI call */
          <ScrollView
            style={s.scroll}
            contentContainerStyle={[s.scrollContent, { paddingBottom: Math.max(insets.bottom + 8, 16) }]}
          >
            <UnavailableView eligibility={eligibility} />
          </ScrollView>
        ) : (
          /* ELIGIBLE */
          <ScrollView
            ref={scrollRef}
            style={s.scroll}
            contentContainerStyle={[s.scrollContent, { paddingBottom: Math.max(insets.bottom + 8, 16) }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {!hasMessages && renderEmpty()}

            {serverMessages.map((msg) =>
              msg.role === "USER"
                ? renderUserBubble(msg.id, msg.content, fmtTime(msg.created_at))
                : renderAssistantBubble(msg),
            )}

            {pendingMsg &&
              renderUserBubble(
                `pending_${pendingMsg.requestId}`,
                pendingMsg.content,
                "",
                {
                  status: pendingMsg.status,
                  retryableError: pendingMsg.retryableError,
                  onRetry: () => handleSend(undefined, true),
                },
              )}

            {sending && <TypingIndicator />}
          </ScrollView>
        )}

        {/* ── Input bar — ELIGIBLE only ── */}
        {isEligible && !showSpinner && (
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
                  이번 달 AI 교육과정 검색 4회를 모두 사용했어요.{"\n"}다음 달에 다시 이용할 수 있습니다.
                </Text>
              </View>
            ) : (
              <>
                <TextInput
                  style={[
                    s.textInput,
                    { color: C.text, backgroundColor: C.background, borderColor: C.border },
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
                  onSubmitEditing={() => { /* multiline — no accidental send */ }}
                />
                <Pressable
                  onPress={() => handleSend()}
                  disabled={!canSend}
                  style={[s.sendBtn, { backgroundColor: canSend ? XT.primary : C.border }]}
                  hitSlop={4}
                >
                  {sending
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <LucideIcon name="send" size={18} color="#fff" />}
                </Pressable>
              </>
            )}
          </View>
        )}
      </KeyboardAvoidingView>

      {renderStudentPicker()}
      {renderConversationList()}
      <ToastComponent />
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },

  // WP-D: 헤더 우측 액션 버튼
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  headerBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },

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

  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 4 },

  centerWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

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

  // Message block (user bubble + optional error message)
  msgBlock: {
    marginBottom: 10,
  },
  retryableErrRow: {
    alignItems: "flex-end",
    paddingLeft: 40,
    marginBottom: 4,
  },
  retryableErrTxt: {
    fontSize: 12,
    fontFamily: "Pretendard-Regular",
    color: "#EF4444",
    lineHeight: 18,
    textAlign: "right",
  },

  userRow: {
    alignItems: "flex-end",
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
  assistantSectionTitle: {
    fontFamily: "Pretendard-SemiBold",
    lineHeight: 22, // clipping 방지 (Pretendard 한글 받침)
    marginTop: 8,
  },

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

  timeText: {
    fontSize: 10,
    fontFamily: "Pretendard-Regular",
    color: C.textMuted,
    marginHorizontal: 4,
  },

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
  pickerItemActive: {},
  pickerItemText: {
    fontSize: 15,
    fontFamily: "Pretendard-Regular",
    color: C.text,
  },

  // WP-D: Conversation list sheet
  convListSheet: {
    backgroundColor: C.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 32,
    gap: 4,
    maxHeight: "75%",
  },
  convListHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  convListLoadingWrap: {
    paddingVertical: 40,
    alignItems: "center",
  },
  convListEmptyWrap: {
    paddingVertical: 40,
    alignItems: "center",
  },
  convListEmptyText: {
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
    color: C.textMuted,
  },
  convItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
    gap: 8,
  },
  convItemActive: {
    backgroundColor: TEAL_BG,
    borderRadius: 10,
    paddingHorizontal: 10,
    marginHorizontal: -10,
  },
  convItemTitle: {
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
    fontWeight: "600" as const,
    color: C.text,
    lineHeight: 20,
  },
  convItemPreview: {
    fontSize: 12,
    fontFamily: "Pretendard-Regular",
    color: C.textSecondary,
    lineHeight: 17,
    marginTop: 2,
  },
  convItemDate: {
    fontSize: 11,
    fontFamily: "Pretendard-Regular",
    color: C.textMuted,
    marginTop: 2,
  },
});
