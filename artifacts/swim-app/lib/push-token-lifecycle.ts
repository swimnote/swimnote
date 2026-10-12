/**
 * One device, one serialized registration/cleanup path.
 * Auth identity is supplied by the authenticated API, never decoded locally.
 */
export const PUSH_DEVICE_TOKEN_KEY = "push_device_expo_token";

/** Cleanup must not invoke apiRequest's automatic logout callback recursively. */
export function createPushTokenCleanupRequest(apiBase: string) {
  return async (authToken: string, path: string, options: { method: string; body: string }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch(apiBase + path, {
        ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("단말 PUSH 토큰 정리에 실패했습니다. 다시 시도해 주세요.");
    } finally { clearTimeout(timeout); }
  };
}

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};
type Request = (
  authToken: string, path: string,
  options: { method: string; body: string },
) => Promise<unknown>;
type Session = { authToken: string; parentAccountId: string | null; generation: number };
type Registration = Session & { deviceToken: string };

export function createPushTokenLifecycle() {
  let generation = 0;
  let session: Session | null = null;
  let registered: Registration | null = null;
  let closingAuth: string | null = null;
  let resolveDeviceToken: (() => Promise<string | null>) | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  function serial<T>(task: () => Promise<T>): Promise<T> {
    const result = queue.then(task, task);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }

  function beginSession(authToken: string | null, parentAccountId: string | null = null): Session | null {
    // Foreground/token listeners must not start another POST while logout drains.
    if (authToken && closingAuth === authToken) return null;
    if (session?.authToken !== authToken || session?.parentAccountId !== parentAccountId) {
      generation++;
      session = authToken ? { authToken, parentAccountId, generation } : null;
    }
    if (!authToken || (closingAuth && closingAuth !== authToken)) closingAuth = null;
    return session;
  }

  function register(handle: Session, deviceToken: string, request: Request, storage: Storage) {
    return serial(async () => {
      if (!deviceToken || session?.generation !== handle.generation || closingAuth === handle.authToken) return false;
      if (registered?.authToken === handle.authToken &&
          registered.parentAccountId === handle.parentAccountId &&
          registered.deviceToken === deviceToken) return true;
      await request(handle.authToken, "/push-token", {
        method: "POST",
        body: JSON.stringify({ token: deviceToken, parent_account_id: handle.parentAccountId }),
      });
      // Track a completed in-flight POST even if logout invalidated its generation:
      // queued logout must delete exactly this device's resulting binding.
      registered = { ...handle, deviceToken };
      await storage.setItem(PUSH_DEVICE_TOKEN_KEY, deviceToken);
      return true;
    });
  }

  function logout(authToken: string | null, request: Request, storage: Storage) {
    if (session && session.authToken !== authToken) {
      return Promise.reject(new Error("PUSH_LOGOUT_SESSION_CHANGED"));
    }
    const previous = session;
    const logoutGeneration = ++generation;
    session = null;
    closingAuth = authToken;
    return serial(async () => {
      try {
        // First OTA upgrade may predate our persisted key: resolve this device's
        // Expo token without POSTing it or requesting permission again.
        const deviceToken = registered?.deviceToken ?? await storage.getItem(PUSH_DEVICE_TOKEN_KEY) ??
          await resolveDeviceToken?.();
        if (authToken && deviceToken) {
          await request(authToken, "/push-token", {
            method: "DELETE", body: JSON.stringify({ token: deviceToken }),
          });
        }
        // A late logout completion must not clear a newer account's local auth.
        if (generation !== logoutGeneration) throw new Error("PUSH_LOGOUT_SESSION_CHANGED");
        await storage.removeItem(PUSH_DEVICE_TOKEN_KEY);
        registered = null;
        if (generation !== logoutGeneration) throw new Error("PUSH_LOGOUT_SESSION_CHANGED");
      } catch (error) {
        // Fail explicitly: caller keeps local auth so server cleanup can be retried.
        if (generation === logoutGeneration) {
          closingAuth = null;
          session = previous ? { ...previous, generation: ++generation } : null;
        }
        throw error;
      }
    });
  }

  return { beginSession, register, logout,
    setDeviceTokenResolver(resolver: () => Promise<string | null>) { resolveDeviceToken = resolver; },
  };
}

export const pushTokenLifecycle = createPushTokenLifecycle();
