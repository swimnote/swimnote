import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import Colors from "@/constants/colors";
import { apiRequest } from "@/context/AuthContext";

const C = Colors.light;

interface UnreadMessage {
  id: string; diary_id: string; sender_name: string; content: string;
  created_at: string; lesson_date: string; class_name: string;
}

interface ParentRequest {
  id: string; student_name: string; parent_name: string;
  request_type: string; content: string | null; status: string; created_at: string;
}

const REQUEST_TYPE_LABEL: Record<string, string> = {
  absence: "결석", makeup: "보강", postpone: "연기",
  withdrawal: "퇴원", counseling: "상담", inquiry: "문의",
};
const REQUEST_TYPE_COLOR: Record<string, string> = {
  absence: "#EF4444", makeup: "#3B82F6", postpone: "#F59E0B",
  withdrawal: "#6B7280", counseling: "#8B5CF6", inquiry: "#0EA5E9",
};

type ListItem =
  | { kind: "message"; data: UnreadMessage }
  | { kind: "request"; data: ParentRequest };

interface NewsNotification {
  id: string; type: string; title: string; body: string;
  ref_id: string | null; is_read: boolean; created_at: string;
  lesson_date?: string | null;
}

const NEWS_TYPES = new Set(["diary_like", "diary_thanks", "diary_comment", "growth_report_like", "growth_report_comment"]);

function newsIcon(type: string): { name: string; color: string } {
  if (type === "diary_like" || type === "growth_report_like") return { name: "heart", color: "#EF4444" };
  if (type === "diary_thanks") return { name: "star", color: "#F59E0B" };
  return { name: "message-circle", color: "#10B981" };
}

