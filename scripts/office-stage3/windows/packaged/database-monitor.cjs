"use strict";
const { OutputCapture } = require("./database-output.cjs");
const REASONS = new Set(["NOT_ATTEMPTED", "PID_FILE_PENDING", "PID_READ_FAILED", "PID_MISMATCH",
  "AUTHENTICATION_FAILED", "AUTHORIZATION_REJECTED", "CONNECTION_REFUSED", "CONNECTION_FAILED", "SERVER_STARTING",
  "PORT_IN_USE", "BIND_FAILED", "CONFIGURATION_ERROR", "DIRECTORY_PERMISSIONS", "INPUT_NOT_FOUND",
  "LIBRARY_LOAD_FAILED", "SHARED_MEMORY_FAILED", "QUERY_TIMEOUT", "QUERY_FAILED", "READY"]);
function databaseReason(output, nativeCode) {
  if (nativeCode === "ETIMEDOUT") return "QUERY_TIMEOUT";
  const rules = [
    ["AUTHENTICATION_FAILED", /password authentication failed|no password supplied/i],
    ["AUTHORIZATION_REJECTED", /no pg_hba\.conf entry|not permitted to log in/i],
    ["CONNECTION_REFUSED", /connection refused|actively refused/i],
    ["SERVER_STARTING", /database system is starting up|not yet accepting connections/i],
    ["PORT_IN_USE", /address already in use|only one usage of each socket address/i],
    ["CONFIGURATION_ERROR", /invalid value for parameter|configuration file.*contains errors|unrecognized configuration parameter/i],
    ["DIRECTORY_PERMISSIONS", /invalid permissions|permission denied|access is denied/i],
    ["INPUT_NOT_FOUND", /no such file or directory|cannot find the (?:file|path)/i],
    ["LIBRARY_LOAD_FAILED", /could not load library|specified module could not be found/i],
    ["SHARED_MEMORY_FAILED", /could not (?:create|map|resize).*shared memory/i],
    ["BIND_FAILED", /could not bind.*socket/i],
    ["CONNECTION_FAILED", /could not connect to server|connection to server.*failed/i],
  ];
  return rules.find(([, pattern]) => pattern.test(output))?.[0] ?? "QUERY_FAILED";
}
class DatabaseMonitor {
  constructor(sanitize, secrets = () => []) {
    this.sanitize = sanitize;
    this.messages = [];
    this.pending = { stdout: "", stderr: "" };
    this.bytes = { stdout: 0, stderr: 0 };
    this.readiness = { attempts: 0, lastReason: "NOT_ATTEMPTED" };
    this.spawned = false;
    this.truncated = false;
    this.capture = new OutputCapture(sanitize, secrets);
    this.capture.observe = line => {
      const reason = databaseReason(line);
      if (reason !== "QUERY_FAILED") this.startupReason = reason;
    };
  }
  append(stream, chunk) {
    this.capture.append(stream, chunk);
    this.pending[stream] = this.capture.states[stream].pending;
  }
  attach(child) {
    this.child = child;
    child.on("spawn", () => { this.spawned = true; });
    child.on("error", error => {
      this.nativeCode = /^[A-Z][A-Z0-9_]{1,45}$/.test(error?.code ?? "") ? error.code : "UNCLASSIFIED";
      this.processError = true;
    });
    child.on("exit", (code, signal) => { this.exitObserved = true; this.exitCode = code; this.signal = signal; });
    child.on("close", () => {
      this.closed = true;
      for (const stream of ["stdout", "stderr"]) {
        this.capture.finish(stream);
        this.pending[stream] = "";
      }
    });
    for (const stream of ["stdout", "stderr"]) {
      child[stream]?.on("data", chunk => this.append(stream, chunk));
      child[stream]?.on("error", () => { this.truncated = true; });
    }
  }
  get failureKind() {
    if (this.processError) return this.spawned ? "PROCESS_ERROR" : "SPAWN_ERROR";
    if (this.exitObserved || Number.isInteger(this.child?.exitCode) || this.child?.signalCode)
      return this.signal || this.child?.signalCode ? "SIGNAL_EXIT" : "EARLY_EXIT";
    return null;
  }
  probe(reason, error) {
    this.readiness.attempts++;
    this.readiness.lastReason = REASONS.has(reason) ? reason : "QUERY_FAILED";
    this.readiness.lastExitCode = Number.isInteger(error?.exitCode) ? error.exitCode : undefined;
    this.readiness.nativeCode = /^[A-Z][A-Z0-9_]{1,45}$/.test(error?.nativeCode ?? "") ? error.nativeCode : undefined;
    for (const message of error?.databaseMessages ?? []) {
      const safe = this.sanitize(`${message.severity}: ${message.text}`);
      if (safe) {
        this.capture.add({ stream: "readiness", ...safe });
        this.messages.push({ stream: "readiness", ...safe });
        if (this.messages.length > 24) this.messages.shift();
      }
    }
  }
  snapshot() {
    const code = this.exitCode ?? this.child?.exitCode;
    const signal = this.signal ?? this.child?.signalCode;
    const output = this.capture.snapshot();
    return {
      spawned: this.spawned, failureKind: this.failureKind, nativeCode: this.nativeCode,
      exitCode: Number.isInteger(code) ? code : undefined,
      exitCodeHex: Number.isInteger(code) ? "0x" + (code >>> 0).toString(16).toUpperCase().padStart(8, "0") : undefined,
      signal: /^SIG[A-Z0-9]{1,12}$/.test(signal ?? "") ? signal : undefined,
      outputClosed: !!this.closed,
      capturedUtf8Bytes: Object.fromEntries(Object.entries(output.streams).map(([key, state]) => [key, state.decodedUtf8Bytes])),
      capturedRawBytes: Object.fromEntries(Object.entries(output.streams).map(([key, state]) => [key, state.rawBytes])),
      truncated: this.truncated || this.capture.truncated,
      outputAccounting: output.streams, rawRetention: output.rawRetention,
      discardedSanitizedMessages: output.discardedSanitizedMessages,
      partialOutputPending: !!(this.pending.stdout || this.pending.stderr),
      startupReason: REASONS.has(this.startupReason) ? this.startupReason : "UNCLASSIFIED_STARTUP_OUTPUT",
      readiness: { ...this.readiness },
      messages: output.messages,
    };
  }
}
module.exports = { DatabaseMonitor, databaseReason };
