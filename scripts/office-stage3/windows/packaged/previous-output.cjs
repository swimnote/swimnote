"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { OutputCapture } = require("./database-output.cjs");
function plain(file, directory = false) {
  const info = fs.lstatSync(file);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile()) ||
      fs.realpathSync.native(file).toLowerCase() !== path.resolve(file).toLowerCase()) throw new Error("Unsafe evidence path");
  return info;
}
function secrets(value) {
  if (typeof value === "string") return [value];
  return value && typeof value === "object" ? Object.values(value).flatMap(secrets) : [];
}
function recoverPrevious(context, legacy) {
  const report = { packageId: context.packageId, originalStderrRecovered: false,
    oldPackageRawRetention: "NONE", processStateNow: "NOT_QUERIED_BY_LOG_EXPORT",
    status: "NO_POSTGRES_CURRENT_LOGFILE", sameFailedExecutionConfirmed: false };
  try {
    plain(context.run, true);
    const db = path.join(context.run, "db"); plain(db, true);
    const pointer = path.join(db, "current_logfiles");
    if (!fs.existsSync(pointer)) return report;
    if (plain(pointer).size > 8192) throw new Error("Evidence pointer too large");
    const relative = fs.readFileSync(pointer, "utf8").split(/\r?\n/)
      .map(line => line.match(/^stderr (.+)$/)?.[1]).find(Boolean);
    if (!relative) { report.status = "NO_STDERR_LOG_POINTER"; return report; }
    if (!/^[A-Za-z0-9_./\\-]+$/.test(relative) || path.isAbsolute(relative) ||
        relative.split(/[\\/]/).some(part => !part || part === "." || part === ".."))
      throw new Error("Evidence path outside boundary");
    const file = path.resolve(db, relative);
    if (!file.startsWith(path.resolve(db) + path.sep)) throw new Error("Evidence outside DB");
    plain(path.dirname(file), true); const stat = plain(file);
    let localSecrets = [];
    const privateFile = path.join(context.run, "private.json");
    if (fs.existsSync(privateFile) && plain(privateFile).size <= 65536)
      localSecrets = secrets(JSON.parse(fs.readFileSync(privateFile, "utf8")));
    const capture = new OutputCapture(legacy, () => localSecrets);
    const limit = 65536, bytes = Buffer.alloc(Math.min(stat.size, limit)), fd = fs.openSync(file, "r");
    try {
      const count = fs.readSync(fd, bytes, 0, bytes.length, Math.max(0, stat.size - bytes.length));
      capture.append("stderr", bytes.subarray(0, count)); capture.finish("stderr");
    } finally { fs.closeSync(fd); }
    report.status = "SANITIZED_POSTGRES_LOG_AVAILABLE_NOT_PROVEN_ORIGINAL_STDERR";
    report.source = "DB_CURRENT_LOGFILES_STDERR";
    report.sourceBytes = stat.size; report.tailLimited = stat.size > limit;
    report.capture = capture.snapshot();
  } catch { report.status = "LOG_INSPECTION_UNAVAILABLE_NO_RECOVERY_CLAIM"; }
  return report;
}
module.exports = { recoverPrevious };
