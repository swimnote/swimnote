/**
 * (parent)/terminology-search.tsx
 * 학부모 진입 — 공통 TerminologySearchScreen 위임.
 */
import React from "react";
import { TerminologySearchScreen } from "@/components/terminology/TerminologySearchScreen";

export default function ParentTerminologySearch() {
  return <TerminologySearchScreen role="parent" />;
}
