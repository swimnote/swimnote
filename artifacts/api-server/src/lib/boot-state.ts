/**
 * boot-state.ts — 서버 기동 시 1회 생성되는 불변 메타데이터
 *
 * 목적: 다음 장애 발생 시 boot_id 변경 여부로 restart/deploy를 즉시 확인
 *
 * [SERVER_BOOT] 로그에 포함되며, healthz 응답 및 AUTH_TRACE에도 사용된다.
 * PII 없음 / 보안 민감값 없음.
 */
import { randomUUID } from "node:crypto";

/** 프로세스 기동 시 1회 발급. 재기동 시 반드시 변경됨. */
export const BOOT_ID = randomUUID();

/** 프로세스 기동 ISO timestamp */
export const BOOT_STARTED_AT = new Date().toISOString();

/**
 * 커밋 SHA — Render.com은 RENDER_GIT_COMMIT 환경변수를 주입한다.
 * 없으면 "unknown".
 */
export const COMMIT_SHA =
  process.env["RENDER_GIT_COMMIT"] ??
  process.env["GIT_COMMIT"] ??
  "unknown";

/**
 * 서비스 버전 — package.json npm_package_version 또는 환경변수.
 */
export const SERVICE_VERSION =
  process.env["npm_package_version"] ??
  process.env["SERVICE_VERSION"] ??
  "2.x";
