/**
 * (admin)/support-chat — AI 문의 진입점 (관리자)
 * 단일 SupportChatScreen 재사용. Normal/X 공통.
 */
import SupportChatScreen from "@/components/support/SupportChatScreen";

export default function AdminSupportChatScreen() {
  return (
    <SupportChatScreen supportContext={{ sourceRoute: "settings", featureId: "SUPPORT" }} />
  );
}
