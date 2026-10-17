import { api } from "@/lib/api-client";
import type { Student } from "./MembersPage";

/** The existing canonical list query, shared by Web, Desktop and read-only Actions. */
export const memberQuery = {
  queryKey: ["students"],
  queryFn: ({ signal }: { signal: AbortSignal }) => api.get<Student[]>("/students?pool_all=true", { signal }),
  staleTime: 30_000,
};
export type MemberFilters = { search: string; status: string; classId: string };
export type MemberSummary = Pick<Student, "id" | "name" | "phone" | "status" | "class_group_id" | "class_group_name">;
export function filterMembers<T extends MemberSummary>(students: T[], filters: MemberFilters): T[] {
  const q = filters.search.trim().toLowerCase();
  return students.filter(s => {
    if (filters.status && s.status !== filters.status) return false;
    if (filters.classId && s.class_group_id !== filters.classId && s.class_group_name !== filters.classId) return false;
    return !q || s.name.toLowerCase().includes(q) || (s.phone ?? "").replace(/-/g, "").includes(q.replace(/-/g, ""));
  });
}
