import { pool } from "./database.js";
// Ordinary cooperating synthetic writer, not an endpoint and never a revision override.
await pool.query("UPDATE students SET memo='합성 다른 작성자의 변경',updated_at=clock_timestamp() WHERE id='fixture_member' AND swimming_pool_id='fixture_pool'");
await pool.end();
