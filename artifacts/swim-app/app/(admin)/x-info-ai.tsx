/**
 * x-info-ai — AI에 대한 설명
 */
import XInfoDetailPage from "@/components/admin/XInfoDetailPage";
import React from "react";

export default function XInfoAiScreen() {
  return (
    <XInfoDetailPage
      title="AI에 대한 설명"
      icon="cpu"
      tagline={"SWIMNOTE X의 AI는 단순한 대화형 AI가 아닙니다.\n수업 데이터와 수영 교육 데이터,\n수영장별 커리큘럼이 연결됩니다."}
      sections={[
        {
          label: "무엇인가",
          body: "SWIMNOTE AI ENGINE은 수업 데이터, 수영 교육 데이터, 수영장별 커리큘럼을 연결하여 X 기능에 활용합니다.\n\n일반적인 대화형 AI를 그대로 붙이는 방식이 아닙니다.",
        },
        {
          label: "왜 필요한가",
          body: "수영 교육에 특화된 데이터 없이는 의미 있는 일지 초안이나 커리큘럼 검색이 어렵습니다.\n\nSWIMNOTE AI ENGINE은 이 데이터를 기반으로 동작합니다.",
        },
        {
          label: "수영장에 어떤 도움이 되는가",
          body: "수업 데이터를 기반으로 AI 기능을 활용하여 일지 작성, 학부모 리포트, 커리큘럼 검색 등을 더 효율적으로 처리할 수 있습니다.",
        },
      ]}
      noteText="AI 기능의 결과는 참고 자료로 활용하며, 최종 확인과 저장은 선생님이 직접 수행합니다."
    />
  );
}
