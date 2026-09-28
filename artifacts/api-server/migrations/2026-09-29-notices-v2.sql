-- 공지 V2: link_label 컬럼 추가
-- Additive only. Production DB 미적용 (검수 후 별도 승인).

ALTER TABLE notices
  ADD COLUMN IF NOT EXISTS link_label text DEFAULT NULL;
