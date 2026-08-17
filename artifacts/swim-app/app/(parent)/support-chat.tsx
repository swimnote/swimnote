/**
 * (parent)/support-chat — AI 문의 진입점 (학부모)
 * 단일 SupportChatScreen 재사용. Normal/X 공통.
 */
import SupportChatScreen from "@/components/support/SupportChatScreen";

export default function ParentSupportChatScreen() {
  return (
    <SupportChatScreen supportContext={{ sourceRoute: "more", featureId: "SUPPORT" }} />
  );
}
