import { describe, expect, it } from 'vitest';
import { JobEvent } from '../../../interfaces/JobEvent';
import { computeTimingsFromEvents, getTaskTimings, parseProfileTasks } from './parseProfileTasks';

function event(partial: Partial<JobEvent> & { counter: number }): JobEvent {
  return {
    summary_fields: { job: { id: 1 } },
    ...partial,
  } as JobEvent;
}

const summaryStdout = [
  'PLAY RECAP *********************************************************************',
  'host : ok=3 changed=1 unreachable=0 failed=0',
  '',
  '===============================================================================',
  'Install package -------------------------------------------------------- 5.00s',
  'Restart service -------------------------------------------------------- 2.50s',
  'Gathering Facts -------------------------------------------------------- 1.20s',
].join('\r\n');

describe('parseProfileTasks', () => {
  it('should map recap durations to tasks in execution order', () => {
    const events = [
      event({ counter: 1, event: 'playbook_on_play_start', play: 'all' }),
      event({
        counter: 2,
        event: 'playbook_on_task_start',
        task: 'Gathering Facts',
        play: 'all',
        start_line: 2,
      }),
      event({
        counter: 4,
        event: 'playbook_on_task_start',
        task: 'Install package',
        play: 'all',
        start_line: 5,
      }),
      event({
        counter: 5,
        event: 'playbook_on_task_start',
        task: 'Restart service',
        play: 'all',
        start_line: 8,
      }),
      event({ counter: 6, event: 'playbook_on_stats', stdout: summaryStdout }),
    ];

    const timings = parseProfileTasks(events);

    expect(timings.map((timing) => timing.name)).toEqual([
      'Gathering Facts',
      'Install package',
      'Restart service',
    ]);
    expect(timings.map((timing) => timing.duration)).toEqual([1.2, 5, 2.5]);
    expect(timings.map((timing) => timing.line)).toEqual([2, 5, 8]);
  });

  it('should sort events by counter before extracting order', () => {
    const events = [
      event({ counter: 6, event: 'playbook_on_stats', stdout: summaryStdout }),
      event({
        counter: 4,
        event: 'playbook_on_task_start',
        task: 'Install package',
        start_line: 5,
      }),
      event({
        counter: 2,
        event: 'playbook_on_task_start',
        task: 'Gathering Facts',
        start_line: 2,
      }),
    ];

    const timings = parseProfileTasks(events);

    expect(timings.map((timing) => timing.name)).toEqual(['Gathering Facts', 'Install package']);
  });

  it('should read the task name from stdout when the task field is missing', () => {
    const events = [
      event({
        counter: 2,
        event: 'playbook_on_task_start',
        stdout: 'TASK [Install package] ********************************************',
        start_line: 2,
      }),
      event({ counter: 6, event: 'playbook_on_stats', stdout: summaryStdout }),
    ];

    const timings = parseProfileTasks(events);

    expect(timings).toHaveLength(1);
    expect(timings[0]).toMatchObject({ name: 'Install package', duration: 5 });
  });

  it('should return an empty array when there is no profile_tasks recap', () => {
    const events = [
      event({
        counter: 2,
        event: 'playbook_on_task_start',
        task: 'Install package',
        start_line: 2,
      }),
      event({ counter: 3, event: 'runner_on_ok', stdout: 'ok: [host]' }),
    ];

    expect(parseProfileTasks(events)).toEqual([]);
  });
});

describe('computeTimingsFromEvents', () => {
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

    const timings = computeTimingsFromEvents(events);

    expect(timings.map((timing) => timing.name)).toEqual(['First', 'Second']);
    // First: 20:00:05 - 20:00:00 = 5s; Second (uses stats): 20:00:07 - 20:00:05 = 2s
    expect(timings.map((timing) => timing.duration)).toEqual([5, 2]);
    expect(timings.map((timing) => timing.line)).toEqual([0, 3]);
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

    expect(computeTimingsFromEvents(events)).toEqual([]);
  });
});

describe('getTaskTimings', () => {
  it('should prefer profile_tasks recap durations when present', () => {
    const events = [
      event({
        counter: 2,
        event: 'playbook_on_task_start',
        task: 'Install package',
        start_line: 2,
        created: '2026-07-31T20:00:00.000Z',
      }),
      event({
        counter: 6,
        event: 'playbook_on_stats',
        stdout: 'Install package ------------------------------------------------- 5.00s',
        created: '2026-07-31T20:00:09.000Z',
      }),
    ];

    const timings = getTaskTimings(events);

    // profile_tasks recap says 5.00s, not the 9s wall-clock gap
    expect(timings).toEqual([expect.objectContaining({ name: 'Install package', duration: 5 })]);
  });

  it('should fall back to event timestamps when there is no recap', () => {
    const events = [
      event({
        counter: 1,
        event: 'playbook_on_task_start',
        task: 'Task A',
        created: '2026-07-31T20:00:00.000Z',
      }),
      event({
        counter: 2,
        event: 'playbook_on_stats',
        created: '2026-07-31T20:00:04.000Z',
      }),
    ];

    const timings = getTaskTimings(events);

    expect(timings).toEqual([expect.objectContaining({ name: 'Task A', duration: 4 })]);
  });
});
