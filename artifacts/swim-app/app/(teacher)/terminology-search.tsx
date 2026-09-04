/**
 * (teacher)/terminology-search.tsx
 * 선생님 진입 — 공통 TerminologySearchScreen 위임.
 */
import React from "react";
import { TerminologySearchScreen } from "@/components/terminology/TerminologySearchScreen";

export default function TeacherTerminologySearch() {
  return <TerminologySearchScreen role="teacher" />;
}
