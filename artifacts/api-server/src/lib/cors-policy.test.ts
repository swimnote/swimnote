import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import cors from "cors";
import type { Server } from "node:http";
import { createCorsOptions, OriginDeniedError } from "./cors-policy";

let server: Server;
let base: string;
beforeAll(async () => {
  // Isolated HTTP harness: no app.ts import, database, jobs or real accounts.
  const app = express();
  app.use(cors(createCorsOptions("production")));
  app.use(express.json());
  app.post(["/api/auth/login", "/api/auth/web-pin/verify", "/api/auth/totp/verify-login"],
    (_req, res) => { res.status(401).json({ fixture: "auth-route-reached" }); });
  app.get(["/api/auth/me", "/api/pools/my-pools", "/api/pools/x-mode", "/api/admin/events/stream"],
    (_req, res) => { res.status(401).json({ fixture: "protected-route-reached" }); });
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err instanceof OriginDeniedError ? 403 : 500).json({ error: "denied" });
  });
  server = await new Promise<Server>(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())));

describe("production CORS HTTP boundary (synthetic route handlers)", () => {
  it.each([
    ["/auth/login", "POST", "content-type"],
    ["/auth/web-pin/verify", "POST", "content-type"],
    ["/auth/totp/verify-login", "POST", "content-type"],
    ["/auth/me", "GET", "authorization"],
    ["/pools/my-pools", "GET", "authorization"],
    ["/pools/x-mode", "GET", "authorization"],
    ["/admin/events/stream", "GET", "authorization,accept,cache-control"],
  ])("preflight and actual request reach %s without bypassing auth", async (route, method, headers) => {
    const preflight = await fetch(`${base}/api${route}`, { method: "OPTIONS", headers: {
      Origin: "app://office", "Access-Control-Request-Method": method,
      "Access-Control-Request-Headers": headers,
    } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("app://office");
    expect(preflight.headers.get("access-control-allow-credentials")).toBe("true");
    expect(preflight.headers.get("access-control-allow-headers")).toBe(headers);
    expect(preflight.headers.get("access-control-allow-methods")?.split(",")).toContain(method);
    const actual = await fetch(`${base}/api${route}`, { method, headers: {
      Origin: "app://office", ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    }, ...(method === "POST" ? { body: "{}" } : {}) });
    expect(actual.status).toBe(401);
    expect(actual.headers.get("access-control-allow-origin")).toBe("app://office");
  });
  it.each(["null", "app://other", "app://office.evil", "app://office/", "app://office:99",
    "app://OFFICE", "https://evil.example", "https://swimnote.kr.evil.example"])(
    "rejects %s with 403, not 500, and no allow-origin", async origin => {
      for (const method of ["OPTIONS", "POST"]) {
        const response = await fetch(`${base}/api/auth/login`, { method, headers: {
          Origin: origin, "Access-Control-Request-Method": "POST",
        } });
        expect(response.status).toBe(403);
        expect(response.headers.get("access-control-allow-origin")).toBeNull();
      }
    });
  it.each(["https://swimnote.kr", "https://www.swimnote.kr", "https://test.onrender.com",
    "https://test.replit.app", "https://test.expo.dev", "https://test.replit.dev"])(
    "preserves existing allowed web origin %s", async origin => {
      const response = await fetch(`${base}/api/auth/me`, { headers: { Origin: origin } });
      expect(response.status).toBe(401);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
      expect(response.headers.get("vary")).toContain("Origin");
    });
  it("preserves native clients without an Origin header", async () => {
    expect((await fetch(`${base}/api/auth/me`)).status).toBe(401);
  });
  it("keeps development web policy but rejects opaque and alternate app origins", () => {
    const origin = createCorsOptions("development").origin as
      (origin: string, callback: (error: Error | null, allowed?: boolean) => void) => void;
    origin("http://localhost:5173", (error, allowed) => { expect(error).toBeNull(); expect(allowed).toBe(true); });
    for (const value of ["null", "app://other"]) {
      origin(value, error => expect(error).toBeInstanceOf(OriginDeniedError));
    }
  });
});
