---
name: WP16 AI ENGINE OTA 완료
description: TeacherDiaryAIClient→professional-engine 전환 + contract_version 1.0 fix; iOS production-v2 OTA 완료
---

## 완료 상태

- **SHA:** `5deba2f8` (release/v2.0.0)
- **변경:** TeacherDiaryAIClient GROUNDED_BASE→professional-engine (1줄) + DiaryAIService APP_CONTRACT_VERSION 1.3→1.0 (1줄)
- **iOS OTA:** production-v2 채널, Group ID `92d1974d`, Update ID `01a07292-a1e9-7919-8860-2da48dc44383`

## Root Cause (P0 400)

APP이 `contract_version='1.3'` 전송 → GroundedPipelineRunner는 `'1.0'`만 허용 → 400 발생.  
Fix: `APP_CONTRACT_VERSION = '1.0'`.

**Why:** api-server(ai-v1.ts)는 1.0+1.3 모두 허용했으나 GroundedPipelineRunner(professional-engine)는 1.0만 허용. ENGINE 전환 시 반드시 contract 버전 호환성 사전 확인 필요.

**How to apply:** ENGINE 교체 시 새 ENGINE의 SUPPORTED_CONTRACT_VERSIONS 먼저 확인 후 APP_CONTRACT_VERSION 맞춤.
