// Undo/redo for the editor: a stack of document snapshots. Documents are
// treated as immutable (every edit is a structuredClone), so a snapshot is
// just a reference.

/** Edits with the same key within this many ms fold into one undo step: a
 * slider drag is one change, not two hundred. */
export const COALESCE_MS = 1000;

export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private lastKey: string | null = null;
  private lastAt = 0;

  constructor(private readonly limit = 100) {}

  /** Record the state *before* an edit. `key` names the control being
   * changed (coalescing); `now` is injectable for tests. */
  push(before: T, key?: string, now = Date.now()): void {
    // The same snapshot twice (React may call an updater twice) is one step.
    if (this.past.length > 0 && this.past[this.past.length - 1] === before) return;
    this.future = [];
    if (key && key === this.lastKey && now - this.lastAt < COALESCE_MS) {
      this.lastAt = now;
      return;
    }
    this.past.push(before);
    if (this.past.length > this.limit) this.past.shift();
    this.lastKey = key ?? null;
    this.lastAt = now;
  }

  /** The state before the last edit, given the current one; null when
   * there is nothing to undo. */
  undo(current: T): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(current);
    this.lastKey = null;
    return prev;
  }

  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(current);
    this.lastKey = null;
    return next;
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.lastKey = null;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }
}
