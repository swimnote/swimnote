import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiRequest } from "@/context/AuthContext";
import { useAuth } from "@/context/AuthContext";

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
}

const ParentContext = createContext<ParentContextValue>({
  students: [],
  selectedStudent: null,
  setSelectedStudentId: () => {},
  loading: true,
  refresh: async () => {},
  reset: async () => {},
});

const STORAGE_KEY = "parent_selected_student_id";

export function ParentProvider({ children }: { children: React.ReactNode }) {
  const { token, kind } = useAuth();
  const [students, setStudents] = useState<ChildStudent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStudents = useCallback(async () => {
    if (!token || kind !== "parent") { setLoading(false); return; }
    try {
      const res = await apiRequest(token, "/parent/students");
      if (res.ok) {
        const data: ChildStudent[] = await res.json();
        setStudents(Array.isArray(data) ? data : []);
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
      setLoading(true);
    }
  }, [kind, fetchStudents]);

  const setSelectedStudentId = useCallback((id: string) => {
    setSelectedId(id);
    AsyncStorage.setItem(STORAGE_KEY, id).catch(() => {});
  }, []);

  const reset = useCallback(async () => {
    setStudents([]);
    setSelectedId(null);
    setLoading(true);
    try { await AsyncStorage.removeItem(STORAGE_KEY); } catch { }
  }, []);

  const selectedStudent = students.find(s => s.id === selectedId) ?? students[0] ?? null;

  return (
    <ParentContext.Provider value={{ students, selectedStudent, setSelectedStudentId, loading, refresh: fetchStudents, reset }}>
      {children}
    </ParentContext.Provider>
  );
}

export function useParent() {
  return useContext(ParentContext);
}
