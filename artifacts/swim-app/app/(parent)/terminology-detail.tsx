/**
 * (parent)/terminology-detail.tsx
 * 학부모 용어 상세 — 공통 TerminologyDetailScreen 위임.
 * params: { termId: string }
 */
import React from "react";
import { TerminologyDetailScreen } from "@/components/terminology/TerminologyDetailScreen";

export default function ParentTerminologyDetail() {
  return <TerminologyDetailScreen role="parent" />;
}
