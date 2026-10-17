"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
function databaseProfile({ executable, run, args, env, expectedHash, initializedHere }) {
  const result = { executable: "postgres/bin/postgres.exe", cwd: "ISOLATED_PACKAGE_RUN",
    arguments: args, initdbReturnedZeroInThisSession: initializedHere === true,
    databaseDirectoryArgument: "db", databaseDirectoryMatchesInitdbArgument: args[0] === "-D" && args[1] === "db",
    environment: { locale: env.LANG === "C" && env.LC_ALL === "C" ? "C" : "UNEXPECTED",
      packagedPostgresOnlyPath: env.PATH === path.dirname(executable),
      pgdataOverride: Object.keys(env).some(key => key.toUpperCase() === "PGDATA"),
      pgpasswordPassedToServer: Object.keys(env).some(key => key.toUpperCase() === "PGPASSWORD"),
      inheritedKeyNames: Object.keys(env).filter(key =>
        /^(SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|HOMEDRIVE|HOMEPATH)$/i.test(key)).map(key => key.toUpperCase()).sort() },
    fullDatabaseEngineValidation: "NOT_PERFORMED_BY_PROFILE" };
  try {
    result.executableMatchesVerifiedManifest = !!expectedHash &&
      crypto.createHash("sha256").update(fs.readFileSync(executable)).digest("hex") === expectedHash;
    const db = path.join(run, "db");
    result.cwdIsPlainDirectory = fs.lstatSync(run).isDirectory() && !fs.lstatSync(run).isSymbolicLink() &&
      fs.realpathSync.native(run).toLowerCase() === path.resolve(run).toLowerCase();
    result.pgMajorVersion = fs.readFileSync(path.join(db, "PG_VERSION"), "ascii").trim() === "16" ? "16" : "UNEXPECTED";
    result.configurationFiles = Object.fromEntries(["postgresql.conf", "pg_hba.conf", "postgresql.auto.conf"]
      .map(name => [name, fs.existsSync(path.join(db, name))]));
    result.activeSettings = {};
    for (const name of ["postgresql.conf", "postgresql.auto.conf"]) {
      const file = path.join(db, name);
      if (!fs.existsSync(file)) continue;
      if (fs.statSync(file).size > 1024 * 1024) throw new Error("Configuration too large");
      for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const match = line.match(/^\s*(data_directory|hba_file|ident_file|logging_collector|log_destination)\s*=\s*(.*?)\s*(?:#.*)?$/);
        if (!match) continue;
        const value = match[2].replace(/^'(.*)'$/, "$1").replace(/''/g, "'");
        result.activeSettings[match[1]] = ["logging_collector", "log_destination"].includes(match[1]) ?
          (["on", "off", "stderr"].includes(value) ? value : "OTHER_VALUE_WITHHELD") :
          (path.resolve(db, value).toLowerCase() === path.resolve(db,
            { data_directory: ".", hba_file: "pg_hba.conf", ident_file: "pg_ident.conf" }[match[1]]).toLowerCase() ?
            "EXPECTED_LOCATION" : "OVERRIDE_LOCATION_WITHHELD");
      }
    }
    result.inspection = "COMPLETED";
  } catch { result.inspection = "INCOMPLETE_NO_CAUSE_INFERRED"; }
  return result;
}
module.exports = { databaseProfile };
