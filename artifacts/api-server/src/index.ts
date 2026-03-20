import app from "./app";
import { startBackupJobs } from "./jobs/backup-batch.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// 새벽 배치 잡 시작 (앱이 켜져 있는 동안 스케줄 유지)
startBackupJobs();

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
