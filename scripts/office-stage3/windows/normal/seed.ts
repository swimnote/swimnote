import { pool, privateState } from "./database.js";
import * as schema from "./schema.js";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
const q = (text: string) => '"' + text.replaceAll('"', '""') + '"';
const value = (v: any) => v === null ? "NULL" : typeof v === "boolean" || typeof v === "number" ? String(v) : "'" + String(v).replaceAll("'", "''") + "'";
const dialect = new PgDialect();
await pool.query("BEGIN");
try {
  for (const table of [schema.swimmingPoolsTable, schema.usersTable]) {
    const cfg = getTableConfig(table);
    for (const col of cfg.columns as any[]) if (col.enumValues?.length) {
      await pool.query(`CREATE TYPE ${q(col.getSQLType())} AS ENUM (${col.enumValues.map(value).join(",")})`);
    }
    const columns = cfg.columns.map((col: any) => {
      let def = "";
      if (col.default !== undefined) {
        if (typeof col.default?.getSQL === "function") def = dialect.sqlToQuery(col.default).sql;
        else def = value(col.mapToDriverValue(col.default));
      }
      return `${q(col.name)} ${col.getSQLType()}${col.primary ? " PRIMARY KEY" : ""}${col.notNull ? " NOT NULL" : ""}${col.isUnique ? " UNIQUE" : ""}${def ? " DEFAULT " + def : ""}`;
    });
    await pool.query(`CREATE TABLE ${q(cfg.name)} (${columns.join(",")})`);
  }
  // These columns are additive migrations in product routes, not present in base Drizzle declarations.
  await pool.query(`ALTER TABLE users ADD COLUMN web_pin_hash text;
    ALTER TABLE users ADD CONSTRAINT isolated_user_pool_fk FOREIGN KEY(swimming_pool_id) REFERENCES swimming_pools(id);
    ALTER TABLE swimming_pools ADD COLUMN deactivated_at timestamptz, ADD COLUMN deletion_scheduled_at timestamptz,
      ADD COLUMN xmode_config_status text DEFAULT 'READY', ADD COLUMN x_paid_entitlement boolean DEFAULT false,
      ADD COLUMN x_manual_entitlement boolean DEFAULT true, ADD COLUMN base_manual_entitlement boolean DEFAULT true,
      ADD COLUMN x_force_disabled boolean DEFAULT false, ADD COLUMN x_management_override boolean DEFAULT false,
      ADD COLUMN x_trial_started_at timestamptz, ADD COLUMN x_trial_ends_at timestamptz, ADD COLUMN x_trial_used_at timestamptz,
      ADD COLUMN payment_suspended_at timestamptz;
    CREATE TABLE user_pool_memberships(id text PRIMARY KEY,account_id text NOT NULL REFERENCES users(id),
      account_type text NOT NULL DEFAULT 'user',pool_id text NOT NULL REFERENCES swimming_pools(id),
      role text NOT NULL,status text NOT NULL DEFAULT 'active',created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(account_id,pool_id,role));
    CREATE TABLE event_logs(id text PRIMARY KEY,pool_id text,category text,actor_id text,actor_name text,target text,description text,metadata jsonb);`);
  for (const id of [...new Set(privateState.accounts.map((account: any) => account.poolId))])
    await pool.query(`INSERT INTO swimming_pools(id,name,name_en,address,phone,owner_name,owner_email,approval_status,subscription_status)
      VALUES($1,$2,$1,'합성 주소','000','합성 소유자','owner@example.invalid','approved','active')`, [id, "합성 수영장 " + id]);
  await pool.query("UPDATE swimming_pools SET deactivated_at=now() WHERE id='isolation_off_pool'");
  for (const account of privateState.accounts) {
    const hash = await bcrypt.hash(account.password, 10);
    const pin = account.pin ? await bcrypt.hash(account.pin, 10) : null;
    await pool.query(`INSERT INTO users(id,email,password_hash,name,role,roles,swimming_pool_id,is_activated,web_pin_hash,totp_enabled,totp_secret,withdrawal_requested_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [
      account.id, account.email, hash, "합성 사용자 " + account.id, account.role, [account.role], account.poolId,
      account.active !== false, pin, Boolean(account.totpSecret), account.totpSecret ?? null, account.withdrawn ? new Date() : null,
    ]);
    await pool.query("INSERT INTO user_pool_memberships(id,account_id,pool_id,role) VALUES($1,$2,$3,$4)",
      ["membership_" + account.id, account.id, account.poolId, account.role]);
  }
  await pool.query(`ALTER TABLE students ADD CONSTRAINT isolated_student_pool_fk FOREIGN KEY(swimming_pool_id) REFERENCES swimming_pools(id);
    ALTER TABLE class_groups ADD CONSTRAINT isolated_class_pool_fk FOREIGN KEY(swimming_pool_id) REFERENCES swimming_pools(id);
    INSERT INTO isolation_marker VALUES('normal_auth','real-handlers-local-db');`);
  await pool.query("COMMIT");
} catch (error) { await pool.query("ROLLBACK"); throw error; }
finally { await pool.end(); }
