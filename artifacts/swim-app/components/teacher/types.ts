/**
 * components/teacher/types.ts
 * 선생님 모드 공통 타입 허브
 * (WeeklySchedule.tsx에서 분리 — UI와 타입 역할 분리)
 */

export interface TeacherClassGroup {
  id: string;
  name: string;
  schedule_days: string;
  schedule_time: string;
  student_count: number;
  capacity?: number | null;
  level?: string | null;
  instructor?: string | null;
  color?: string | null;
}

export interface SlotStatus {
  attChecked: number;
  diaryDone:  boolean;
  hasPhotos:  boolean;
}

export interface DayBarProps {
  classGroups: TeacherClassGroup[];
  selectedDay: string;
  onDayChange: (day: string) => void;
  themeColor: string;
}
