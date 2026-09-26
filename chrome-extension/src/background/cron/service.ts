// ── CronService facade ──────────────────────

import * as ops from './service/ops';
import { createCronState } from './service/state';
import { onAlarm, CRON_ALARM_NAME } from './service/timer';
import type { CronDeps } from './service/state';
import type { ScheduledTaskCreate, ScheduledTaskPatch } from './types';

class CronService {
  private readonly state;

  constructor(deps: CronDeps) {
    this.state = createCronState(deps);
  }

  async start() {
    await ops.start(this.state);
  }

  stop() {
    ops.stop();
  }

  async status() {
    return ops.status(this.state);
  }

  async list(opts?: { includeDisabled?: boolean }) {
    return ops.list(this.state, opts);
  }

  async add(input: ScheduledTaskCreate) {
    return ops.add(this.state, input);
  }

  async update(id: string, patch: ScheduledTaskPatch) {
    return ops.update(this.state, id, patch);
  }

  async remove(id: string) {
    return ops.remove(this.state, id);
  }

  async run(id: string, mode?: 'due' | 'force') {
    return ops.run(this.state, id, mode);
  }

  /** Handle a chrome.alarms event for the cron alarm */
  async handleAlarm() {
    await onAlarm(this.state);
  }

  /** Check if an alarm name belongs to this service */
  static isSchedulerAlarm(name: string): boolean {
    return name === CRON_ALARM_NAME;
  }
}

export { CronService };
export type { CronEvent, CronDeps, CronStatusSummary } from './service/state';
