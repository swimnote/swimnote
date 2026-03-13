import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

interface Class { id: string; name: string; }
interface Member { id: string; name: string; phone: string; class_id?: string | null; }
interface AttRecord { member_id: string; member_name: string; status: "present" | "absent" | "late"; }

const STATUS_CONFIG = {
  present: { label: "출석", color: Colors.light.present, bg: "#D1FAE5", icon: "check-circle" as const },
  absent: { label: "결석", color: Colors.light.absent, bg: "#FEE2E2", icon: "x-circle" as const },
  late: { label: "지각", color: Colors.light.late, bg: "#FEF3C7", icon: "clock" as const },
};

type AttStatus = "present" | "absent" | "late";

export default function AttendanceScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const C = Colors.light;
  const [classes, setClasses] = useState<Class[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [attendance, setAttendance] = useState<Record<string, AttStatus>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetchInit();
  }, []);

  useEffect(() => {
    if (selectedClass) fetchAttendance(selectedClass, date);
  }, [selectedClass, date]);

  async function fetchInit() {
    try {
      const [cr, mr] = await Promise.all([apiRequest(token, "/classes"), apiRequest(token, "/members")]);
      const [cls, mbs] = await Promise.all([cr.json(), mr.json()]);
      setClasses(Array.isArray(cls) ? cls : []);
      setMembers(Array.isArray(mbs) ? mbs : []);
      if (Array.isArray(cls) && cls.length > 0) setSelectedClass(cls[0].id);
    } finally { setLoading(false); }
  }

  async function fetchAttendance(classId: string, d: string) {
    try {
      const res = await apiRequest(token, `/attendance?class_id=${classId}&date=${d}`);
      const data: AttRecord[] = await res.json();
      const map: Record<string, AttStatus> = {};
      if (Array.isArray(data)) data.forEach(r => { map[r.member_id] = r.status; });
      setAttendance(map);
    } catch (err) { console.error(err); }
  }

  async function markAttendance(memberId: string, status: AttStatus) {
    if (!selectedClass) return;
    setSaving(memberId);
    try {
      await apiRequest(token, "/attendance", {
        method: "POST",
        body: JSON.stringify({ class_id: selectedClass, member_id: memberId, date, status }),
      });
      setAttendance(prev => ({ ...prev, [memberId]: status }));
    } finally { setSaving(null); }
  }

  const classMembers = members.filter(m => m.class_id === selectedClass);

  const dateOptions = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    return d.toISOString().split("T")[0];
  });

  function formatDate(d: string) {
    const dt = new Date(d);
    const days = ["일", "월", "화", "수", "목", "금", "토"];
    return `${dt.getMonth() + 1}/${dt.getDate()} (${days[dt.getDay()]})`;
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <Text style={[styles.title, { color: C.text }]}>출결 관리</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingBottom: 8 }}>
        {classes.map((c) => (
          <Pressable
            key={c.id}
            style={[styles.classTab, { backgroundColor: selectedClass === c.id ? C.tint : C.card, borderColor: selectedClass === c.id ? C.tint : C.border }]}
            onPress={() => setSelectedClass(c.id)}
          >
            <Text style={[styles.classTabText, { color: selectedClass === c.id ? "#fff" : C.textSecondary }]}>{c.name}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingBottom: 8 }}>
        {dateOptions.map((d) => (
          <Pressable
            key={d}
            style={[styles.dateTab, { backgroundColor: date === d ? C.tintLight : C.card, borderColor: date === d ? C.tint : C.border }]}
            onPress={() => setDate(d)}
          >
            <Text style={[styles.dateTabText, { color: date === d ? C.tint : C.textSecondary }]}>{formatDate(d)}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={classMembers}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, paddingTop: 8, gap: 10 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="users" size={40} color={C.textMuted} />
              <Text style={[styles.emptyText, { color: C.textMuted }]}>
                {classes.length === 0 ? "등록된 반이 없습니다" : "반에 배정된 회원이 없습니다"}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const status = attendance[item.id];
            return (
              <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.shadow }]}>
                <View style={[styles.avatar, { backgroundColor: C.tintLight }]}>
                  <Text style={[styles.avatarText, { color: C.tint }]}>{item.name[0]}</Text>
                </View>
                <View style={styles.memberInfo}>
                  <Text style={[styles.memberName, { color: C.text }]}>{item.name}</Text>
                  {status ? (
                    <View style={[styles.statusBadge, { backgroundColor: STATUS_CONFIG[status].bg }]}>
                      <Feather name={STATUS_CONFIG[status].icon} size={12} color={STATUS_CONFIG[status].color} />
                      <Text style={[styles.statusText, { color: STATUS_CONFIG[status].color }]}>{STATUS_CONFIG[status].label}</Text>
                    </View>
                  ) : (
                    <Text style={[styles.noStatus, { color: C.textMuted }]}>미체크</Text>
                  )}
                </View>
                <View style={styles.attBtns}>
                  {(["present", "late", "absent"] as AttStatus[]).map((s) => (
                    <Pressable
                      key={s}
                      style={[styles.attBtn, {
                        backgroundColor: status === s ? STATUS_CONFIG[s].bg : C.background,
                        borderColor: status === s ? STATUS_CONFIG[s].color : C.border,
                      }]}
                      onPress={() => markAttendance(item.id, s)}
                      disabled={saving === item.id}
                    >
                      {saving === item.id ? <ActivityIndicator size="small" color={C.tint} /> : (
                        <Feather name={STATUS_CONFIG[s].icon} size={16} color={status === s ? STATUS_CONFIG[s].color : C.textMuted} />
                      )}
                    </Pressable>
                  ))}
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  classTab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5 },
  classTabText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  dateTab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5 },
  dateTabText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  card: { flexDirection: "row", alignItems: "center", borderRadius: 14, padding: 14, gap: 12, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2 },
  avatar: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  memberInfo: { flex: 1, gap: 4 },
  memberName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  noStatus: { fontSize: 12, fontFamily: "Inter_400Regular" },
  attBtns: { flexDirection: "row", gap: 8 },
  attBtn: { width: 36, height: 36, borderRadius: 10, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  emptyText: { fontSize: 15, fontFamily: "Inter_400Regular" },
});
