/**
 * Tracks last-activity timestamps for PTY sessions and reports which ones
 * have just crossed an idle threshold, so a session is only reported once
 * per idle period — touch() (new output) clears the report so the next
 * quiet period can be reported again.
 */
export class IdleTracker {
  private lastActivity = new Map<string, number>();
  private reportedIdle = new Set<string>();

  touch(id: string, now = Date.now()): void {
    this.lastActivity.set(id, now);
    this.reportedIdle.delete(id);
  }

  remove(id: string): void {
    this.lastActivity.delete(id);
    this.reportedIdle.delete(id);
  }

  /** Returns session ids that just crossed `thresholdMs` of inactivity since the last check. */
  checkIdle(thresholdMs: number, now = Date.now()): string[] {
    const idle: string[] = [];
    for (const [id, last] of this.lastActivity) {
      if (this.reportedIdle.has(id)) continue;
      if (now - last >= thresholdMs) {
        this.reportedIdle.add(id);
        idle.push(id);
      }
    }
    return idle;
  }
}
