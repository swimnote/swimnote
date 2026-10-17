-- Additional rows for this separately initialized synthetic DB only.
SET search_path=office_acceptance;
DO $$ BEGIN
 IF current_database() <> 'office_stage3_acceptance' OR
    NOT EXISTS (SELECT 1 FROM isolation_marker WHERE key='synthetic_only' AND value='office-stage3-acceptance')
 THEN RAISE EXCEPTION 'Not isolated acceptance DB'; END IF;
END $$;
UPDATE students SET name='합성 검증 회원', phone='010-0000-3333' WHERE id='fixture_member';
UPDATE students SET name='합성동명' WHERE id='fixture_twin';
INSERT INTO students(id,name,swimming_pool_id,class_group_id,assigned_class_ids,weekly_count,status)
VALUES ('fixture_homonym','합성동명','fixture_pool','fixture_b','["fixture_b"]'::jsonb,1,'active');
INSERT INTO students(id,name,swimming_pool_id,class_group_id,assigned_class_ids,weekly_count,status)
SELECT 'fixture_scroll_'||n, '합성목록'||lpad(n::text,3,'0'),'fixture_pool','fixture_a','["fixture_a"]'::jsonb,1,'active'
FROM generate_series(1,45) n;
