"use strict";
const { StringDecoder } = require("node:string_decoder");
const { TextDecoder } = require("node:util");
// Public PostgreSQL startup vocabulary. Unknown tokens are NEVER copied verbatim.
// The fallback does not require an ERROR/FATAL prefix, unlike the legacy initdb parser.
const WORDS = new Set(("execution of postgresql by a user with administrative permissions is not permitted " +
  "the server must be started under an unprivileged id to prevent possible system security compromises " +
  "see documentation for more information on how properly start " +
  "postgres does know where find configuration file you specify config invocation option or set pgdata environment variable " +
  "could cannot access read open write create load find bind directory data database socket shared memory " +
  "permission denied error fatal panic warning detail hint log no such file path invalid value parameter " +
  "failed failure missing syntax unexpected unrecognized argument port address already in use " +
  "connection refused terminated aborted interrupted startup initialization initdb " +
  "version control cluster incompatible initialized catalog compiled library module found " +
  "ready accept connections password authentication authorization supplied server starting up " +
  "lock listening shutdown checkpoint complete requested received request process exited exit code " +
  "background worker recovery record length resources running stopped out disk space limit " +
  "available accepting host regular empty exists but equivalent encoding character byte sequence " +
  "convert locale settings check child input output dynamic bootstrap subprocess executable " +
  "required valid only usage allowed permission denied access system compromised").split(/\s+/));
