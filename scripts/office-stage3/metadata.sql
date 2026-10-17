-- METADATA ONLY. Review and approve before any operating connection.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '10s';
SELECT current_database() AS database_name, current_user AS api_role,
       current_schemas(false) AS search_path, pg_is_in_recovery() AS replica;
SELECT n.nspname AS schema_name,c.relname,c.oid,c.relrowsecurity,c.relforcerowsecurity,
       pg_get_userbyid(c.relowner) AS owner,
       has_table_privilege(current_user,c.oid,'SELECT') AS can_select,
       has_table_privilege(current_user,c.oid,'INSERT') AS can_insert,
       has_table_privilege(current_user,c.oid,'UPDATE') AS can_update,
       has_table_privilege(current_user,c.oid,'DELETE') AS can_delete
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname = ANY(current_schemas(false)) AND c.relname IN
 ('students','class_groups','student_class_history','users','swimming_pools','pool_event_logs','office_command_receipts');
SELECT table_schema,table_name,column_name,data_type,udt_name,is_nullable,column_default
FROM information_schema.columns WHERE table_schema = ANY(current_schemas(false))
 AND table_name IN ('students','class_groups','student_class_history','users','swimming_pools','pool_event_logs','office_command_receipts')
ORDER BY table_schema,table_name,ordinal_position;
SELECT conrelid::regclass::text AS table_name,conname,contype,pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE conrelid IN (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname = ANY(current_schemas(false)) AND c.relname IN
 ('students','class_groups','student_class_history','users','swimming_pools','pool_event_logs','office_command_receipts'));
SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes
WHERE schemaname = ANY(current_schemas(false)) AND tablename IN
 ('students','class_groups','student_class_history','users','swimming_pools','pool_event_logs','office_command_receipts');
SELECT schemaname,tablename,policyname,roles,cmd,permissive FROM pg_policies
WHERE schemaname = ANY(current_schemas(false)) AND tablename IN
 ('students','class_groups','student_class_history','users','swimming_pools','pool_event_logs','office_command_receipts');
SELECT tgrelid::regclass::text AS table_name,tgname,tgenabled,pg_get_triggerdef(oid) AS definition
FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN
 (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname = ANY(current_schemas(false)) AND c.relname IN
  ('students','class_groups','student_class_history','users','swimming_pools','pool_event_logs','office_command_receipts'));
-- Existence only, never cron commands, function bodies, FDW credentials or application rows.
SELECT extname FROM pg_extension WHERE extname IN ('pg_cron','pgagent');
SELECT to_regclass('cron.job') IS NOT NULL AS cron_catalog_exists;
ROLLBACK;
-- External cleanup/retention jobs, service connection routing and role ownership need separate evidence.
