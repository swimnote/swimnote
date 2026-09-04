-- WP8 Production Test Data Cleanup Script
-- DO NOT RUN WITHOUT EXPLICIT PRODUCTION APPROVAL
--
-- Generated: 2026-09-04
-- Classification: CONFIRMED_TEST_DATA only
-- Source: wp8-preflight runs against SUPABASE_DATABASE_URL (shared production DB)
--
-- Confirmation criteria:
--   1. pool_id = 'cc-gate-a-1788515853316' (preflight fixture pool — timestamp-keyed)
--   2. created_by_admin = 'user_super_1775303066795_yial5wvrm'
--   3. created_at: 2026-09-04 UTC (today, during preflight runs)
--   4. title contains "WP8 Test Case" or "E2E 워크플로우 테스트"
--   5. ALL 70 support_case_notes belong to confirmed test cases (REAL_OR_UNKNOWN_NOTES: 0)
--
-- =============================================================
-- STEP 1: Verify counts before running (READ-ONLY)
-- =============================================================
-- SELECT COUNT(*) FROM support_cases WHERE id IN (<<IDs below>>);          -- expect 15
-- SELECT COUNT(*) FROM support_case_notes WHERE support_case_id IN (<<IDs below>>);  -- expect 70
-- SELECT COUNT(*) FROM support_case_notes WHERE support_case_id NOT IN (<<IDs below>>);  -- expect 0

-- =============================================================
-- STEP 2: Delete support_case_notes (all 70 rows — all confirmed test)
-- =============================================================
DELETE FROM support_case_notes
WHERE id IN (
  'scn_1788526261675_25qpmi','scn_1788526261698_f905ps','scn_1788526261748_exuj8t',
  'scn_1788526261774_ay44yy','scn_1788526261794_j2p8op','scn_1788526261819_grfx06',
  'scn_1788526261851_5f3x9r','scn_1788526261891_9f0s8o','scn_1788526261909_qgvdep',
  'scn_1788526262005_y1lk79','scn_1788526262023_4s7o73','scn_1788526262046_zqkghg',
  'scn_1788526262064_q7v4i3','scn_1788526262088_20co4i','scn_1788526343863_nnwe9z',
  'scn_1788526343886_qjqv8q','scn_1788526343929_vq99eb','scn_1788526343954_xsk3gq',
  'scn_1788526343973_2jgned','scn_1788526343998_zne2vl','scn_1788526344025_peky4u',
  'scn_1788526344064_sedhii','scn_1788526344081_8b7o81','scn_1788526344163_t3xkka',
  'scn_1788526344180_4wmp1g','scn_1788526344206_dff3so','scn_1788526344223_p3sm51',
  'scn_1788526344244_a7f03e','scn_1788526353331_ab82w6','scn_1788526353359_sraneq',
  'scn_1788526353403_hexhjx','scn_1788526353428_27vajq','scn_1788526353448_jkl64x',
  'scn_1788526353476_3rqvfp','scn_1788526353508_nrwkf0','scn_1788526353550_cdyp8v',
  'scn_1788526353569_k73yja','scn_1788526353660_hm3882','scn_1788526353678_aq0m15',
  'scn_1788526353701_ysg9ff','scn_1788526353719_tdbh3n','scn_1788526353743_uyyaxf',
  'scn_1788526494540_naayf6','scn_1788526494564_yxra42','scn_1788526494607_nt9v1v',
  'scn_1788526494631_alk88a','scn_1788526494649_vjl9ob','scn_1788526494675_pf1dzj',
  'scn_1788526494706_76yi0s','scn_1788526494747_y3wr4b','scn_1788526494765_laeg4z',
  'scn_1788526494855_ufcejd','scn_1788526494872_mr062r','scn_1788526494894_8qnh0y',
  'scn_1788526494912_igb4lp','scn_1788526494938_s3abux','scn_1788528076608_qixpvw',
  'scn_1788528076631_zhj368','scn_1788528076673_u7yp5a','scn_1788528076696_247xd3',
  'scn_1788528076715_uyzkh9','scn_1788528076738_0d61pp','scn_1788528076767_erpqoh',
  'scn_1788528076802_ycp228','scn_1788528076817_6e5nyq','scn_1788528076901_vatdib',
  'scn_1788528076917_8zb6yd','scn_1788528076939_56e23d','scn_1788528076956_xbo3s3',
  'scn_1788528076977_m1lrai'
);
-- Expected: 70 rows deleted

-- =============================================================
-- STEP 3: Delete confirmed test support_cases (15 rows)
-- =============================================================
DELETE FROM support_cases
WHERE id IN (
  'sc_1788526261662_ruoa5p',
  'sc_1788526261693_p1mvpv',
  'sc_1788526261998_8tmg89',
  'sc_1788526343857_jzai7i',
  'sc_1788526343880_k3rtb5',
  'sc_1788526344158_dyxw2s',
  'sc_1788526353325_qyhr7i',
  'sc_1788526353350_7y9pgq',
  'sc_1788526353653_hnc582',
  'sc_1788526494533_3rf4kh',
  'sc_1788526494558_bs32x1',
  'sc_1788526494850_bfwbx9',
  'sc_1788528076602_g7h58n',
  'sc_1788528076626_pnyypx',
  'sc_1788528076896_6o6f9n'
);
-- Expected: 15 rows deleted
-- Remaining after cleanup: 117 rows (all real AI-chatbot cases, title IS NULL)

-- =============================================================
-- STEP 4 (optional): Delete test audit_logs for cc-gate-a pool
-- =============================================================
-- Run only if audit_log entries for cc-gate-a pool are confirmed spurious:
-- DELETE FROM audit_logs
-- WHERE pool_id = 'cc-gate-a-1788515853316';

-- =============================================================
-- STEP 5: Post-cleanup verification (READ-ONLY)
-- =============================================================
-- SELECT COUNT(*) FROM support_cases;                  -- expect 117
-- SELECT COUNT(*) FROM support_case_notes;             -- expect 0
-- SELECT COUNT(*) FROM support_cases WHERE title IS NOT NULL;  -- expect 0
