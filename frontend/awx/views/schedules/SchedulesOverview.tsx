import { EmptyStateNoData } from '@ansible/ansible-ui-framework/components/EmptyStateNoData';
import { LoadingPage } from '@ansible/ansible-ui-framework/components/LoadingPage';
import { useGetPageUrl } from '@ansible/ansible-ui-framework';
import {
  Card,
  CardBody,
  CardTitle,
  Content,
  Flex,
  FlexItem,
  List,
  ListItem,
  Popover,
} from '@patternfly/react-core';
import { ReactNode, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { RRuleSet, rrulestr } from 'rrule';
import styled from 'styled-components';
import { AwxError } from '../../common/AwxError';
import { awxAPI } from '../../common/api/awx-utils';
import { useAwxGetAllPages } from '../../common/useAwxGetAllPages';
import { Schedule } from '../../interfaces/Schedule';
import { useGetScheduleUrl } from './hooks/useGetScheduleUrl';

// JS Date.getDay() returns 0=Sunday..6=Saturday. Display Monday first.
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const WINDOW_DAYS = 7;
// Cap occurrences per schedule to avoid freezing on very frequent (e.g. minutely) rules.
const MAX_OCCURRENCES_PER_SCHEDULE = 2000;
// Number of shading steps, mapped to the PatternFly blue chart color scale.
const INTENSITY_LEVELS = 5;

// Level 0 = no runs; levels 1..5 map to the PatternFly blue chart tokens.
const LEVEL_BACKGROUNDS = [
  'var(--pf-t--global--background--color--secondary--default)',
  'var(--pf-t--chart--color--blue--100)',
  'var(--pf-t--chart--color--blue--200)',
  'var(--pf-t--chart--color--blue--300)',
  'var(--pf-t--chart--color--blue--400)',
  'var(--pf-t--chart--color--blue--500)',
];

interface HeatmapCell {
  runs: number;
  schedules: Schedule[];
}

const ScrollContainer = styled.div`
  overflow-x: auto;
  padding-bottom: var(--pf-t--global--spacer--sm);
`;

const HeatmapTable = styled.table`
  border-collapse: separate;
  border-spacing: var(--pf-t--global--spacer--xs);
`;

const HourHeader = styled.th`
  font-weight: var(--pf-t--global--font--weight--body--default);
  font-size: var(--pf-t--global--font--size--xs);
  color: var(--pf-t--global--text--color--subtle);
  text-align: center;
`;

const DayHeader = styled.th`
  font-weight: var(--pf-t--global--font--weight--body--default);
  font-size: var(--pf-t--global--font--size--sm);
  color: var(--pf-t--global--text--color--regular);
  text-align: right;
  padding-right: var(--pf-t--global--spacer--sm);
  white-space: nowrap;
`;

const CellTd = styled.td`
  padding: 0;
  line-height: 0;
`;

const CellButton = styled.button<{ $level: number }>`
  display: block;
  width: 1.75rem;
  height: 1.75rem;
  padding: 0;
  border-radius: var(--pf-t--global--border--radius--small);
  border: 1px solid var(--pf-t--global--border--color--default);
  background-color: ${({ $level }) => LEVEL_BACKGROUNDS[$level]};
  cursor: ${({ $level }) => ($level > 0 ? 'pointer' : 'default')};
  &:not(:disabled):hover {
    outline: 2px solid var(--pf-t--global--border--color--brand--default);
  }
`;

const LegendSwatch = styled.span<{ $level: number }>`
  display: inline-block;
  width: 1rem;
  height: 1rem;
  border-radius: var(--pf-t--global--border--radius--small);
  border: 1px solid var(--pf-t--global--border--color--default);
  background-color: ${({ $level }) => LEVEL_BACKGROUNDS[$level]};
`;

const PopoverList = styled.div`
  max-height: 15rem;
  overflow-y: auto;
`;

function intensityLevel(runs: number, max: number): number {
  if (runs <= 0 || max <= 0) return 0;
  return Math.min(INTENSITY_LEVELS, Math.ceil((runs / max) * INTENSITY_LEVELS));
}

function buildHeatmap(schedules: Schedule[]): {
  cells: HeatmapCell[][];
  max: number;
  total: number;
} {
  // Per slot keep the run count (for colour) and the distinct schedules (for the popover).
  const runs: number[][] = DAY_ORDER.map(() => HOURS.map(() => 0));
  const scheduleMaps = DAY_ORDER.map(() => HOURS.map(() => new Map<number, Schedule>()));
  const start = new Date();
  const end = new Date(start.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);
  let max = 0;
  let total = 0;

  for (const schedule of schedules) {
    if (!schedule.enabled || !schedule.rrule) continue;
    let occurrences: Date[] = [];
    try {
      const ruleSet = rrulestr(schedule.rrule, { forceset: true }) as RRuleSet;
      occurrences = ruleSet.between(
        start,
        end,
        true,
        (_date, index) => index < MAX_OCCURRENCES_PER_SCHEDULE
      );
    } catch {
      // Skip schedules with an rrule the parser cannot handle.
      continue;
    }
    for (const occurrence of occurrences) {
      const dayIndex = DAY_ORDER.indexOf(occurrence.getDay());
      const hour = occurrence.getHours();
      runs[dayIndex][hour] += 1;
      scheduleMaps[dayIndex][hour].set(schedule.id, schedule);
      total += 1;
      if (runs[dayIndex][hour] > max) max = runs[dayIndex][hour];
    }
  }

  const cells: HeatmapCell[][] = runs.map((row, dayIndex) =>
    row.map((count, hour) => ({
      runs: count,
      schedules: Array.from(scheduleMaps[dayIndex][hour].values()),
    }))
  );

  return { cells, max, total };
}

export function SchedulesOverview() {
  const { t } = useTranslation();
  const getPageUrl = useGetPageUrl();
  const getScheduleUrl = useGetScheduleUrl();
  const { results, error, isLoading, refresh } = useAwxGetAllPages<Schedule>(awxAPI`/schedules/`);

  const dayLabels = useMemo(
    () => [
      t('Monday'),
      t('Tuesday'),
      t('Wednesday'),
      t('Thursday'),
      t('Friday'),
      t('Saturday'),
      t('Sunday'),
    ],
    [t]
  );

  const { cells, max, total } = useMemo(() => buildHeatmap(results ?? []), [results]);

  const getScheduleHref = useCallback(
    (schedule: Schedule): string | undefined => {
      const url = getScheduleUrl('details', schedule);
      if (!url || typeof url === 'string') return undefined;
      return getPageUrl(url.pageId, { params: url.params });
    },
    [getScheduleUrl, getPageUrl]
  );

  const renderPopoverBody = useCallback(
    (cell: HeatmapCell): ReactNode => (
      <PopoverList>
        <Content component="small">
          {t('{{runs}} runs from {{schedules}} schedule(s)', {
            runs: cell.runs,
            schedules: cell.schedules.length,
          })}
        </Content>
        <List isPlain>
          {cell.schedules.map((schedule) => {
            const href = getScheduleHref(schedule);
            return (
              <ListItem key={schedule.id}>
                {href ? <Link to={href}>{schedule.name}</Link> : <span>{schedule.name}</span>}
              </ListItem>
            );
          })}
        </List>
      </PopoverList>
    ),
    [t, getScheduleHref]
  );

  if (isLoading && !results) return <LoadingPage />;
  if (error) return <AwxError error={error} handleRefresh={refresh} />;
  if (total === 0) {
    return (
      <EmptyStateNoData
        title={t('No scheduled job runs')}
        description={t(
          'There are no enabled schedules with job runs in the next 7 days that you have access to.'
        )}
      />
    );
  }

  const slotLabel = (dayLabel: string, hour: number): string =>
    t('{{day}}, {{start}}–{{end}}', {
      day: dayLabel,
      start: `${hour.toString().padStart(2, '0')}:00`,
      end: `${((hour + 1) % 24).toString().padStart(2, '0')}:00`,
    });

  return (
    <Card>
      <CardTitle>{t('Scheduled job runs over the next 7 days')}</CardTitle>
      <CardBody>
        <Content component="p">
          {t(
            'Only enabled schedules you have access to are shown, bucketed by weekday and hour in your local time zone. Click a cell to see and open its schedules. Total runs: {{total}}.',
            { total }
          )}
        </Content>
        <ScrollContainer>
          <HeatmapTable>
            <thead>
              <tr>
                <th />
                {HOURS.map((hour) => (
                  <HourHeader key={hour} scope="col">
                    {hour.toString().padStart(2, '0')}
                  </HourHeader>
                ))}
              </tr>
            </thead>
            <tbody>
              {dayLabels.map((dayLabel, dayIndex) => (
                <tr key={dayLabel}>
                  <DayHeader scope="row">{dayLabel}</DayHeader>
                  {HOURS.map((hour) => {
                    const cell = cells[dayIndex][hour];
                    const level = intensityLevel(cell.runs, max);
                    const label = slotLabel(dayLabel, hour);
                    const button = (
                      <CellButton
                        $level={level}
                        type="button"
                        disabled={cell.runs === 0}
                        aria-label={label}
                        title={cell.runs > 0 ? label : undefined}
                      />
                    );
                    return (
                      <CellTd key={hour}>
                        {cell.runs > 0 ? (
                          <Popover headerContent={label} bodyContent={renderPopoverBody(cell)}>
                            {button}
                          </Popover>
                        ) : (
                          button
                        )}
                      </CellTd>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </HeatmapTable>
        </ScrollContainer>
        <Flex
          alignItems={{ default: 'alignItemsCenter' }}
          spaceItems={{ default: 'spaceItemsXs' }}
          style={{ marginTop: 'var(--pf-t--global--spacer--md)' }}
        >
          <FlexItem>
            <Content component="small">{t('Fewer')}</Content>
          </FlexItem>
          {[0, 1, 2, 3, 4, 5].map((level) => (
            <FlexItem key={level}>
              <LegendSwatch $level={level} />
            </FlexItem>
          ))}
          <FlexItem>
            <Content component="small">{t('More')}</Content>
          </FlexItem>
        </Flex>
      </CardBody>
    </Card>
  );
}
