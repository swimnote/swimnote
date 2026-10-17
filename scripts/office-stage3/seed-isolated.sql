-- Apply ONLY through isolated-init.mjs, never against an operating DSN.
CREATE SCHEMA office_acceptance;
SET search_path=office_acceptance;
CREATE TABLE isolation_marker(key text PRIMARY KEY,value text NOT NULL);
INSERT INTO isolation_marker VALUES ('synthetic_only','office-stage3-acceptance');
CREATE TABLE fixture_principals(id text PRIMARY KEY,active boolean,role text,pool_id text);
INSERT INTO fixture_principals VALUES ('fixture_admin',true,'pool_admin','fixture_pool');
CREATE TABLE students(id text PRIMARY KEY,swimming_pool_id text,name text,phone text,birth_date text,birth_year text,
 parent_name text,memo text,status text,class_group_id text,assigned_class_ids jsonb,schedule_labels text,weekly_count int,updated_at timestamptz DEFAULT now());
CREATE TABLE class_groups(id text PRIMARY KEY,swimming_pool_id text,name text,schedule_days text,schedule_time text,
 capacity int,is_deleted boolean DEFAULT false,is_one_time boolean DEFAULT false);
CREATE TABLE student_class_history(id text PRIMARY KEY,student_id text,class_group_id text,swimming_pool_id text,
 enrolled_at date,left_at date,created_at timestamptz DEFAULT now());
CREATE TABLE pool_event_logs(id text PRIMARY KEY,pool_id text,event_type text,entity_type text,entity_id text,actor_id text,payload jsonb,source text);
INSERT INTO class_groups(id,swimming_pool_id,name,schedule_days,schedule_time,capacity) VALUES
 ('fixture_a','fixture_pool','합성 A','월수금','16:00',10),('fixture_b','fixture_pool','합성 B','화목','17:00',10),
 ('fixture_c','fixture_pool','합성 C','토','10:00',1);
INSERT INTO students(id,swimming_pool_id,name,status,class_group_id,assigned_class_ids,weekly_count)
 VALUES ('fixture_member','fixture_pool','합성 회원','active','fixture_a','["fixture_a","fixture_b"]',3);
INSERT INTO student_class_history(id,student_id,class_group_id,swimming_pool_id,enrolled_at)
 VALUES ('fixture_ha','fixture_member','fixture_a','fixture_pool','2026-01-01'),('fixture_hb','fixture_member','fixture_b','fixture_pool','2026-01-01');
