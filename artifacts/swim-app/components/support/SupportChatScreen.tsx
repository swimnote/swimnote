/**
 * SupportChatScreen — WP-CS-02R
 *
 * 단일 고객지원 UI: 관리자 / 선생님 / 학부모, Normal/X 공통.
 *
 * 기능:
 *  - 기존 active case 자동 재개 | 새 문의 버튼
 *  - POST /support/cases → case 생성
 *  - POST /support/cases/:id/messages → 메시지 전송 (author_role=user 고정)
 *  - GET /support/cases/:id → 대화 이력 + 상태
 *  - "해결됐어요"  → POST /support/cases/:id/resolve
 *  - "아직 안돼요" → 상담사 CTA 표시
 *  - "상담사에게 문의하기" → POST /support/cases/:id/request-human (idempotent)
 *  - focus refresh + 수동 refresh (pull-to-refresh)
 *  - double-tap 방지 (isSending, isResolving, isRequestingHuman)
 *  - 프라이버시: console에 본문·토큰·이름 미출력
 *
 * NO fake AI: "AI 자동답변" UI 없음. OpenAI 호출 없음.
 * "문의가 접수되었습니다" = deterministic system message.
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Constants from "expo-constants";
import Colors from "@/constants/colors";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useMode } from "@/context/ModeContext";
import { LucideIcon } from "@/components/common/LucideIcon";

const C   = Colors.light;

// ── Master state → 사용자 노출 문구 ──────────────────────────────────────────

const MASTER_STATE_LABEL: Record<string, string> = {
  AI_ACTIVE:        "문의 확인 중",
  WAITING:          "답변 확인 대기",
  AGENT_REQUESTED:  "상담사 연결 대기",
  AGENT_ACTIVE:     "상담사가 확인 중",
  PHONE_REQUIRED:   "추가 확인 필요",
  RESOLVED:         "해결 완료",
  REOPENED:         "문의 재개",
};

const MASTER_STATE_COLOR: Record<string, string> = {
  AI_ACTIVE:        "#0369A1",
  WAITING:          "#D97706",
  AGENT_REQUESTED:  "#7C3AED",
  AGENT_ACTIVE:     "#059669",
  PHONE_REQUIRED:   "#DC2626",
  RESOLVED:         "#16A34A",
  REOPENED:         "#D97706",
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface SupportMessage {
  id: string;
  author_role: "user" | "ai" | "agent" | "system";
  content: string;
  created_at: string;
}

interface SupportCase {
  id: string;
  state: string;
  master_state: string;
  ticket_id: string | null;
  messages: SupportMessage[];
  updated_at: string;
}

interface SupportContext {
  sourceRoute?:  string;
  featureId?:    string;
  reportId?:     string;
  studentId?:    string;
}

interface Props {
  supportContext?: SupportContext;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildDeviceContext() {
  const expo  = Constants.expoConfig ?? Constants.manifest as any;
  return {
    app_version:     (expo?.version as string)           ?? null,
    runtime_version: (expo?.runtimeVersion as string)    ?? null,
    os_family:       Platform.OS,
    os_version:      String(Platform.Version),
  };
}

function fmtTime(raw: string | null | undefined): string {
  if (!raw) return "";
  // PostgreSQL created_at::text → "2026-08-17 08:22:01.123456" (space, no tz)
  // iOS JSC requires ISO 8601: replace space with T so Date() parses correctly
  const iso = raw.replace(" ", "T");
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function SupportChatScreen({ supportContext }: Props) {
  const { token, userId, poolId, role } = useAuth() as any;
  const { mode }                         = useMode();
  const insets                           = useSafeAreaInsets();

  // ── State ──────────────────────────────────────────────────────────────────

  const [caseList,   setCaseList]   = useState<{ id: string; state: string; master_state: string; updated_at: string }[]>([]);
  const [activeCase, setActiveCase] = useState<SupportCase | null>(null);
  const [loadingCase,setLoadingCase]= useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const [inputText,  setInputText]  = useState("");
  const [isSending,        setIsSending]        = useState(false);
  const [isResolving,      setIsResolving]      = useState(false);
  const [isRequestingHuman,setIsRequestingHuman]= useState(false);
  const [showHumanCta,     setShowHumanCta]     = useState(false);

  const scrollRef = useRef<ScrollView>(null);

  // ── API helpers ───────────────────────────────────────────────────────────

  async function fetchCaseList() {
    try {
      const res = await apiRequest(token, "/support/cases");
      if (!res.ok) {
        if (res.status === 401) { setError("로그인이 필요합니다."); return; }
        if (res.status === 403) { setError("접근 권한이 없습니다."); return; }
        return;
      }
      const data = await res.json();
      const list = (data.cases ?? []) as any[];
      setCaseList(list);

      // active case 자동 재개: RESOLVED/CLOSED/AI_RESOLVED 제외
      const closed = new Set(["RESOLVED", "CLOSED", "AI_RESOLVED"]);
      const active = list.find((c) => !closed.has(c.state));
      if (active) {
        await fetchCaseDetail(active.id);
      } else {
        setActiveCase(null);
      }
    } catch {
      // network failure — error stays null, retry on focus
    } finally {
      setLoadingCase(false);
      setRefreshing(false);
    }
  }

  async function fetchCaseDetail(caseId: string) {
    try {
      const res = await apiRequest(token, `/support/cases/${caseId}`);
      if (!res.ok) return;
      const data = await res.json();
      const newMasterState: string = data.master_state ?? "";
      setActiveCase({
        id:           data.case.id,
        state:        data.case.state,
        master_state: newMasterState,
        ticket_id:    data.case.ticket_id ?? null,
        messages:     data.messages ?? [],
        updated_at:   data.case.updated_at,
      });
      // STALE-06 fix: FAQ 성공 후 human CTA local state 자동 해제.
      // master_state가 human escalation 상태가 아니면 showHumanCta를 false로 리셋.
      const humanStates = new Set(["AGENT_REQUESTED", "AGENT_ACTIVE", "PHONE_REQUIRED"]);
      if (!humanStates.has(newMasterState)) {
        setShowHumanCta(false);
      }
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 100);
    } catch { /* ignore */ }
  }

  async function refresh() {
    setRefreshing(true);
    if (activeCase) {
      await fetchCaseDetail(activeCase.id);
      setRefreshing(false);
    } else {
      await fetchCaseList();
    }
  }

  // ── Initial load + focus refresh ─────────────────────────────────────────

  useEffect(() => {
    fetchCaseList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!loadingCase) {
        if (activeCase) {
          fetchCaseDetail(activeCase.id);
        } else {
          fetchCaseList();
        }
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeCase?.id, loadingCase])
  );

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleSend() {
    const text = inputText.trim();
    if (!text || isSending) return;

    setIsSending(true);
    setInputText("");

    try {
      // "__new__" is a UI sentinel — treat it as no real case yet
      let caseId: string | null =
        activeCase?.id && activeCase.id !== "__new__" ? activeCase.id : null;

      // Case 없으면 생성
      if (!caseId) {
        const deviceCtx = buildDeviceContext();
        const ctx = {
          feature_id:        supportContext?.featureId ?? "SUPPORT",
          subscription_plan: null,
          ...deviceCtx,
          current_route:     supportContext?.sourceRoute ?? "settings",
        };
        const cRes = await apiRequest(token, "/support/cases", {
          method: "POST",
          body:   JSON.stringify({ mode, context: ctx }),
        });
        if (!cRes.ok) {
          const errMsg = cRes.status === 401 ? "로그인 정보가 만료되었습니다."
            : cRes.status === 403            ? "접근 권한이 없습니다."
            : cRes.status >= 500             ? "서버 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
            : "문의를 시작할 수 없습니다. 잠시 후 다시 시도해주세요.";
          console.log("[support] case create failed:", cRes.status);
          setError(errMsg);
          setInputText(text);
          return;
        }
        let cData: any;
        try { cData = await cRes.json(); } catch {
          console.log("[support] case create response parse error");
          setError("서버 응답을 처리할 수 없습니다. 잠시 후 다시 시도해주세요.");
          setInputText(text);
          return;
        }
        caseId = cData.id as string;
        console.log("[support] case created:", caseId, "status:", cRes.status);
      }

      // CS-08R: POST /support/respond — AI Engine 엔드포인트
      // 사용자 메시지 저장 + resolution chain + LLM fallback을 서버에서 일괄 처리.
      const deviceCtxForRespond = buildDeviceContext();
      const mRes = await apiRequest(token, `/support/respond`, {
        method: "POST",
        body:   JSON.stringify({
          case_id:     caseId,
          message:     text,
          mode,
          screen_id:   supportContext?.featureId ?? null,
          app_version: deviceCtxForRespond.app_version,
        }),
      });

      if (!mRes.ok) {
        const errMsg = mRes.status === 401 ? "로그인 정보가 만료되었습니다."
          : mRes.status === 403             ? "접근 권한이 없습니다."
          : mRes.status === 409             ? "문의가 이미 종료된 상태입니다. 새 문의를 시작해주세요."
          : mRes.status >= 500              ? "서버 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
          : "메시지를 저장하지 못했습니다. 다시 시도해주세요.";
        console.log("[support] respond failed:", mRes.status);
        setError(errMsg);
        setInputText(text);
        return;
      }

      setError(null);
      await fetchCaseDetail(caseId!);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
    } catch (e: any) {
      // fetch 자체 실패 (네트워크 단절) 또는 JSON parse 예외
      const isNetworkErr = e instanceof TypeError && e.message?.includes("fetch");
      console.log("[support] send exception:", isNetworkErr ? "network" : "parse/unknown");
      setError(isNetworkErr
        ? "네트워크 연결을 확인해주세요."
        : "서버 응답을 처리할 수 없습니다. 잠시 후 다시 시도해주세요."
      );
      setInputText(text);
    } finally {
      setIsSending(false);
    }
  }

  async function handleResolve() {
    if (!activeCase || isResolving) return;
    setIsResolving(true);
    try {
      const res = await apiRequest(token, `/support/cases/${activeCase.id}/resolve`, {
        method: "POST",
        body:   JSON.stringify({}),
      });
      if (res.ok) {
        setError(null);
        await fetchCaseDetail(activeCase.id);
      } else {
        setError("해결 처리 중 오류가 발생했습니다.");
      }
    } catch {
      setError("네트워크 오류. 다시 시도해주세요.");
    } finally {
      setIsResolving(false);
    }
  }

  async function handleNotResolved() {
    // AI 엔진 없는 현재 단계: 상담사 CTA 표시
    setShowHumanCta(true);
  }

  async function handleRequestHuman() {
    if (!activeCase || isRequestingHuman) return;
    setIsRequestingHuman(true);
    try {
      const res = await apiRequest(token, `/support/cases/${activeCase.id}/request-human`, {
        method: "POST",
        body:   JSON.stringify({ subject: "AI 문의 후 상담사 연결 요청" }),
      });
      if (res.ok) {
        setError(null);
        setShowHumanCta(false);
        await fetchCaseDetail(activeCase.id);
      } else if (res.status === 422) {
        // 이미 human 상태 — 무시 (idempotent)
        setShowHumanCta(false);
        await fetchCaseDetail(activeCase.id);
      } else {
        setError("상담사 연결 요청 중 오류가 발생했습니다.");
      }
    } catch {
      setError("네트워크 오류. 다시 시도해주세요.");
    } finally {
      setIsRequestingHuman(false);
    }
  }

  async function handleNewCase() {
    setActiveCase(null);
    setCaseList([]);
    setShowHumanCta(false);
    setError(null);
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  const masterState  = activeCase?.master_state ?? "";
  const stateLabel   = MASTER_STATE_LABEL[masterState] ?? masterState;
  const stateColor   = MASTER_STATE_COLOR[masterState] ?? C.textMuted;
  const isResolved   = masterState === "RESOLVED";
  const isHuman      = ["AGENT_REQUESTED", "AGENT_ACTIVE", "PHONE_REQUIRED"].includes(masterState);

  function renderMessage(msg: SupportMessage, idx: number) {
    const isUser   = msg.author_role === "user";
    const isSystem = msg.author_role === "system";

    if (isSystem) {
      return (
        <View key={msg.id ?? idx} style={s.systemMsg}>
          <Text style={s.systemMsgText}>{msg.content}</Text>
        </View>
      );
    }

    const roleLabel =
      msg.author_role === "ai"    ? "시스템"
      : msg.author_role === "agent" ? "상담사"
      : null;

    return (
      <View
        key={msg.id ?? idx}
        style={[s.msgRow, isUser ? s.msgRowRight : s.msgRowLeft]}
      >
        {!isUser && (
          <View style={s.avatarWrap}>
            <LucideIcon
              name={msg.author_role === "agent" ? "user-check" : "bot"}
              size={14}
              color={C.textMuted}
            />
          </View>
        )}
        <View style={{ maxWidth: "75%" }}>
          {roleLabel && (
            <Text style={[s.msgRoleLabel, isUser && s.msgRoleLabelRight]}>{roleLabel}</Text>
          )}
          <View style={[s.bubble, isUser ? s.bubbleUser : s.bubbleOther]}>
            <Text style={[s.bubbleText, isUser ? s.bubbleTextUser : s.bubbleTextOther]}>
              {msg.content}
            </Text>
          </View>
          <Text style={[s.msgTime, isUser && s.msgTimeRight]}>{fmtTime(msg.created_at)}</Text>
        </View>
      </View>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loadingCase) {
    return (
      <View style={[s.root, { backgroundColor: C.background }]}>
        <SubScreenHeader title="AI 문의" />
        <View style={s.center}>
          <ActivityIndicator color={C.brandStrong} />
        </View>
      </View>
    );
  }

  // ── New case / case list view ─────────────────────────────────────────────

  if (!activeCase) {
    const closedCases = caseList.filter((c) =>
      ["RESOLVED", "CLOSED", "AI_RESOLVED"].includes(c.state)
    );
    return (
      <View style={[s.root, { backgroundColor: C.background }]}>
        <SubScreenHeader title="AI 문의" />
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40, gap: 16 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={fetchCaseList} />
          }
        >
          {/* 안내 카드 */}
          <View style={[s.infoCard, { backgroundColor: C.card }]}>
            <View style={s.infoIconWrap}>
              <LucideIcon name="message-circle" size={24} color={C.brandStrong} />
            </View>
            <Text style={[s.infoTitle, { color: C.text }]}>무엇이 궁금하세요?</Text>
            <Text style={[s.infoDesc, { color: C.textMuted }]}>
              스윔노트 사용에 대한 문의를 남겨주세요.{"\n"}
              운영팀이 확인 후 답변드립니다.
            </Text>
          </View>

          {/* 새 문의 시작 */}
          <Pressable
            style={({ pressed }) => [s.startBtn, { opacity: pressed ? 0.8 : 1, backgroundColor: C.brandStrong }]}
            onPress={() => {
              // 빈 케이스 UI로 전환 (첫 메시지 전송 시 생성)
              setActiveCase({ id: "__new__", state: "NEW", master_state: "AI_ACTIVE", ticket_id: null, messages: [], updated_at: "" });
            }}
          >
            <LucideIcon name="plus" size={18} color="#fff" />
            <Text style={s.startBtnText}>새 문의 시작하기</Text>
          </Pressable>

          {/* 기존 해결된 케이스 */}
          {closedCases.length > 0 && (
            <View>
              <Text style={[s.sectionTitle, { color: C.textMuted }]}>이전 문의</Text>
              {closedCases.slice(0, 5).map((c) => (
                <Pressable
                  key={c.id}
                  style={({ pressed }) => [s.caseRow, { backgroundColor: C.card, opacity: pressed ? 0.8 : 1 }]}
                  onPress={() => fetchCaseDetail(c.id)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[s.caseRowState, { color: MASTER_STATE_COLOR[c.master_state] ?? C.textMuted }]}>
                      {MASTER_STATE_LABEL[c.master_state] ?? c.master_state}
                    </Text>
                    <Text style={[s.caseRowDate, { color: C.textMuted }]}>
                      {c.updated_at?.slice(0, 10) ?? ""}
                    </Text>
                  </View>
                  <LucideIcon name="chevron-right" size={16} color={C.textMuted} />
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  // ── Conversation view ─────────────────────────────────────────────────────

  const isNewCase = activeCase.id === "__new__";

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <SubScreenHeader
        title="AI 문의"
        subtitle={!isNewCase ? stateLabel : undefined}
        onBack={isNewCase ? () => setActiveCase(null) : undefined}
        rightSlot={
          !isNewCase ? (
            <Pressable onPress={refresh} hitSlop={8} style={s.refreshBtn}>
              <LucideIcon name="refresh-cw" size={16} color={C.textMuted} />
            </Pressable>
          ) : undefined
        }
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        {/* 상태 뱃지 */}
        {!isNewCase && (
          <View style={[s.stateBadgeRow, { backgroundColor: C.card }]}>
            <View style={[s.stateDot, { backgroundColor: stateColor }]} />
            <Text style={[s.stateText, { color: stateColor }]}>{stateLabel}</Text>
            <Pressable
              onPress={handleNewCase}
              style={({ pressed }) => [s.newCaseLink, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={[s.newCaseLinkText, { color: C.textMuted }]}>새 문의</Text>
            </Pressable>
          </View>
        )}

        {/* 대화 영역 */}
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 8 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} />
          }
          onContentSizeChange={() => {
            if (activeCase.messages.length > 0) {
              scrollRef.current?.scrollToEnd({ animated: false });
            }
          }}
        >
          {/* 빈 상태 */}
          {activeCase.messages.length === 0 && (
            <View style={s.emptyState}>
              <LucideIcon name="message-circle" size={32} color={C.border} />
              <Text style={[s.emptyText, { color: C.textMuted }]}>
                {isNewCase
                  ? "문의 내용을 입력하고 전송해주세요."
                  : "대화 내용을 불러오는 중..."}
              </Text>
            </View>
          )}

          {/* 메시지 목록 */}
          {activeCase.messages.map((msg, idx) => renderMessage(msg, idx))}

          {/* 문의 접수 안내 — STALE-05 fix:
               human escalation이 실제 active인 경우에만 표시.
               정상 FAQ/deterministic 응답이 존재하는 경우(isHuman=false) 숨김.
               조건: isHuman=true AND 시스템 메시지 없음 */}
          {!isNewCase &&
            isHuman &&
            activeCase.messages.length > 0 &&
            !activeCase.messages.some((m) => m.author_role === "system") && (
              <View style={s.systemMsg}>
                <Text style={s.systemMsgText}>
                  문의가 접수되었습니다. 운영팀이 확인 후 답변드립니다.
                </Text>
              </View>
            )}

          {/* 해결/미해결 버튼 — human 상태 아닐 때 */}
          {!isNewCase && !isResolved && !isHuman && (
            <View style={s.actionRow}>
              <Pressable
                style={({ pressed }) => [
                  s.actionBtn,
                  { borderColor: "#16A34A", backgroundColor: "#F0FDF4", opacity: pressed ? 0.8 : 1 },
                  isResolving && { opacity: 0.5 },
                ]}
                onPress={handleResolve}
                disabled={isResolving}
              >
                {isResolving
                  ? <ActivityIndicator size="small" color="#16A34A" />
                  : <LucideIcon name="check-circle" size={16} color="#16A34A" />}
                <Text style={[s.actionBtnText, { color: "#16A34A" }]}>해결됐어요</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  s.actionBtn,
                  { borderColor: "#7C3AED", backgroundColor: "#F5F3FF", opacity: pressed || isRequestingHuman ? 0.7 : 1 },
                ]}
                onPress={handleRequestHuman}
                disabled={isRequestingHuman}
              >
                {isRequestingHuman
                  ? <ActivityIndicator size="small" color="#7C3AED" />
                  : <LucideIcon name="headphones" size={16} color="#7C3AED" />}
                <Text style={[s.actionBtnText, { color: "#7C3AED" }]}>직접 문의하기</Text>
              </Pressable>
            </View>
          )}

          {/* 해결 완료 표시 */}
          {isResolved && (
            <View style={s.resolvedBanner}>
              <LucideIcon name="check-circle-2" size={18} color="#16A34A" />
              <Text style={s.resolvedBannerText}>해결 완료 처리되었습니다.</Text>
              <Pressable onPress={handleNewCase}>
                <Text style={[s.resolvedBannerLink, { color: C.brandStrong }]}>새 문의하기</Text>
              </Pressable>
            </View>
          )}

          {/* 상담사 CTA (아직 안돼요 누른 후 / 이미 human 상태) */}
          {(showHumanCta || isHuman) && !isResolved && (
            <View style={s.humanCta}>
              <LucideIcon name="headphones" size={20} color="#7C3AED" />
              <Text style={[s.humanCtaTitle, { color: C.text }]}>상담사에게 문의하기</Text>
              <Text style={[s.humanCtaDesc, { color: C.textMuted }]}>
                {isHuman
                  ? "상담사가 확인 중입니다. 잠시 기다려주세요."
                  : "운영팀 상담사가 직접 답변해드립니다."}
              </Text>
              {!isHuman && (
                <Pressable
                  style={({ pressed }) => [
                    s.humanCtaBtn,
                    { backgroundColor: "#7C3AED", opacity: pressed || isRequestingHuman ? 0.7 : 1 },
                  ]}
                  onPress={handleRequestHuman}
                  disabled={isRequestingHuman}
                >
                  {isRequestingHuman
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={s.humanCtaBtnText}>상담사 연결 요청</Text>}
                </Pressable>
              )}
            </View>
          )}
        </ScrollView>

        {/* 에러 메시지 */}
        {error && (
          <View style={[s.errorBanner, { backgroundColor: "#FEF2F2" }]}>
            <LucideIcon name="alert-circle" size={14} color="#DC2626" />
            <Text style={s.errorText}>{error}</Text>
            <Pressable onPress={() => setError(null)}>
              <LucideIcon name="x" size={14} color="#DC2626" />
            </Pressable>
          </View>
        )}

        {/* 입력 영역 — 해결됐거나 human 상태면 숨김 */}
        {!isResolved && (
          <View style={[s.inputBar, { paddingBottom: insets.bottom + 8, borderTopColor: C.border, backgroundColor: C.card }]}>
            <TextInput
              style={[s.input, { backgroundColor: C.background, color: C.text, borderColor: C.border }]}
              placeholder="문의 내용을 입력하세요..."
              placeholderTextColor={C.textMuted}
              value={inputText}
              onChangeText={setInputText}
              multiline
              maxLength={1000}
              returnKeyType="default"
              editable={!isSending}
            />
            <Pressable
              style={({ pressed }) => [
                s.sendBtn,
                {
                  backgroundColor: inputText.trim() && !isSending ? C.brandStrong : C.border,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
              onPress={handleSend}
              disabled={!inputText.trim() || isSending}
            >
              {isSending
                ? <ActivityIndicator size="small" color="#fff" />
                : <LucideIcon name="send" size={18} color="#fff" />}
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:             { flex: 1 },
  center:           { flex: 1, alignItems: "center", justifyContent: "center" },

  // ── State badge
  stateBadgeRow:    { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  stateDot:         { width: 8, height: 8, borderRadius: 4 },
  stateText:        { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular" },
  newCaseLink:      {},
  newCaseLinkText:  { fontSize: 12, fontFamily: "Pretendard-Regular" },

  // ── Messages
  msgRow:           { flexDirection: "row", gap: 8, alignItems: "flex-end" },
  msgRowLeft:       { justifyContent: "flex-start" },
  msgRowRight:      { justifyContent: "flex-end" },
  avatarWrap:       { width: 28, height: 28, borderRadius: 14, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center", marginBottom: 2 },
  msgRoleLabel:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#6B7280", marginBottom: 3, marginLeft: 2 },
  msgRoleLabelRight:{ textAlign: "right", marginRight: 2 },
  bubble:           { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, maxWidth: "100%" },
  bubbleUser:       { backgroundColor: "#1B3A70", borderBottomRightRadius: 4 },
  bubbleOther:      { backgroundColor: "#F3F4F6", borderBottomLeftRadius: 4 },
  bubbleText:       { fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 20 },
  bubbleTextUser:   { color: "#FFFFFF" },
  bubbleTextOther:  { color: "#1F2937" },
  msgTime:          { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#9CA3AF", marginTop: 3, marginLeft: 2 },
  msgTimeRight:     { textAlign: "right", marginRight: 2 },

  // ── System message
  systemMsg:        { alignSelf: "center", backgroundColor: "#F9FAFB", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, maxWidth: "85%", borderWidth: 1, borderColor: "#E5E7EB" },
  systemMsgText:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#6B7280", textAlign: "center", lineHeight: 18 },

  // ── Empty
  emptyState:       { alignItems: "center", gap: 8, paddingTop: 40, paddingBottom: 20 },
  emptyText:        { fontSize: 14, fontFamily: "Pretendard-Regular", textAlign: "center" },

  // ── Action buttons (해결됐어요 / 아직 안돼요)
  actionRow:        { flexDirection: "row", gap: 10, paddingTop: 8 },
  actionBtn:        { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5 },
  actionBtnText:    { fontSize: 14, fontFamily: "Pretendard-Regular" },

  // ── Resolved banner
  resolvedBanner:   { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#F0FDF4", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#BBF7D0" },
  resolvedBannerText:{ flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: "#16A34A" },
  resolvedBannerLink:{ fontSize: 13, fontFamily: "Pretendard-Regular" },

  // ── Human CTA
  humanCta:         { backgroundColor: "#FAF5FF", borderRadius: 12, padding: 16, gap: 8, borderWidth: 1, borderColor: "#DDD6FE" },
  humanCtaTitle:    { fontSize: 15, fontFamily: "Pretendard-Regular", fontWeight: "600" },
  humanCtaDesc:     { fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 20 },
  humanCtaBtn:      { borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 4 },
  humanCtaBtnText:  { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#FFFFFF" },

  // ── Error
  errorBanner:      { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  errorText:        { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", color: "#DC2626" },

  // ── Input bar
  inputBar:         { flexDirection: "row", gap: 10, paddingHorizontal: 12, paddingTop: 10, borderTopWidth: 1 },
  input:            { flex: 1, minHeight: 42, maxHeight: 120, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, fontFamily: "Pretendard-Regular", borderWidth: 1 },
  sendBtn:          { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center", alignSelf: "flex-end" },
  refreshBtn:       { width: 36, height: 36, alignItems: "center", justifyContent: "center" },

  // ── New case / list view
  infoCard:         { borderRadius: 16, padding: 20, alignItems: "center", gap: 10 },
  infoIconWrap:     { width: 52, height: 52, borderRadius: 26, backgroundColor: "#EFF6FF", alignItems: "center", justifyContent: "center" },
  infoTitle:        { fontSize: 17, fontFamily: "Pretendard-Regular", fontWeight: "600" },
  infoDesc:         { fontSize: 14, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 22 },
  startBtn:         { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, paddingVertical: 14 },
  startBtnText:     { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#FFFFFF" },
  sectionTitle:     { fontSize: 12, fontFamily: "Pretendard-Regular", marginBottom: 6, marginTop: 4 },
  caseRow:          { flexDirection: "row", alignItems: "center", borderRadius: 12, padding: 14, marginBottom: 6 },
  caseRowState:     { fontSize: 13, fontFamily: "Pretendard-Regular" },
  caseRowDate:      { fontSize: 11, fontFamily: "Pretendard-Regular", marginTop: 2 },
});