const LEVELS = new Set(["ERROR", "FATAL", "PANIC", "WARNING", "DETAIL", "HINT", "LOG", "CHILD", "UNCLASSIFIED"]);
function sanitizeLine(line, legacy, secrets = []) {
  let text = String(line).replace(/^\uFEFF/, ""), redacted = false;
  for (const secret of [...new Set(secrets)].filter(Boolean).sort((a, b) => b.length - a.length))
    if (text.includes(secret)) { text = text.split(secret).join("[redacted]"); redacted = true; }
  if (!text.trim()) return { reason: "EMPTY_LINE" };
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) return { reason: "CONTROL_OR_BINARY" };
  const prefix = text.match(/\b(ERROR|FATAL|PANIC|WARNING|DETAIL|HINT|LOG):\s*/i);
  if (/\b(?:ALTER|SELECT|INSERT|UPDATE|DELETE|CREATE|DO)\b.*\b(?:USER|PASSWORD|FROM|TABLE|ROLE)\b/i.test(text) ||
      /postgres(?:ql)?:\/\/|(?:password|secret|token|api[_-]?key|PGPASSWORD)\s*[:=]|Bearer\s/i.test(text))
    return { reason: "SQL_OR_CREDENTIAL_MATERIAL", prefixed: !!prefix };
  // Preserve the existing constrained parser for its known structured PostgreSQL phrases.
  const recognized = legacy(prefix?.[1].toUpperCase() === "LOG" ? text.replace(/\bLOG:/i, "WARNING:") : text);
  if (recognized) return { message: { ...recognized, severity: prefix?.[1].toUpperCase() === "LOG" ? "LOG" : recognized.severity },
    prefixed: !!prefix, policy: "LEGACY_CONSTRAINED", redacted: redacted || recognized.text.includes("[redacted]") };
  text = text.replace(/"[^"]*"|'[^']*'/g, "[redacted]")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+|(?:[A-Za-z]:[\\/]|\\\\|\/)[^\s,;]*/gi, "[redacted]");
  let publicWords = 0;
  const words = text.match(/\[redacted\]|[A-Za-z0-9_]+|[^\x00-\x7f]+/g) ?? [];
  const safe = words.map(word => {
    if (WORDS.has(word.toLowerCase())) { publicWords++; return word; }
    redacted = true; return "[redacted]";
  }).join(" ").replace(/(?:\[redacted\] ){1,}\[redacted\]/g, "[redacted]").slice(0, 320);
  if (!publicWords) return { reason: "NO_SAFE_PUBLIC_WORDS", prefixed: !!prefix };
  return { message: { severity: "UNCLASSIFIED", text: safe }, prefixed: !!prefix,
    policy: "PREFIXLESS_PUBLIC_WORD_TOKENS", redacted };
}
class OutputCapture {
  constructor(legacy, secrets = () => []) {
    this.legacy = legacy; this.secrets = secrets; this.messages = []; this.truncated = false;
    this.discardedMessages = 0; this.states = {};
    for (const name of ["stdout", "stderr"]) this.states[name] = {
      decoder: new StringDecoder("utf8"), validator: new TextDecoder("utf-8", { fatal: true }),
      prefix: Buffer.alloc(0), pending: "", rawBytes: 0, decodedUtf8Bytes: 0, lines: 0,
      safeLines: 0, prefixedLines: 0, fallbackLines: 0, redactedLines: 0, excludedLines: 0,
      excludedDecodedUtf8Bytes: 0, excludedReasons: {}, decoding: "UTF8_VALID",
      rawBytesMeasured: true, replacementCharacters: 0,
    };
  }
  add(message) {
    this.messages.push(message);
    if (this.messages.length > 24) {
      this.messages.splice(12, 1); this.truncated = true; this.discardedMessages++;
    }
  }
  line(stream, line) {
    this.observe?.(line);
    const state = this.states[stream], safe = sanitizeLine(line, this.legacy, this.secrets());
    state.lines++; if (safe.prefixed) state.prefixedLines++;
    if (safe.message) {
      state.safeLines++; if (safe.policy === "PREFIXLESS_PUBLIC_WORD_TOKENS") state.fallbackLines++;
      if (safe.redacted) state.redactedLines++;
      this.add({ stream, ...safe.message, policy: safe.policy });
    } else {
      state.excludedLines++; state.excludedDecodedUtf8Bytes += Buffer.byteLength(line);
      state.excludedReasons[safe.reason] = (state.excludedReasons[safe.reason] ?? 0) + 1;
      if (safe.reason !== "EMPTY_LINE")
        this.add({ stream, severity: "UNCLASSIFIED", text: "[output withheld]", exclusionReason: safe.reason });
    }
  }
  decoded(stream, text) {
    const state = this.states[stream];
    state.decodedUtf8Bytes += Buffer.byteLength(text);
    state.replacementCharacters += (text.match(/\uFFFD/g) ?? []).length;
    const lines = (state.pending + text).split(/\r\n|\r|\n/);
    state.pending = lines.pop();
    if (state.discardingLongLine) {
      if (!lines.length) { state.excludedDecodedUtf8Bytes += Buffer.byteLength(state.pending); state.pending = ""; return; }
      state.excludedDecodedUtf8Bytes += Buffer.byteLength(lines.shift());
      state.discardingLongLine = false;
    }
    if (state.pending.length > 8192) {
      state.excludedDecodedUtf8Bytes += Buffer.byteLength(state.pending);
      state.excludedLines++; state.lines++; state.discardingLongLine = true;
      state.pending = ""; this.truncated = true;
      state.excludedReasons.LINE_OVER_LIMIT = (state.excludedReasons.LINE_OVER_LIMIT ?? 0) + 1;
      this.add({ stream, severity: "UNCLASSIFIED", text: "[output withheld]", exclusionReason: "LINE_OVER_LIMIT" });
    }
    for (const line of lines) this.line(stream, line);
  }
  append(stream, chunk) {
    const state = this.states[stream];
    if (!Buffer.isBuffer(chunk)) state.rawBytesMeasured = false;
    let bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
    state.rawBytes += bytes.length;
    if (!state.started) {
      state.prefix = Buffer.concat([state.prefix, bytes]);
      if (state.prefix.length < 2) return;
      bytes = state.prefix; state.prefix = Buffer.alloc(0); state.started = true;
      if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))
        state.decoding = "UNSUPPORTED_UTF16_BOM";
    }
    if (state.decoding === "UNSUPPORTED_UTF16_BOM") return;
    try { state.validator.decode(bytes, { stream: true }); }
    catch { state.decoding = "UTF8_INVALID_SEQUENCE"; state.validator = new TextDecoder("utf-8", { fatal: true }); }
    this.decoded(stream, state.decoder.write(bytes));
  }
  finish(stream) {
    const state = this.states[stream]; if (state.finished) return;
    state.finished = true;
    if (state.decoding === "UNSUPPORTED_UTF16_BOM") {
      state.excludedReasons.UNSUPPORTED_ENCODING = 1;
      state.excludedLines++;
      this.add({ stream, severity: "UNCLASSIFIED", text: "[output withheld]", exclusionReason: "UNSUPPORTED_ENCODING" });
      return;
    }
    if (state.prefix.length) {
      try { state.validator.decode(state.prefix, { stream: true }); } catch { state.decoding = "UTF8_INVALID_SEQUENCE"; }
      this.decoded(stream, state.decoder.write(state.prefix)); state.prefix = Buffer.alloc(0);
    }
    try { state.validator.decode(); } catch { state.decoding = "UTF8_INCOMPLETE_SEQUENCE"; }
    this.decoded(stream, state.decoder.end());
    if (state.pending) { this.line(stream, state.pending); state.pending = ""; }
  }
  snapshot() {
    const streams = {};
    for (const [name, s] of Object.entries(this.states)) streams[name] = {
      rawBytes: s.rawBytes, rawBytesMeasured: s.rawBytesMeasured, decodedUtf8Bytes: s.decodedUtf8Bytes,
      decoding: s.decoding, replacementCharacters: s.replacementCharacters, lines: s.lines,
      recognizedPrefixLines: s.prefixedLines, safeLines: s.safeLines, fallbackLines: s.fallbackLines,
      redactedLines: s.redactedLines, excludedLines: s.excludedLines,
      excludedDecodedUtf8Bytes: s.excludedDecodedUtf8Bytes, excludedReasons: { ...s.excludedReasons },
      unsupportedEncodingExcludedRawBytes: s.decoding === "UNSUPPORTED_UTF16_BOM" ? s.rawBytes : 0,
    };
    return { streams, rawRetention: "NONE_SANITIZED_SNAPSHOTS_ONLY", discardedSanitizedMessages: this.discardedMessages,
      messages: this.messages.map(entry => {
        const safe = sanitizeLine(entry.severity === "UNCLASSIFIED" ? entry.text : `${entry.severity}: ${entry.text}`,
          this.legacy, this.secrets());
        return { stream: ["stdout", "stderr", "readiness"].includes(entry.stream) ? entry.stream : "stderr",
          severity: LEVELS.has(entry.severity) ? entry.severity : "UNCLASSIFIED",
          text: entry.exclusionReason ? "[output withheld]" : safe.message?.text ?? "[output withheld]",
          policy: ["LEGACY_CONSTRAINED", "PREFIXLESS_PUBLIC_WORD_TOKENS"].includes(entry.policy) ? entry.policy : undefined,
          exclusionReason: ["CONTROL_OR_BINARY", "SQL_OR_CREDENTIAL_MATERIAL", "NO_SAFE_PUBLIC_WORDS",
            "LINE_OVER_LIMIT", "UNSUPPORTED_ENCODING"].includes(entry.exclusionReason) ? entry.exclusionReason : undefined };
      }) };
  }
}
module.exports = { sanitizeLine, OutputCapture };
