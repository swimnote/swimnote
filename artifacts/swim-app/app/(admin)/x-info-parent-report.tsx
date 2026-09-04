/**
 * x-info-parent-report — 무료 학부모 리포트 지원
 */
import XInfoDetailPage from "@/components/admin/XInfoDetailPage";
import React from "react";

export default function XInfoParentReportScreen() {
  return (
    <XInfoDetailPage
      title="무료 학부모 리포트 지원"
      icon="bar-chart-2"
      tagline={"아이의 수업 진행 상황과 성장 흐름을\n학부모에게 전달하는 기능입니다."}
      sections={[
        {
          label: "무엇인가",
          body: "X모드 운영처에서 학부모 앱을 통해 아이의 수업 현황과 성장 흐름을 제공하는 추가 서비스입니다.",
        },
        {
          label: "왜 필요한가",
          body: "학부모가 아이의 수업이 어떻게 진행되고 있는지 직접 확인할 수 있으면, 수영장 신뢰도와 재등록률 향상에 도움이 됩니다.",
        },
        {
          label: "수영장에 어떤 도움이 되는가",
          body: "별도 연락 없이도 학부모가 앱에서 아이의 성장 현황을 확인할 수 있어, 수업 가치를 자연스럽게 전달할 수 있습니다.",
        },
      ]}
      noteText="실제 제공되는 리포트 내용과 조건은 X모드 운영 정책에 따릅니다."
    />
  );
}
