---
name: 월간 UNKNOWN 상태 경계
description: 월간 미해결 UNKNOWN과 이전 분석 성공 표시를 구분하는 제품 계약
---

월간 UNKNOWN blocker와 보고서의 기존 분석 성공 표시는 서로 다른 의미다. 이전 분석 단계의 COMPLETE 계열 표시만으로 현재 월간 UNKNOWN이 정상 귀결되었다고 판단하지 않는다.

**Why:** 재분석 결과가 미확정인 보고서에도 이전 분석 성공 표시가 남을 수 있다. 사용자는 월간 cycle의 현재 미해결 UNKNOWN과 기존 서버의 operator-approved reissue 계약을 승인 판정 기준으로 지정했다.

**How to apply:** 월간 예외 및 승인 화면은 서버가 판정한 현재 UNKNOWN과 승인 가능 여부를 함께 사용한다. Payload/identity가 없거나 서버가 불허한 대상은 클라이언트 추론으로 허용하지 않는다. 정상 귀결·발송 완료·완료된 operation은 계속 보호한다.

첫 분석의 실패 이력도 현재 월간 UNKNOWN과 구분한다. 승인된 일반 실패 복구가 나중에 UNKNOWN이 될 수 있으며, 첫 분석 이력 자체를 새 결과로 덮어쓰지는 않는다.

**Why:** 최초 분석 이력을 현재 상태로 오인하면, 정당하게 승인된 복구에서 발생한 새 UNKNOWN이 다음 명시적 승인 대상에서 영구적으로 숨겨질 수 있다.

**How to apply:** 현재 uncertainty와 모든 identity/seal/policy 조건을 유지하면서, 역사적 실패에서 넘어온 UNKNOWN에는 기록된 복구 승인 증거를 요구한다. 실패 이력만으로 허용하거나 클라이언트에서 승인 증거를 추정하지 않는다.