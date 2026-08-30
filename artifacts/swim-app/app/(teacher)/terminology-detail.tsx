/**
 * (teacher)/terminology-detail.tsx
 * 선생님 용어 상세 — 공통 TerminologyDetailScreen 위임.
 * params: { termId: string }
 */
import React from "react";
import { TerminologyDetailScreen } from "@/components/terminology/TerminologyDetailScreen";

export default function TeacherTerminologyDetail() {
  return <TerminologyDetailScreen role="teacher" />;
}
