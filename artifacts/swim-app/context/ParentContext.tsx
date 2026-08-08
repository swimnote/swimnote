import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiRequest } from "@/context/AuthContext";
import { useAuth } from "@/context/AuthContext";
import { normalizeKoreanName } from "@/utils/validation";

export interface ChildStudent {
  id: string;
  name: string;
  birth_date?: string | null;
  class_group_id?: string | null;
  class_group?: {
    id?: string;
    name: string;
    schedule_days: string;
    schedule_time: string;
    instructor?: string | null;
  } | null;
}

interface ParentContextValue {
  students: ChildStudent[];
  selectedStudent: ChildStudent | null;
  setSelectedStudentId: (id: string) => void;
  loading: boolean;
  refresh: () => Promise<void>;
  reset: () => Promise<void>;
  unreadNotifCount: number;   // Teacher 업무대화 등 미읽음 알림 수
  refreshUnread: () => void;  // badge 즉시 갱신 트리거
}

const ParentContext = createContext<ParentContextValue>({
  students: [],
  selectedStudent: null,
  setSelectedStudentId: () => {},
  loading: true,
  refresh: async () => {},
  reset: async () => {},
  unreadNotifCount: 0,
  refreshUnread: () => {},
});

const STORAGE_KEY = "parent_selected_student_id";

export function ParentProvider({ children }: { children: React.ReactNode }) {
  const { token, kind } = useAuth();
  const [students, setStudents] = useState<ChildStudent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);

  // 미읽음 알림 수 fetch (GET /notifications/unread-count, _noCache:true)
  const fetchUnread = useCallback(async () => {
    if (!token || kind !== "parent") return;
    try {
      const res = await apiRequest(token, "/notifications/unread-count", { _noCache: true });
      if (res.ok) {
        const d = await res.json();
        setUnreadNotifCount(typeof d.count === "number" ? d.count : 0);
      }
    } catch {}
  }, [token, kind]);

  // ParentProvider는 항상 mount → 어느 화면에 있어도 polling 지속 (30초)
  useEffect(() => {
    if (kind !== "parent") { setUnreadNotifCount(0); return; }
    fetchUnread();
    const interval = setInterval(fetchUnread, 30_000);
    return () => clearInterval(interval);
  }, [kind, fetchUnread]);

  const fetchStudents = useCallback(async () => {
    if (!token || kind !== "parent") { setLoading(false); return; }
    try {
      const res = await apiRequest(token, "/parent/students");
      if (res.ok) {
        const raw: ChildStudent[] = await res.json();
        const data = Array.isArray(raw)
          ? raw.map(s => ({ ...s, name: normalizeKoreanName(s.name) }))
          : [];
        setStudents(data);
        const savedId = await AsyncStorage.getItem(STORAGE_KEY);
        const validId = savedId && data.find(s => s.id === savedId) ? savedId : (data[0]?.id ?? null);
        setSelectedId(validId);
      }
    } catch { }
    finally { setLoading(false); }
  }, [token, kind]);

  useEffect(() => {
    if (kind === "parent") {
      fetchStudents();
    } else if (!kind) {
      setStudents([]);
      setSelectedId(null);
      setLoading(false);
    }
  }, [kind, fetchStudents]);

  const setSelectedStudentId = useCallback((id: string) => {
    setSelectedId(id);
    AsyncStorage.setItem(STORAGE_KEY, id).catch(() => {});
  }, []);

  const reset = useCallback(async () => {
    setStudents([]);
    setSelectedId(null);
    setLoading(false);
    try { await AsyncStorage.removeItem(STORAGE_KEY); } catch { }
  }, []);

  const selectedStudent = students.find(s => s.id === selectedId) ?? students[0] ?? null;

  return (
    <ParentContext.Provider value={{
      students, selectedStudent, setSelectedStudentId, loading,
      refresh: fetchStudents, reset,
      unreadNotifCount, refreshUnread: fetchUnread,
    }}>
      {children}
    </ParentContext.Provider>
  );
}

export function useParent() {
  return useContext(ParentContext);
}
