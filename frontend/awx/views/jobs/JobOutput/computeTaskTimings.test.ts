import { describe, expect, it } from 'vitest';
import { JobEvent } from '../../../interfaces/JobEvent';
import { computeTaskTimings } from './computeTaskTimings';

function event(partial: Partial<JobEvent> & { counter: number }): JobEvent {
  return {
    summary_fields: { job: { id: 1 } },
    ...partial,
  } as JobEvent;
}

describe('computeTaskTimings', () => {
  it('should derive durations from consecutive task-start timestamps', () => {
    const events = [
      event({
        counter: 1,
        event: 'playbook_on_task_start',
        task: 'First',
        start_line: 0,
        created: '2026-07-31T20:00:00.000Z',
      }),
      event({
        counter: 2,
        event: 'playbook_on_task_start',
        task: 'Second',
        start_line: 3,
        created: '2026-07-31T20:00:05.000Z',
      }),
      event({
        counter: 3,
        event: 'playbook_on_stats',
        created: '2026-07-31T20:00:07.000Z',
      }),
    ];

    const timings = computeTaskTimings(events);

    expect(timings.map((timing) => timing.name)).toEqual(['First', 'Second']);
    // First: 20:00:05 - 20:00:00 = 5s; Second (uses stats): 20:00:07 - 20:00:05 = 2s
    expect(timings.map((timing) => timing.duration)).toEqual([5, 2]);
    expect(timings.map((timing) => timing.line)).toEqual([0, 3]);
  });

  it('should sort events by counter before deriving order', () => {
    const events = [
      event({
        counter: 3,
        event: 'playbook_on_stats',
        created: '2026-07-31T20:00:07.000Z',
      }),
      event({
        counter: 2,
        event: 'playbook_on_task_start',
        task: 'Second',
        created: '2026-07-31T20:00:05.000Z',
      }),
      event({
        counter: 1,
        event: 'playbook_on_task_start',
        task: 'First',
        created: '2026-07-31T20:00:00.000Z',
      }),
    ];

    expect(computeTaskTimings(events).map((timing) => timing.name)).toEqual(['First', 'Second']);
  });

  it('should read the task name from stdout when the task field is missing', () => {
    const events = [
      event({
        counter: 1,
        event: 'playbook_on_task_start',
        stdout: 'TASK [Install package] ********************************************',
        created: '2026-07-31T20:00:00.000Z',
      }),
      event({
        counter: 2,
        event: 'playbook_on_stats',
        created: '2026-07-31T20:00:03.000Z',
      }),
    ];

    expect(computeTaskTimings(events)).toEqual([
      expect.objectContaining({ name: 'Install package', duration: 3 }),
    ]);
  });

  it('should skip tasks without a resolvable end timestamp', () => {
    const events = [
      event({
        counter: 1,
        event: 'playbook_on_task_start',
        task: 'Only task',
        created: '2026-07-31T20:00:00.000Z',
      }),
    ];

    expect(computeTaskTimings(events)).toEqual([]);
  });
});
