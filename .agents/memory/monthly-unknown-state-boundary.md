---
name: 월간 UNKNOWN 상태 경계
description: 월간 미해결 UNKNOWN과 이전 분석 성공 표시를 구분하는 제품 계약
---

월간 UNKNOWN blocker와 보고서의 기존 분석 성공 표시는 서로 다른 의미다. 이전 분석 단계의 COMPLETE 계열 표시만으로 현재 월간 UNKNOWN이 정상 귀결되었다고 판단하지 않는다.

**Why:** 재분석 결과가 미확정인 보고서에도 이전 분석 성공 표시가 남을 수 있다. 사용자는 월간 cycle의 현재 미해결 UNKNOWN과 기존 서버의 operator-approved reissue 계약을 승인 판정 기준으로 지정했다.

**How to apply:** 월간 예외 및 승인 화면은 서버가 판정한 현재 UNKNOWN과 승인 가능 여부를 함께 사용한다. Payload/identity가 없거나 서버가 불허한 대상은 클라이언트 추론으로 허용하지 않는다. 정상 귀결·발송 완료·완료된 operation은 계속 보호한다.