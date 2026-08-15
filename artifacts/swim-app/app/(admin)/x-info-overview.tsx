/**
 * x-info-overview — X모드 설명
 * 일반 SWIMNOTE와 SWIMNOTE X의 차이를 설명한다.
 */
import XInfoDetailPage from "@/components/admin/XInfoDetailPage";
import React from "react";

export default function XInfoOverviewScreen() {
  return (
    <XInfoDetailPage
      title="X모드 설명"
      icon="layers"
      tagline={"일반 SWIMNOTE만으로도 수영장 운영에 필요한\n기본 기능을 충분히 사용할 수 있습니다.\nSWIMNOTE X는 여기에 더해지는 별도 서비스입니다."}
      sections={[
        {
          label: "일반 SWIMNOTE",
          body: "회원 관리, 학생/반 관리, 수업, 출결, 일정, 일지, 사진/앨범, 공지, 알림, 메시지 등 수영장 운영에 필요한 기본 기능을 제공합니다.",
        },
        {
          label: "SWIMNOTE X — 무엇인가",
          body: "일반 SWIMNOTE 위에 SWIMNOTE AI ENGINE, 수영장별 커리큘럼 제작/연결, AI 기반 일지 작성 지원, 학부모 AI 기능이 추가되는 별도 서비스입니다.",
        },
        {
          label: "왜 별도 서비스인가",
          body: "일반 SWIMNOTE는 앱 운영과 데이터 관리를 위한 서비스입니다.\n\nSWIMNOTE X는 SWIMNOTE AI ENGINE을 사용하고, AI 처리 비용이 지속적으로 발생하며, 수영장별 커리큘럼을 별도로 제작/연결해야 합니다.\n\n이 때문에 별도 정기결제로 제공됩니다.",
        },
        {
          label: "수영장에 어떤 도움이 되는가",
          body: "수업 기록 작성 부담을 줄이고, 학부모에게 아이의 성장과 수업 진행 상황을 더 풍부하게 전달할 수 있습니다.",
        },
      ]}
    />
  );
}