export default function UnreadMessagesModal({
  visible, token, themeColor, onClose, onOpenDiary, onMessagesRead, onNewsRead,
}: {
  visible: boolean; token: string | null; themeColor: string;
  onClose: () => void; onOpenDiary: (diaryId: string) => void;
  onMessagesRead?: () => void; onNewsRead?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [newsItems, setNewsItems] = useState<NewsNotification[]>([]);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);

    Promise.all([
      apiRequest(token, "/teacher/messages?unread=true").then(r => r.ok ? r.json() : []),
      apiRequest(token, "/teacher/parent-requests").then(r => {
        if (!r.ok) return [];
        return r.json().then((j: any) => Array.isArray(j) ? j : (j.data ?? []));
      }),
      apiRequest(token, "/teacher/news").then(r => r.ok ? r.json() : { news: [] }),
    ]).then(([msgs, reqs, newsResp]: [UnreadMessage[], ParentRequest[], any]) => {
      const msgItems: ListItem[] = (Array.isArray(msgs) ? msgs : []).map(m => ({ kind: "message", data: m }));
      const pendingReqs = (Array.isArray(reqs) ? reqs : []).filter(r => r.status === "pending");
      const reqItems: ListItem[] = pendingReqs.map(r => ({ kind: "request", data: r }));

      const merged = [
        ...msgItems,
        ...reqItems,
      ].sort((a, b) => new Date(b.data.created_at).getTime() - new Date(a.data.created_at).getTime());

      setItems(merged);

      // 소식: unread만 최신순 최대 3건
      const allNews: NewsNotification[] = Array.isArray(newsResp?.news) ? newsResp.news : [];
      const unreadNews = allNews
        .filter(n => NEWS_TYPES.has(n.type) && !n.is_read)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 3);
      setNewsItems(unreadNews);

      if (msgs.length > 0) {
        apiRequest(token, "/teacher/messages/read-all", { method: "POST" })
          .then(() => onMessagesRead?.())
          .catch(() => {});
      } else {
        onMessagesRead?.();
      }
    }).catch(() => { setItems([]); setNewsItems([]); }).finally(() => setLoading(false));
  }, [visible]);

  function fmtDate(s: string | null | undefined): string {
    if (!s) return "";
    const d = new Date(s);
    if (isNaN(d.getTime())) return "";
    return `${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`;
  }

  const totalCount = items.length;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={um.overlay} onPress={onClose} />
      <View style={[um.sheet, { paddingBottom: insets.bottom + 20 }]}>
        <View style={um.handle} />
        <View style={um.header}>
          <Text style={[um.title, { color: C.text }]}>쪽지 · 학부모 요청</Text>
          {totalCount > 0 && (
            <View style={[um.countBadge, { backgroundColor: C.error }]}>
              <Text style={um.countTxt}>{totalCount}</Text>
            </View>
          )}
          <Pressable onPress={onClose} style={um.closeBtn}>
            <LucideIcon name="x" size={18} color={C.textSecondary} />
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator color={themeColor} style={{ marginTop: 30 }} />
        ) : items.length === 0 ? (
          <View style={um.empty}>
            <LucideIcon name="mail" size={36} color={C.textMuted} />
            <Text style={[um.emptyTxt, { color: C.textMuted }]}>새 쪽지 · 요청이 없습니다</Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false}>
            {items.map((item, _idx) => {
              if (item.kind === "message") {
                const msg = item.data;
                return (
                  <Pressable key={`msg-${msg.id}`} style={[um.item, { borderBottomColor: C.border }]}
                    onPress={() => {
                      onClose();
                      requestAnimationFrame(() => {
                        router.push(`/(teacher)/messages-inbox?diaryId=${msg.diary_id}` as any);
                      });
                    }}>
                    <View style={[um.iconBox, { backgroundColor: themeColor + "18" }]}>
                      <LucideIcon name="mail" size={16} color={themeColor} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <View style={um.rowBetween}>
                        <Text style={[um.itemName, { color: C.text }]}>{msg.sender_name}</Text>
                        <Text style={[um.itemMeta, { color: C.textMuted }]}>{fmtDate(msg.created_at)}</Text>
                      </View>
                      <Text style={[um.itemContent, { color: C.textSecondary }]} numberOfLines={1}>{msg.content}</Text>
                      <Text style={[um.itemMeta, { color: C.textMuted }]}>{msg.class_name}</Text>
                    </View>
                    <LucideIcon name="chevron-right" size={16} color={C.textMuted} />
                  </Pressable>
                );
              } else {
                const req = item.data;
                const typeColor = REQUEST_TYPE_COLOR[req.request_type] ?? "#6B7280";
                const typeLabel = REQUEST_TYPE_LABEL[req.request_type] ?? req.request_type;
                return (
                  <Pressable key={`req-${req.id}`} style={[um.item, { borderBottomColor: C.border }]}
                    onPress={() => {
                      onClose();
                      requestAnimationFrame(() => {
                        router.push({
                          pathname: "/(teacher)/messages-inbox",
                          params: { tab: "requests", requestId: req.id },
                        } as any);
                      });
                    }}>
                    <View style={[um.iconBox, { backgroundColor: typeColor + "18" }]}>
                      <LucideIcon name="clipboard-list" size={16} color={typeColor} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <View style={um.rowBetween}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={[um.itemName, { color: C.text }]}>{req.student_name}</Text>
                          <View style={[um.typeBadge, { backgroundColor: typeColor + "18" }]}>
                            <Text style={[um.typeTxt, { color: typeColor }]}>{typeLabel}</Text>
                          </View>
                        </View>
                        <Text style={[um.itemMeta, { color: C.textMuted }]}>{fmtDate(req.created_at)}</Text>
                      </View>
                      <Text style={[um.itemContent, { color: C.textSecondary }]} numberOfLines={1}>
                        {req.parent_name} · {req.content ?? "내용 없음"}
                      </Text>
                    </View>
                    <LucideIcon name="chevron-right" size={16} color={C.textMuted} />
                  </Pressable>
                );
              }
            })}
          </ScrollView>
        )}

        {/* 새 소식 영역 */}
        {!loading && newsItems.length > 0 && (
          <View style={um.newsSection}>
            <Text style={[um.newsSectionTitle, { color: C.textSecondary }]}>새 소식</Text>
            {newsItems.map(n => {
              const ic = newsIcon(n.type);
              return (
                <Pressable key={`news-${n.id}`} style={[um.newsRow, { borderBottomColor: C.border }]}
                  onPress={() => {
                    // 해당 알림만 읽음 처리
                    setNewsItems(prev => prev.filter(x => x.id !== n.id));
                    apiRequest(token, `/notifications/${n.id}/read`, { method: "POST" })
                      .then(() => onNewsRead?.())
                      .catch(() => {});
                    onClose();
                    requestAnimationFrame(() => {
                      if (n.type === "growth_report_like" || n.type === "growth_report_comment") {
                        router.navigate({
                          pathname: "/(teacher)/growth-report-reactions",
                          params: { reportId: n.ref_id ?? "", source: "news_inbox" },
                        } as any);
                      } else {
                        router.navigate({
                          pathname: "/(teacher)/diary-reactions",
                          params: { diaryId: n.ref_id ?? "", lessonDate: n.lesson_date ?? "", source: "news_inbox" },
                        } as any);
                      }
                    });
                  }}>
                  <View style={[um.newsIconBox, { backgroundColor: ic.color + "18" }]}>
                    <LucideIcon name={ic.name as any} size={14} color={ic.color} />
                  </View>
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text style={[um.newsTitle, { color: C.text }]} numberOfLines={1}>{n.title}</Text>
                    <Text style={[um.newsBody, { color: C.textSecondary }]} numberOfLines={1}>{n.body}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* 알림함 전체보기 — 항상 표시 */}
        {!loading && (
          <Pressable
            style={um.inboxBtn}
            onPress={() => {
              onClose();
              requestAnimationFrame(() => {
                router.push("/(teacher)/messages-inbox" as any);
              });
            }}
          >
            <LucideIcon name="inbox" size={15} color={C.text} />
            <Text style={[um.inboxBtnTxt, { color: C.text }]}>알림함 전체보기</Text>
          </Pressable>
        )}
      </View>
    </Modal>
  );
}

const um = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet:      { backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "60%" },
  handle:     { width: 36, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: "center", marginTop: 12, marginBottom: 4 },
  header:     { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingBottom: 12 },
  title:      { fontSize: 17, fontFamily: "Pretendard-Regular", flex: 1 },
  countBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  countTxt:   { color: "#fff", fontSize: 12, fontFamily: "Pretendard-Regular" },
  closeBtn:   { width: 32, height: 32, borderRadius: 10, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" },
  empty:      { alignItems: "center", gap: 10, paddingVertical: 40 },
  emptyTxt:   { fontSize: 14, fontFamily: "Pretendard-Regular" },
  item:       { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1 },
  iconBox:    { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  itemName:   { fontSize: 14, fontFamily: "Pretendard-Regular" },
  itemContent:{ fontSize: 13, fontFamily: "Pretendard-Regular" },
  itemMeta:   { fontSize: 12, fontFamily: "Pretendard-Regular" },
  typeBadge:  { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  typeTxt:    { fontSize: 11, fontFamily: "Pretendard-Regular" },
  inboxBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginHorizontal: 20, marginTop: 8, marginBottom: 4, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: "#F9FAFB" },
  inboxBtnTxt:   { fontSize: 14, fontFamily: "Pretendard-Regular", fontWeight: "600" },
  newsSection:      { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8 },
  newsSectionTitle: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#6B7280", paddingHorizontal: 20, paddingBottom: 4 },
  newsRow:          { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  newsIconBox:      { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  newsTitle:        { fontSize: 13, fontFamily: "Pretendard-Regular" },
  newsBody:         { fontSize: 12, fontFamily: "Pretendard-Regular" },
});
