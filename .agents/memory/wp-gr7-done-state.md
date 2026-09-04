---
name: GR7 완료 상태
description: GR7 PUBLISHED PUSH NOTIFICATION + DEEP LINK FOUNDATION 완료 기록
---

## GR7 완료 상태

- **Branch**: deploy-photo-clone
- **SHA**: 45b490c4
- **TC**: 55 TC 추가 → 전체 833/833 통과

## 신규/수정 파일

| 파일 | 역할 |
|---|---|
| `utils/notify.ts` | GROWTH_REPORT_PUBLISHED 타입 + notifyGrowthReportPublished() 추가 |
| `lib/growth-report-service.ts` | PublishGrowthReportResult에 studentId/poolId/reportPeriod 추가 |
| `routes/publish-growth-report.ts` | DB commit 후 setImmediate fire-and-forget 발송 |
| `migrations/pool-db-init.ts` | ALTER TABLE notifications ADD COLUMN IF NOT EXISTS deep_link text |
| `app/(parent)/notifications.tsx` | GROWTH_REPORT_PUBLISHED NOTIF_CONFIG + handleNotifPress deep link 처리 |
| `app/(parent)/growth-report-detail.tsx` | GR8 boundary shell (/(parent)/growth-report-detail?reportId=<id>) |
| `app/(parent)/_layout.tsx` | Stack.Screen name='growth-report-detail' 등록 |

## 핵심 설계

- fire-and-forget: DB commit 완료 후 setImmediate → push 실패 시 PUBLISHED 유지 (spec §17)
- 영구 멱등성: (type, ref_id=reportId, recipient_id=parentId) 시간 제한 없이 dedup (spec §15)
- 다중 보호자: DISTINCT parent_id, 각각 개별 notification (spec §5)
- Push preference: sendPushToUser가 기존 push_settings ON/OFF 확인 (spec §6)
- notification center: INSERT INTO notifications (기존 테이블 재사용) (spec §13)
- deep_link: /parent/growth-report-detail?reportId=<id> (spec §9, canonical contract for GR8)
- recipient_type: parent_account (기존 convention)
- push data: { screen, growth_report_id, report_period, deep_link } — PII 최소
- title/body: 정적 Product 문구만 (ENGINE/GPT 금지, spec §31,§32)
- GR8 경계: growth-report-detail.tsx는 shell만 (상세 UI 없음, spec §11)

## vitest mock 패턴

- push-service.ts를 vi.mock으로 격리 → sendPushToUser가 실제 Expo 호출 없이 검증 가능
- notifyGrowthReportPublished는 db.execute를 파라미터 대신 @workspace/db 모듈에서 사용
  → 테스트에서 vi.mocked(db.execute).mockImplementation으로 제어

## 다음 단계: GR8 (Parent Growth Report Detail Screen)
