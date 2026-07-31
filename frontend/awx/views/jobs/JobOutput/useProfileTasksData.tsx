import { requestGet } from '@ansible/common-ui/crud/Data';
import { useEffect, useRef, useState } from 'react';
import { AwxItemsResponse } from '../../../common/AwxItemsResponse';
import { awxAPI } from '../../../common/api/awx-utils';
import { Job } from '../../../interfaces/Job';
import { JobEvent } from '../../../interfaces/JobEvent';
import { ProfileTaskTiming, computeTaskTimings } from './computeTaskTimings';

const PAGE_SIZE = 200;
const MAX_PAGES = 100;

/**
 * Fetches all events for a job (once, on demand) and extracts profile_tasks
 * timings from them. Only fetches while `enabled` is true, e.g. when the heatmap
 * modal is open.
 */
export function useProfileTasksData(job: Job, enabled: boolean) {
  const [timings, setTimings] = useState<ProfileTaskTiming[] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);
  const hasFetched = useRef(false);

  useEffect(() => {
    if (!enabled || hasFetched.current) return;
    hasFetched.current = true;

    const eventsSlug = job.type === 'job' ? 'job_events' : 'events';
    let cancelled = false;
    setIsLoading(true);
    setError(undefined);

    const fetchAll = async () => {
      const events: JobEvent[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const response = await requestGet<AwxItemsResponse<JobEvent>>(
          awxAPI`/${job.type}s/${job.id.toString()}/${eventsSlug}/`.concat(
            `?order_by=counter&page=${page}&page_size=${PAGE_SIZE}`
          )
        );
        events.push(...response.results);
        if (!response.next || response.results.length === 0) break;
      }
      return events;
    };

    void fetchAll()
      .then((events) => {
        if (!cancelled) setTimings(computeTaskTimings(events));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error('Failed to load events'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, job.id, job.type]);

  return { timings, isLoading, error };
}
