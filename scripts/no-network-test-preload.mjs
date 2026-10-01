/**
 * Optional preload for no-database regression runs:
 * NODE_OPTIONS="--import ./scripts/no-network-test-preload.mjs" pnpm ... test
 * Mocked clients remain usable; real outbound TCP connections fail closed.
 * Unix-domain IPC and ephemeral localhost HTTP test servers are permitted.
 */
import net from "node:net";

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = args[0];
  // Node normalizes some connect() calls to [options, callback].
  const options = Array.isArray(first) ? first[0] : first;
  const unixPath = typeof options === "string" && !/^\d+$/.test(options);
  if (unixPath || (options && typeof options === "object" && options.path)) {
    return originalConnect.apply(this, args);
  }
  const port = Number(typeof options === "object" ? options?.port : options);
  const host = typeof options === "object" ? options?.host : args[1];
  const local = !host || ["127.0.0.1", "::1", "localhost"].includes(host);
  if (local && port >= 1024 && ![5432, 5433, 6432, 6543, 8080].includes(port)) {
    return originalConnect.apply(this, args);
  }
  throw new Error("NO_NETWORK_TEST: outbound/DB connection prohibited");
};