---
name: SWIMNOTE OFFICE 제품 경계
description: 사용자가 정한 OFFICE의 공유 데이터, AI 작업창, Desktop 및 확장 원칙
---

OFFICE는 기존 APP·PC Dashboard·API·데이터를 공유하는 확장 제품이다. 이미 구현된 PC 화면을 이유 없이 복제하거나 운영 데이터 저장소를 별도로 만들지 않는다.

**Why:** 사용자가 2026-10-15 제공한 OFFICE Master Blueprint와 조사 지시문에서 동일 업무 의미와 기존 디자인 재사용을 절대 전제로 지정했다.

**How to apply:** 신규 구현 전에 실제 화면·API의 재사용 범위를 확인한다. 업종중립 Core는 기존 수영장 데이터 위에 Adapter로 도입하는 방향을 검토하며, 기존 테이블 일괄 개명을 전제하지 않는다.

OFFICE의 주 인터페이스는 AI 작업창이다. 모든 업무 기능은 메뉴와 AI가 동일한 Action·권한·검증을 사용해야 한다(Zero Orphan Feature). AI는 대상을 확인하고 계획을 제안하며 DB를 직접 변경하거나 실제 사용자 권한을 높이지 않는다.

**Why:** 사용자는 “일반 메뉴에서는 가능한데 AI 작업창에서는 불가능한 기능”을 허용하지 않으며, 거대한 AI 플랫폼 선행 개발이나 모든 화면 완성 뒤 AI 추가도 금지했다.

**How to apply:** 기존 업무부터 작은 Action wrapper와 Query Action으로 연결한다. 명확한 전화번호/ID 조회는 모델 없는 FAST PATH로 처리하고, 고위험 업무는 Preview·승인·Audit·멱등성을 함께 설계한다.

Windows 10/11 x64 설치형이 우선 목표다. 최소 Desktop Foundation과 전체 OFFICE는 별도 견적·검수 범위를 가진다. 향후 결제단말·프린터·파일·마이크·Kiosk·Dispatch 연동을 막지 않는 Shell 경계가 필요하다.

**Why:** 사용자는 단순 실행파일 크기만으로 Shell을 선택하지 말고, Signed Installer와 개발 실행파일을 구분하도록 요구했다.

**How to apply:** Shell 기술 추천은 승인된 기술 결정과 구분한다. Desktop Foundation에 금융·차량 전체 구현을 끼워 넣지 않으며, 공급업체 계약과 Windows 실장비 검증을 별도 의존성으로 둔다.

운영 메시지는 교육 메시지와 별도 Domain이다. AI 반영에는 텍스트뿐 아니라 회원·보호자·Thread·기존 업무 Context를 전달한다. 음성 비서는 유선전화 녹음이 아닌 직원의 Push-to-talk 업무메모다.

**Why:** 사용자가 두 메시지의 기록·권한을 분리하고, 회원 미확정 음성 업무도 계획을 유지한 채 부족한 대상만 질문하도록 명시했다.

**How to apply:** 기존 교육 Thread나 직원 메신저를 운영 Inbox로 단순 재명명하지 않는다. 관리자 일정 공유는 일상 출결이 아닌 중요 업무에 한해 제안한다.
