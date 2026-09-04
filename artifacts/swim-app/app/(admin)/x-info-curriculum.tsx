/**
 * x-info-curriculum — 우리 수영장 커리큘럼 검색
 */
import XInfoDetailPage from "@/components/admin/XInfoDetailPage";
import React from "react";

export default function XInfoCurriculumScreen() {
  return (
    <XInfoDetailPage
      title="우리 수영장 커리큘럼 검색"
      icon="search"
      tagline={"우리 수영장의 교육과정을 기반으로\n검색하고 활용할 수 있습니다."}
      sections={[
        {
          label: "무엇인가",
          body: "X모드에서는 각 수영장의 실제 교육과정을 별도로 제작/연결하고, 이를 기반으로 커리큘럼 검색 및 AI 기능을 사용할 수 있습니다.\n\n일반 SWIMNOTE에는 수영장별 커리큘럼 제작/연결 서비스가 포함되지 않습니다.",
        },
        {
          label: "왜 필요한가",
          body: "수영장마다 교육 방식과 레벨 기준이 다릅니다. 우리 수영장의 실제 교육과정이 연결되어야 AI 기능이 의미 있는 결과를 제공할 수 있습니다.",
        },
        {
          label: "수영장에 어떤 도움이 되는가",
          body: "우리 수영장의 교육과정을 기반으로 커리큘럼 관련 내용을 검색하고, 학부모 질문에 답하거나 수업 계획에 활용할 수 있습니다.",
        },
      ]}
      noteText="커리큘럼 연결은 X모드 설정 단계에서 별도로 진행됩니다."
    />
  );
}
