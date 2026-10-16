import type { QueryClient, QueryKey } from "@tanstack/react-query";

export type SyncStatus = "idle" | "required" | "syncing" | "current" | "editing" | "failed";
export type EditLease = { key: QueryKey; changed: boolean; notify: () => void };
const matches = (a: QueryKey, b: QueryKey) =>
  a.every((value, i) => JSON.stringify(value) === JSON.stringify(b[i])) ||
  b.every((value, i) => JSON.stringify(value) === JSON.stringify(a[i]));

/** Per-auth-generation coordinator. No global cache or draft shared between accounts. */
export class RealtimeSync {
  private edits = new Set<EditLease>();
  private pending = new Map<string, QueryKey>();
  private running: Promise<void> | null = null;
  private inFlight: QueryKey[] = [];
  private disposed = false;
  private generation = 0;
  constructor(private client: QueryClient, private status: (value: SyncStatus) => void) {}
  activate() { this.disposed = false; }

  edit(lease: EditLease) {
    this.edits.add(lease);
    return () => {
      this.edits.delete(lease);
      if (lease.changed) void this.refresh([lease.key]);
    };
  }

  required() {
    if (this.disposed) return;
    // A previously started refresh cannot declare freshness after authority/transport loss.
    this.generation++;
    this.running = null;
    this.pending.clear();
    const interrupted = this.inFlight;
    this.inFlight = [];
    if (interrupted.length) {
      void this.client.cancelQueries({
        predicate: query => interrupted.some(key => matches(key, query.queryKey)),
      });
    }
    this.status("required");
  }

  refresh(keys: readonly QueryKey[]): Promise<void> {
    if (this.disposed) return Promise.resolve();
    for (const key of keys) {
      const protectedEdits = [...this.edits].filter(edit => matches(key, edit.key));
      for (const edit of protectedEdits) { edit.changed = true; edit.notify(); }
      this.pending.set(JSON.stringify(key), key);
    }
    if (this.running) return this.running;
    const generation = this.generation;
    const active = () => !this.disposed && generation === this.generation;
    // Coalesce events in the same frame; events during a fetch form one subsequent wave.
    this.running = Promise.resolve().then(async () => {
      let wave: QueryKey[] = [];
      try {
        while (active() && this.pending.size) {
          this.status("syncing");
          wave = [...this.pending.values()];
          this.inFlight = wave;
          this.pending.clear();
          const predicate = (query: { queryKey: QueryKey }) =>
            wave.some(key => matches(key, query.queryKey)) &&
            ![...this.edits].some(edit => matches(edit.key, query.queryKey));
          await this.client.cancelQueries({ predicate });
          if (!active()) return;
          await this.client.invalidateQueries(
            { predicate, refetchType: "active" }, { throwOnError: true },
          );
        }
        if (active()) this.status([...this.edits].some(e => e.changed) ? "editing" : "current");
      } catch {
        if (active()) {
          for (const key of wave) this.pending.set(JSON.stringify(key), key);
          this.status("failed");
        }
      } finally { if (active()) { this.running = null; this.inFlight = []; } }
    });
    return this.running;
  }

  dispose() {
    this.disposed = true;
    this.generation++;
    this.running = null;
    this.inFlight = [];
    this.pending.clear();
    this.edits.clear();
    // Removed queries cannot commit late results to the next account's cache.
    void this.client.cancelQueries();
    this.client.clear();
  }
}
