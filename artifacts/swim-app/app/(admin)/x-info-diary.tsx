/**
 * x-info-diary — 선생님 AI 일지 작성
 */
import XInfoDetailPage from "@/components/admin/XInfoDetailPage";
import React from "react";

export default function XInfoDiaryScreen() {
  return (
    <XInfoDetailPage
      title="선생님 AI 일지 작성"
      icon="pen-line"
      tagline={"X모드에서는 AI 일지 작성이 가능합니다.\n직접 작성 기능은 그대로 유지됩니다."}
      sections={[
        {
          label: "무엇인가",
          body: "선생님이 수업 내용을 입력하면, AI가 일지 초안 작성을 지원합니다.\n\n선생님이 결과를 확인하고 수정한 후, 최종 저장은 선생님이 직접 수행합니다.",
        },
        {
          label: "왜 필요한가",
          body: "매 수업마다 일지를 처음부터 작성하는 부담을 줄이고, 지속적인 수업 기록을 유지하는 데 도움이 됩니다.",
        },
        {
          label: "수영장에 어떤 도움이 되는가",
          body: "꾸준한 수업 기록은 학부모에게 수업 과정을 전달하는 신뢰의 기반이 됩니다.\n\nAI 지원으로 선생님의 기록 부담을 줄이면서 일지 작성 빈도를 높일 수 있습니다.",
        },
      ]}
      noteText="일반 SWIMNOTE에서도 직접 일지 작성 기능은 계속 사용할 수 있습니다. AI 초안 작성은 X 전용 기능입니다."
    />
  );
}
