# SwimNote — Nationwide Swimming Pool Online Integrated Management Platform

## Overview
SwimNote is a multi-tenant B2B SaaS platform designed for comprehensive management of swimming pools. It streamlines operations for various user roles, including super_admin, platform_admin, pool_admin, teacher, and parent_account, with a Korean UI. The platform manages the entire lifecycle from swimming pool application and approval to daily operations like class management, attendance, and communication. It provides robust multi-tenancy at the database level and a flexible permission system for platform administrators. The business vision is to become the leading integrated management solution for swimming facilities, offering efficiency and an enhanced experience for administrators, teachers, and parents.

## User Preferences
I prefer the AI to operate with a clear understanding of the existing system's multi-tenancy and role-based access control. When implementing new features or modifying existing ones, prioritize maintaining data isolation and security across different swimming pools and user roles. I expect the AI to maintain a consistent API response format and to automatically record activity logs for significant actions, especially status changes and data modifications.

## System Architecture

### UI/UX Decisions
The administrator application features a 6-tab structure (Dashboard, People, Classes, Communication, Messenger, More), while the teacher application has a 7-tab structure (Today's Schedule, Class Management, Attendance, Swim Diary, Photos, Messenger, Settings). A consistent selection mode UX is implemented for bulk actions. The member detail screen is an 8-tab hub for managing student information. Common UI components like `SubScreenHeader`, `PageHeader`, and `ModalSheet` are used across the application. Navigation rules emphasize a structured flow (e.g., `시간표 → 선생님 선택 → 반 목록 → 반 현황판`). `Alert.alert` is prohibited in favor of custom `Modal` components. Tab navigation supports resetting scroll positions on re-selection and maintaining tab state. Logout buttons are consistently placed in the header of each mode's home screen. The parent application was reconfigured to a Stack-based navigation, removing the bottom tab bar.

### Technical Implementations
The platform uses a pnpm workspace monorepo with TypeScript, Node.js 24, pnpm, TypeScript 5.9, Express 5 for the API, PostgreSQL with Drizzle ORM, Zod for validation, and Orval for API codegen. Esbuild is used for CJS bundling. Key features include a subscription plan structure with various tiers, payment failure and deletion policies, write blocking middleware (`readonlyGuard`), member limit enforcement, storage blocking, and a comprehensive read-only UI. Role-Based Access Control differentiates permissions for all user types. A swimming pool approval flow manages new registrations. Database-level multi-tenancy is achieved using `swimming_pool_id`. A photo album system supports group and private albums. Makeup lesson management and activity logging are implemented. An event log timeline tracks significant system events. Server-based change collection and daily/weekly backups are implemented, including a change logger and batch jobs. A kill switch feature allows secure deletion of data. A bulk unregistered member management system facilitates mass registration and invitation. A feedback template manager allows teachers to customize feedback sentences. Storage management provides insights into data usage. A Work Messenger facilitates internal collaboration between administrators and teachers. A complete settlement/payroll system handles monthly teacher payments. A refactored login/signup system supports unified login and a three-step parent onboarding process. Role switching and route guards manage access based on user roles. A multi-pool management system with white-label capabilities allows managing multiple swimming pools under one account and customizing branding. The invite system was rebuilt to use the device's native SMS app instead of a custom SMS service. The super_admin console includes extended security settings for external services and a full MVP for operational features like subscription product management, backup/restore, and read-only control. A centralized push notification system supports various notification types, scheduled pushes, and user/pool-specific settings. The subscription payment system has been refactored with new plan structures, first-month discounts, and expanded revenue logging.

### DB Architecture
The system uses a dual database connection: `superAdminDb` (Supabase ap-south-1) for platform, audit, and subscription data, and `poolDb` (Supabase ap-northeast-2) for individual swimming pool operational data. Tables are explicitly assigned to either `superAdminDb` or `db` (`poolDb`). `photo_assets_meta` and `video_assets_meta` tables manage media metadata. Event logs are redundantly stored in both `pool_change_logs` (pool DB) and `pool_event_logs` (super DB). Change logging directs `data_change_logs` to `superAdminDb`. A DB monitoring API provides connection status, diagnostics, event verification, and dead-letter queue management.

### System Design Choices
API design follows RESTful principles with consistent JSON formats and strong authentication. The database schema (PostgreSQL with Drizzle ORM) includes key tables for multi-tenancy via `swimming_pool_id`. Security features include JWT authentication, role/pool access checks, and API validation. A modular monorepo structure with `artifacts`, `lib`, and `packages` promotes reusability.

## Verified State (2026-03-25)
- **pool_event_logs**: 46건 기록 / 17가지 이벤트 타입 / 3개 풀 / retry_queue=0 / DLQ=0
- **학부모 모드**: 10가지 기능 전체 검증 완료 (자녀목록/일지/공지/사진/영상/알림설정/결제차단/공지읽음/출결/학생상세)
- **CRUD**: 학생수정/반수정/반삭제/일지수정/공지생성삭제/휴일삭제/보강배정/보강완료
- **notice_reads**: poolDb에 DDL 추가 (pool-db-init.ts) — 학부모 공지 500 버그 수정
- **parent-student 링크 승인**: `PATCH /api/admin/parents/:id/students/:link_id` body `{action:"approve"}`
- **올바른 학부모 API 경로**: `/api/parent/students` (자녀목록), `/api/parent/students/:id/diary` (일지), `/api/parent/notices` (공지)
- **올바른 CRUD PATCH 경로**: `PATCH /api/students/:id`, `PATCH /api/class-groups/:id`
- **반 생성 필수 필드**: `schedule_days`, `schedule_time` (name 선택)
- **보강 생성 방식**: 출결 absent 처리 시 자동 생성, `PATCH /api/admin/makeups/:id/assign` → complete
- **tier 버그**: growth → advance 수정 완료

## External Dependencies
- **PostgreSQL**: Primary database for all application data.
- **Drizzle ORM**: Object-relational mapper for interacting with PostgreSQL.
- **Express 5**: Web application framework for the API server.
- **Zod**: Schema declaration and validation library.
- **Orval**: OpenAPI code generator for API clients.
- **Google Cloud Storage (GCS) or equivalent**: Object storage for managing student and class photos.