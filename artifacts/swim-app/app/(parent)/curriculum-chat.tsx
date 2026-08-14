/**
 * curriculum-chat.tsx — WP3: AI 커리큘럼 상담 채팅
 *
 * GPT형 누적 대화 화면.
 * - history: GET /parent/students/:studentId/curriculum-search/history
 * - send:    POST /parent/students/:studentId/curriculum-search
 *
 * 규칙:
 *   - 서버 history가 source of truth
 *   - optimistic USER bubble → 성공 시 서버 메시지로 교체
 *   - 실패 시 retry (동일 request_id 유지)
 *   - console.log 허용: request_id / status / error_code / remaining quota
 *   - console.log 금지: 학생 이름 / 질문 내용 / 답변 내용 / JWT
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
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
import Colors from "@/constants/colors";
import { LucideIcon } from "@/components/common/LucideIcon";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;
const TEAL = "#2EC4B6";
const TEAL_BG = "#E6FAF8";

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
  current_progress?: ProgressInfo | null;
  next_step?: ProgressInfo | null;
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

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function CurriculumChatScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { studentId, studentName } = useLocalSearchParams<{
    studentId: string;
    studentName?: string;
  }>();

  const effectiveStudentId = studentId ?? "";
  const effectiveStudentName = studentName ?? "아이";

  const [serverMessages, setServerMessages] = useState<CurriculumMsg[]>([]);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState("");
  const [pendingMsg, setPendingMsg] = useState<PendingMsg | null>(null);
  const [currentRequestId, setCurrentRequestId] = useState<string>(newRequestId);

  const scrollRef = useRef<ScrollView>(null);

  const isExhausted = usage !== null && usage.remaining <= 0;
  const canSend = !isExhausted && !sending && input.trim().length > 0;

  // ── History load ──────────────────────────────────────────────────────────

  const loadHistory = useCallback(
    async (quiet = false) => {
      if (!effectiveStudentId) return;
      if (!quiet) setLoading(true);
      try {
        const res = await apiRequest(
          token,
          `/parent/students/${effectiveStudentId}/curriculum-search/history`,
        );
        if (res.ok) {
          const data = await res.json();
          setServerMessages(data.messages ?? []);
          if (data.usage) setUsage(data.usage);
        }
      } catch {
        // network error on history load — show empty (user can still send)
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [token, effectiveStudentId],
  );

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // ── Scroll helpers ─────────────────────────────────────────────────────────

  const scrollToBottom = useCallback((animated = true) => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated }), 140);
  }, []);

  useEffect(() => {
    if (!loading && serverMessages.length > 0) scrollToBottom(false);
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Send / Retry ──────────────────────────────────────────────────────────

  async function handleSend(retry = false) {
    if (sending || isExhausted) return;

    const content = retry
      ? (pendingMsg?.content ?? "").trim()
      : input.trim();
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

    try {
      const res = await apiRequest(
        token,
        `/parent/students/${effectiveStudentId}/curriculum-search`,
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
          current_progress: data.result?.current_progress ?? null,
          next_step: data.result?.next_step ?? null,
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
          Alert.alert("세션 만료", "다시 로그인해 주세요.");
        } else if (res.status === 403) {
          setPendingMsg(null);
          Alert.alert("접근 오류", "해당 학생에 대한 접근 권한이 없습니다.");
        } else if (res.status === 422) {
          setPendingMsg(null);
          if (code === "CURRICULUM_SEARCH_NOT_ELIGIBLE") {
            Alert.alert(
              "서비스 안내",
              "현재 이 수영장에서는 AI 커리큘럼 상담을 사용할 수 없습니다.",
            );
          } else {
            Alert.alert("서비스 준비 중", "AI 커리큘럼 상담이 아직 준비 중입니다.");
          }
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
          <View
            style={[
              s.userBubble,
              isFailed && s.userBubbleFailed,
            ]}
          >
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
            {msg.current_progress ? (
              <ProgressCard
                label="현재 단계"
                title={msg.current_progress.title}
                summary={msg.current_progress.summary}
              />
            ) : null}
            {msg.next_step ? (
              <ProgressCard
                label="다음 단계"
                title={msg.next_step.title}
                summary={msg.next_step.summary}
              />
            ) : null}
          </View>
          {msg.created_at ? (
            <Text style={s.timeText}>{fmtTime(msg.created_at)}</Text>
          ) : null}
        </View>
      </View>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────────

  const SAMPLE_QUESTIONS = [
    "지금 어떤 단계를 배우고 있나요?",
    "다음에는 무엇을 배우나요?",
    "이 단계는 왜 중요한가요?",
  ];

  function renderEmpty() {
    return (
      <View style={s.emptyWrap}>
        <View style={s.emptyIconWrap}>
          <LucideIcon name="bot" size={36} color={TEAL} />
        </View>
        <Text style={s.emptyTitle}>AI 커리큘럼 상담</Text>
        <Text style={s.emptyDesc}>
          우리 아이의 수영 교육과정에 대해 물어보세요.
        </Text>
        <View style={s.sampleWrap}>
          {SAMPLE_QUESTIONS.map((q) => (
            <Pressable
              key={q}
              style={({ pressed }) => [
                s.sampleChip,
                { opacity: pressed ? 0.7 : 1 },
              ]}
              onPress={() => {
                if (!isExhausted && !sending) setInput(q);
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
    if (!usage) return null;
    const { used, limit, remaining, resets_at } = usage;

    if (remaining <= 0) {
      return (
        <View style={[s.usageBanner, s.usageBannerExhausted]}>
          <LucideIcon name="lock" size={14} color="#D97706" />
          <Text style={[s.usageTxt, { color: "#D97706" }]}>
            이번 달 상담 횟수를 모두 사용했습니다.{" "}
            {resets_at ? `${fmtResetsAt(resets_at)}에 초기화됩니다.` : "다음 달에 다시 이용할 수 있습니다."}
          </Text>
        </View>
      );
    }

    return (
      <View style={s.usageBanner}>
        <LucideIcon name="message-circle" size={13} color={C.textMuted} />
        <Text style={[s.usageTxt, { color: C.textSecondary }]}>
          이번 달 {used}/{limit}회 사용 · 남은 질문 {remaining}회
        </Text>
      </View>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────

  const hasMessages = serverMessages.length > 0 || pendingMsg !== null;

  return (
    <KeyboardAvoidingView
      style={[s.root, { backgroundColor: C.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}
    >
      <ParentScreenHeader
        title="AI 커리큘럼 상담"
        subtitle={effectiveStudentName}
        onBack={() => router.back()}
      />

      {renderUsageBanner()}

      {/* ── Message area ── */}
      {loading ? (
        <View style={s.centerWrap}>
          <ActivityIndicator color={TEAL} size="large" />
        </View>
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
          {/* Empty state */}
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
                onRetry: () => handleSend(true),
              },
            )}

          {/* Typing indicator */}
          {sending && <TypingIndicator />}
        </ScrollView>
      )}

      {/* ── Input bar ── */}
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
              이번 달 질문 횟수를 모두 사용했습니다.
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
              onPress={() => handleSend(false)}
              disabled={!canSend}
              style={[
                s.sendBtn,
                { backgroundColor: canSend ? TEAL : C.border },
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
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },

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

  // Empty state
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
    backgroundColor: TEAL,
    borderRadius: 18,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: "100%",
  },
  userBubbleFailed: {
    backgroundColor: "#E5E7EB",
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
});
