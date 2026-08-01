import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { awxAPI } from '../../common/api/awx-utils';
import { SchedulesOverview } from './SchedulesOverview';

const sched = (id: number, name: string, rrule: string, unified_job_type = 'job') => ({
  id,
  name,
  enabled: true,
  rrule,
  summary_fields: {
    unified_job_template: {
      id: 6,
      name: 'Demo',
      description: '',
      unified_job_type,
      job_type: 'run',
    },
    user_capabilities: { edit: true, delete: true },
  },
});

const server = setupServer(
  http.get(awxAPI`/schedules/`, () =>
    HttpResponse.json({
      count: 2,
      next: null,
      previous: null,
      results: [
        sched(
          5,
          'Nightly DB Backup',
          'DTSTART:20260801T000000Z RRULE:FREQ=DAILY;BYHOUR=2;BYMINUTE=0'
        ),
        sched(
          1,
          'Cleanup Job',
          'DTSTART:20260801T000000Z RRULE:FREQ=WEEKLY;BYDAY=SU',
          'system_job'
        ),
      ],
    })
  )
);

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('SchedulesOverview verify', () => {
  it('has no invalid DOM nesting and opens a popover on cell click', async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((msg: unknown) => {
      errors.push(String(msg));
    });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <SchedulesOverview />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Scheduled job runs')).toBeInTheDocument());

    const nestingWarnings = errors.filter((e) => e.includes('validateDOMNesting'));
    expect(nestingWarnings).toEqual([]);

    // A populated slot (Nightly DB Backup runs at 02:00 UTC daily) is a clickable button.
    const cellButtons = screen.getAllByRole('button').filter((b) => b.getAttribute('title'));
    expect(cellButtons.length).toBeGreaterThan(0);
    await user.click(cellButtons[0]);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Nightly DB Backup|Cleanup Job/)).toBeVisible();

    spy.mockRestore();
  });
});
