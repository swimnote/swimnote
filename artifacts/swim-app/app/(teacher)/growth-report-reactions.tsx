/**
 * (teacher)/growth-report-reactions.tsx
 * 선생님이 Growth Report 1개에 달린 학부모 반응(좋아요)과
 * 댓글 스레드를 read-only로 확인하는 화면 (PHASE 3-A)
 *
 * 댓글 작성 / Teacher reply → PHASE 3-B 이후 구현
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";
import { parseDateSafe } from "@/domain/formatters";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const C = Colors.light;

type ParentEntry = {
  parent_id: string;
  parent_name: string;
  student_name: string | null;
};

type Reply = {
  id: string;
  body: string;
  author_name: string;
  author_role: string;
  is_deleted: boolean;
  created_at: string;
};

type Thread = {
  id: string;
  body: string;
  author_name: string;
  author_role: string;
  student_name: string | null;
  display_name: string;
  is_deleted: boolean;
  created_at: string;
  replies: Reply[];
};

function fmtTime(iso: string) {
  if (!iso) return "";
  const d = parseDateSafe(iso);
  if (!d) return "";
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

export default function GrowthReportReactionsScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const { reportId, source } = useLocalSearchParams<{ reportId: string; source?: string }>();

  const handleBack = useCallback(() => {
    if (source === "news_inbox") {
      router.navigate("/(teacher)/messages-inbox" as any);
    } else {
      router.back();
    }
  }, [source]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [likeParents, setLikeParents] = useState<ParentEntry[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [subtitle, setSubtitle] = useState("AI 성장 리포트");

  const load = useCallback(async (silent = false) => {
    if (!reportId) return;
    if (!silent) setLoading(true);
    try {
      const r = await apiRequest(token, `/teacher/growth-reports/${reportId}/interactions`);
      if (r.ok) {
        const d = await r.json();
        const like = d.reactions?.like ?? { count: 0, parents: [] };
        setLikeCount(like.count ?? 0);
        setLikeParents(like.parents ?? []);
        setThreads(d.threads ?? []);
        // 기간 정보가 응답에 포함된 경우 subtitle 업데이트
        if (d.report_period) {
          setSubtitle(`AI 성장 리포트 · ${d.report_period}`);
        } else if (d.year && d.month) {
          setSubtitle(`AI 성장 리포트 · ${d.year}년 ${d.month}월`);
        }
      }
    } catch { }
    setLoading(false);
    setRefreshing(false);
  }, [token, reportId]);

  useEffect(() => { load(); }, [load]);

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <SubScreenHeader
        title="반응 & 댓글"
        subtitle={subtitle}
        onBack={handleBack}
      />

      {loading ? (
        <ActivityIndicator color={C.brandStrong} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(true); }}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          {/* ─── 반응 섹션 ─── */}
          <View style={[s.section, { backgroundColor: C.card }]}>
            <Text style={[s.sectionTitle, { color: C.text }]}>학부모 반응</Text>
            <View style={[s.reactionCard, { borderColor: "#EF444420" }]}>
              <LucideIcon name="heart" size={22} color="#EF4444" />
              <Text style={[s.reactionCount, { color: "#EF4444" }]}>{likeCount}명</Text>
              {likeParents.length > 0 && (
                <Text style={[s.reactionNames, { color: C.textSecondary }]} numberOfLines={3}>
                  {likeParents
                    .map(p => p.student_name ? `${p.parent_name}(${p.student_name})` : p.parent_name)
                    .join(", ")}
                </Text>
              )}
            </View>
          </View>

          {/* ─── 댓글 섹션 (read-only) ─── */}
          <View style={[s.section, { backgroundColor: C.card }]}>
            <View style={s.sectionHeaderRow}>
              <Text style={[s.sectionTitle, { color: C.text }]}>댓글</Text>
              <Text style={[s.commentCountBadge, { color: C.brandStrong }]}>{threads.length}개</Text>
            </View>

            {threads.length === 0 ? (
              <View style={s.emptyComments}>
                <LucideIcon name="message-circle" size={32} color={C.textMuted} />
                <Text style={[s.emptyText, { color: C.textMuted }]}>아직 댓글이 없습니다</Text>
              </View>
            ) : (
              threads.map(thread => (
                <View key={thread.id} style={s.threadWrap}>
                  {/* 학부모 원댓글 */}
                  <View style={[s.bubble, s.bubbleParent]}>
                    <View style={s.bubbleHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.bubbleName, { color: C.brandStrong }]}>
                          {thread.display_name}
                          {thread.student_name ? (
                            <Text style={[s.bubbleStudentTag, { color: C.textMuted }]}>
                              {"  "}{thread.student_name}
                            </Text>
                          ) : null}
                        </Text>
                        <Text style={[s.bubbleTime, { color: C.textMuted }]}>{fmtTime(thread.created_at)}</Text>
                      </View>
                    </View>
                    <Text style={[s.bubbleBody, { color: thread.is_deleted ? C.textMuted : C.text }]}>
                      {thread.body}
                    </Text>
                  </View>

                  {/* 답글들 */}
                  {thread.replies.map(reply => (
                    <View
                      key={reply.id}
                      style={[
                        s.bubble,
                        s.bubbleReply,
                        reply.author_role === "teacher" || reply.author_role === "pool_admin"
                          ? { backgroundColor: C.backgroundSoft }
                          : { backgroundColor: C.brandSoft },
                      ]}
                    >
                      <View style={s.bubbleHeader}>
                        <Text style={[s.bubbleName, {
                          color: reply.author_role === "teacher" || reply.author_role === "pool_admin"
                            ? C.textPrimary : C.brandStrong,
                        }]}>
                          {reply.author_role === "teacher" || reply.author_role === "pool_admin" ? "📘 " : ""}
                          {reply.author_name}
                        </Text>
                        <Text style={[s.bubbleTime, { color: C.textMuted }]}>{fmtTime(reply.created_at)}</Text>
                      </View>
                      <Text style={[s.bubbleBody, { color: reply.is_deleted ? C.textMuted : C.text }]}>
                        {reply.body}
                      </Text>
                    </View>
                  ))}
                </View>
              ))
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  section: { marginHorizontal: 12, marginTop: 12, borderRadius: 14, padding: 14, gap: 10 },
  sectionTitle: { fontSize: 14, fontFamily: "Pretendard-Regular", fontWeight: "600" },
  sectionHeaderRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  commentCountBadge: { fontSize: 13, fontFamily: "Pretendard-Regular" },

  reactionCard: { borderWidth: 1.5, borderRadius: 12, padding: 12, alignItems: "center", gap: 4 },
  reactionCount: { fontSize: 16, fontFamily: "Pretendard-Regular", fontWeight: "700" },
  reactionNames: { fontSize: 11, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 16 },

  emptyComments: { alignItems: "center", paddingVertical: 28, gap: 10 },
  emptyText: { fontSize: 13, fontFamily: "Pretendard-Regular" },

  threadWrap: { gap: 4 },
  bubble: { borderRadius: 12, padding: 12, gap: 6 },
  bubbleParent: { backgroundColor: C.backgroundSoft },
  bubbleReply: { marginLeft: 20 },
  bubbleHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  bubbleName: { fontSize: 13, fontFamily: "Pretendard-Regular", fontWeight: "600" },
  bubbleStudentTag: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  bubbleTime: { fontSize: 11, fontFamily: "Pretendard-Regular", marginTop: 1 },
  bubbleBody: { fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 20 },
});
