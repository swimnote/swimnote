import { useLocation } from "wouter";
import SuperPoolsPage from "./SuperPoolsPage";

// 운영자 관리 = 수영장 목록과 동일 (pools-summary API)
// 승인 대기 필터로 진입
export default function SuperOperatorsPage() {
  return <SuperPoolsPage />;
}
