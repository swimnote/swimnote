// E2E 테스트 스크립트 — 실행 후 삭제
import jwt from 'jsonwebtoken';
import { db, sql } from '../src/lib/db.js';

// db.js 경로 확인 실패 시 아래 대체 사용
