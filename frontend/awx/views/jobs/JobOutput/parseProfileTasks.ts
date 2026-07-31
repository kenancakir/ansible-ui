import { JobEvent } from '../../../interfaces/JobEvent';

export interface ProfileTaskTiming {
  counter: number;
  line: number;
  name: string;
  play?: string;
  duration: number; // seconds
}

// profile_tasks recap line, e.g. "Gathering Facts ------------------------ 2.35s"
const SUMMARY_LINE = /^(.+?)\s-{3,}\s*([\d.]+)s\s*$/;
// task banner, e.g. "TASK [Install packages] ****" or "RUNNING HANDLER [restart] ***"
const TASK_HEADER = /(?:TASK|RUNNING HANDLER)\s\[(.+?)\]/;

function eventLines(event: JobEvent): string[] {
  return event.stdout ? event.stdout.split(/\r?\n/) : [];
}

function parseSummaryDurations(events: JobEvent[]): Map<string, number[]> {
  const durations = new Map<string, number[]>();
  for (const event of events) {
    for (const rawLine of eventLines(event)) {
      const match = SUMMARY_LINE.exec(rawLine);
      if (!match) continue;
      const name = match[1].trim();
      const seconds = Number(match[2]);
      if (!name || Number.isNaN(seconds)) continue;
      const existing = durations.get(name) ?? [];
      existing.push(seconds);
      durations.set(name, existing);
    }
  }
  return durations;
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
 * Extracts per-task timings produced by the ansible profile_tasks callback plugin
 * from a job's events. Durations come from the recap table the plugin prints at the
 * end of the run; execution order and the output line to jump to come from the
 * playbook_on_task_start events. Returns an empty array when the job has no
 * profile_tasks output.
 */
export function parseProfileTasks(events: JobEvent[]): ProfileTaskTiming[] {
  const ordered = [...events].sort((a, b) => a.counter - b.counter);

  const durationsByName = parseSummaryDurations(ordered);
  if (durationsByName.size === 0) return [];

  const remaining = new Map<string, number[]>();
  durationsByName.forEach((values, name) => remaining.set(name, [...values]));

  const timings: ProfileTaskTiming[] = [];
  for (const event of ordered) {
    if (event.event !== 'playbook_on_task_start') continue;
    const name = getTaskName(event);
    if (!name) continue;
    const queue = remaining.get(name);
    if (!queue || queue.length === 0) continue;
    const duration = queue.shift() as number;
    timings.push({
      counter: event.counter,
      line: event.start_line ?? 0,
      name,
      play: event.play,
      duration,
    });
  }
  return timings;
}

/**
 * Computes per-task timings from the events' own timestamps, without needing the
 * profile_tasks callback. Each task's duration is the wall-clock time between its
 * playbook_on_task_start event and the next task start (or the playbook_on_stats
 * event for the last task). Always available for any AWX job.
 */
export function computeTimingsFromEvents(events: JobEvent[]): ProfileTaskTiming[] {
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

/**
 * Returns task timings for the heatmap, preferring the precise profile_tasks recap
 * when present and falling back to the events' timestamps otherwise.
 */
export function getTaskTimings(events: JobEvent[]): ProfileTaskTiming[] {
  const profileTimings = parseProfileTasks(events);
  if (profileTimings.length > 0) return profileTimings;
  return computeTimingsFromEvents(events);
}
