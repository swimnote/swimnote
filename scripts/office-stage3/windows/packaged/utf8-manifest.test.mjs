import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withUtf8Manifest, inspectPe } from "./utf8-manifest.mjs";

const prior = path.resolve("generated-artifacts/office-windows-packaged-auth/attempt-08/installer-extracted/resources/postgres");
for (const filename of ["initdb.exe", "postgres.exe"]) {
  test(`${filename}: embedded UTF8 process manifest, all executable sections and other resources preserved (NOT Windows loader execution)`, () => {
    const input = fs.readFileSync(path.join(prior, "bin", filename));
    const { bytes, evidence } = withUtf8Manifest(input, filename), inspected = inspectPe(bytes);
    assert.equal(evidence.sameFileLength, true);
    assert.equal(evidence.otherResourcesUnchanged, true);
    assert.equal(evidence.asInvokerPreserved, true);
    assert.equal(evidence.unchangedSections.some(s => s.name === ".text"), true);
    assert.equal(inspected.xml.match(/<activeCodePage\b/g).length, 1);
    assert.equal(inspected.xml.includes(">UTF-8</activeCodePage>"), true);
    assert.equal(inspected.xml.includes("requireAdministrator"), false);
    assert.throws(() => withUtf8Manifest(bytes, filename), /Unapproved vendor executable/);
    const changed = Buffer.from(input); changed[100] ^= 1;
    assert.throws(() => withUtf8Manifest(changed, filename), /Unapproved vendor executable/);
    // Windows PE loader rounds VirtualSize by SectionAlignment: allocation remains unchanged.
    const old = inspectPe(input), alignment = input.readUInt32LE(old.optional + 32);
    assert.equal(Math.ceil(old.section.virtualSize / alignment), Math.ceil(inspected.section.virtualSize / alignment));
    assert.equal(inspected.manifest.size > old.manifest.size, true);
  });
}

test("fixed initialization source data is ASCII and valid UTF8, excluding asset text as the reported invalid-byte source", () => {
  for (const filename of ["postgres.bki", "system_constraints.sql", "system_functions.sql",
    "system_views.sql", "snowball_create.sql", "information_schema.sql", "sql_features.txt",
    "postgresql.conf.sample", "pg_hba.conf.sample"]) {
    const bytes = fs.readFileSync(path.join(prior, "share", filename));
    assert.equal(bytes.every(byte => byte < 128), true, filename);
    assert.doesNotThrow(() => new TextDecoder("utf8", { fatal: true }).decode(bytes));
  }
});
