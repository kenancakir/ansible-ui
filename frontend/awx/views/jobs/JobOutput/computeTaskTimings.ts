import { JobEvent } from '../../../interfaces/JobEvent';

export interface ProfileTaskTiming {
  counter: number;
  line: number;
  name: string;
  play?: string;
  duration: number; // seconds
}

// task banner, e.g. "TASK [Install packages] ****" or "RUNNING HANDLER [restart] ***"
const TASK_HEADER = /(?:TASK|RUNNING HANDLER)\s\[(.+?)\]/;

function eventLines(event: JobEvent): string[] {
  return event.stdout ? event.stdout.split(/\r?\n/) : [];
}

function getTaskName(event: JobEvent): string {
  if (event.task) return event.task;
  for (const rawLine of eventLines(event)) {
    const match = TASK_HEADER.exec(rawLine);
    if (match) return match[1];
  }
  return '';
}

/**
 * Computes per-task timings from the events' own timestamps. Each task's duration is
 * the wall-clock time between its playbook_on_task_start event and the next task start
 * (or the playbook_on_stats event for the last task). Execution order and the output
 * line to jump to come from the playbook_on_task_start events. Available for any AWX
 * job without extra configuration.
 */
export function computeTaskTimings(events: JobEvent[]): ProfileTaskTiming[] {
  const ordered = [...events].sort((a, b) => a.counter - b.counter);
  const tasks = ordered.filter((event) => event.event === 'playbook_on_task_start');
  const stats = ordered.find((event) => event.event === 'playbook_on_stats');

  const timings: ProfileTaskTiming[] = [];
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const name = getTaskName(task);
    if (!name) continue;
    const start = task.created ? Date.parse(task.created) : NaN;
    const nextEvent = i + 1 < tasks.length ? tasks[i + 1] : stats;
    const end = nextEvent?.created ? Date.parse(nextEvent.created) : NaN;
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    timings.push({
      counter: task.counter,
      line: task.start_line ?? 0,
      name,
      play: task.play,
      duration: Math.max((end - start) / 1000, 0),
    });
  }
  return timings;
}
