import { useGetPageUrl } from '@ansible/ansible-ui-framework';
import { DateTimeCell } from '@ansible/ansible-ui-framework/PageCells/DateTimeCell';
import { Scrollable } from '@ansible/ansible-ui-framework/components/Scrollable';
import { EmptyStateNoData } from '@ansible/ansible-ui-framework/components/EmptyStateNoData';
import { LoadingPage } from '@ansible/ansible-ui-framework/components/LoadingPage';
import {
  Card,
  CardBody,
  CardTitle,
  Content,
  Flex,
  FlexItem,
  Grid,
  GridItem,
  List,
  ListItem,
  NumberInput,
  Popover,
  ToggleGroup,
  ToggleGroupItem,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { ExclamationTriangleIcon } from '@patternfly/react-icons';
import { ReactNode, useCallback, useMemo, useRef, useState } from 'react';
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
// Cap occurrences per schedule to avoid freezing on very frequent (e.g. minutely) rules.
const MAX_OCCURRENCES_PER_SCHEDULE = 2000;
// Number of shading steps, mapped to the PatternFly blue chart color scale.
const INTENSITY_LEVELS = 5;
// Selectable look-ahead windows in days.
const WINDOW_OPTIONS = [7, 14, 30];
const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_OVERLOAD_THRESHOLD = 3;
const MAX_UPCOMING = 25;
// Fixed display order for the job-type filter.
const TYPE_ORDER = ['job', 'workflow_job', 'project_update', 'inventory_update', 'system_job'];

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

interface Occurrence {
  date: Date;
  schedule: Schedule;
}

interface HeatmapData {
  cells: HeatmapCell[][];
  max: number;
  total: number;
  upcoming: Occurrence[];
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

const CellButton = styled.button<{ $level: number; $overload: boolean }>`
  display: block;
  width: 1.75rem;
  height: 1.75rem;
  padding: 0;
  border-radius: var(--pf-t--global--border--radius--small);
  border: 1px solid var(--pf-t--global--border--color--default);
  background-color: ${({ $level }) => LEVEL_BACKGROUNDS[$level]};
  cursor: ${({ $level }) => ($level > 0 ? 'pointer' : 'default')};
  outline-offset: -2px;
  outline: ${({ $overload }) =>
    $overload
      ? '2px solid var(--pf-t--global--border--color--status--danger--default)'
      : '2px solid transparent'};
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

const TimelineList = styled.div`
  max-height: 28rem;
  overflow-y: auto;
`;

function intensityLevel(runs: number, max: number): number {
  if (runs <= 0 || max <= 0) return 0;
  return Math.min(INTENSITY_LEVELS, Math.ceil((runs / max) * INTENSITY_LEVELS));
}

function scheduleType(schedule: Schedule): string {
  return schedule.summary_fields.unified_job_template.unified_job_type;
}

function buildHeatmap(schedules: Schedule[], windowDays: number): HeatmapData {
  // Per slot keep the run count (for colour) and the distinct schedules (for the popover).
  const runs: number[][] = DAY_ORDER.map(() => HOURS.map(() => 0));
  const scheduleMaps = DAY_ORDER.map(() => HOURS.map(() => new Map<number, Schedule>()));
  const upcoming: Occurrence[] = [];
  const start = new Date();
  const end = new Date(start.getTime() + windowDays * 24 * 60 * 60 * 1000);
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
      upcoming.push({ date: occurrence, schedule });
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
  upcoming.sort((a, b) => a.date.getTime() - b.date.getTime());

  return { cells, max, total, upcoming };
}

export function SchedulesOverview() {
  const { t } = useTranslation();
  const getPageUrl = useGetPageUrl();
  const getScheduleUrl = useGetScheduleUrl();
  const { results, error, isLoading, refresh } = useAwxGetAllPages<Schedule>(awxAPI`/schedules/`);

  const [windowDays, setWindowDays] = useState(DEFAULT_WINDOW_DAYS);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [threshold, setThreshold] = useState(DEFAULT_OVERLOAD_THRESHOLD);
  // A single popover is shared by all cells and anchored to the clicked one via triggerRef.
  const [popover, setPopover] = useState<{
    cell: HeatmapCell;
    label: string;
    overloaded: boolean;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const typeLabels = useMemo<Record<string, string>>(
    () => ({
      job: t('Playbook run'),
      workflow_job: t('Workflow job'),
      project_update: t('Project update'),
      inventory_update: t('Inventory sync'),
      system_job: t('Management job'),
    }),
    [t]
  );

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

  const presentTypes = useMemo(() => {
    const types = new Set((results ?? []).map(scheduleType));
    return TYPE_ORDER.filter((type) => types.has(type));
  }, [results]);

  const filteredSchedules = useMemo(() => {
    const all = results ?? [];
    if (selectedTypes.length === 0) return all;
    return all.filter((schedule) => selectedTypes.includes(scheduleType(schedule)));
  }, [results, selectedTypes]);

  const { cells, max, total, upcoming } = useMemo(
    () => buildHeatmap(filteredSchedules, windowDays),
    [filteredSchedules, windowDays]
  );

  const getScheduleHref = useCallback(
    (schedule: Schedule): string | undefined => {
      const url = getScheduleUrl('details', schedule);
      if (!url || typeof url === 'string') return undefined;
      return getPageUrl(url.pageId, { params: url.params });
    },
    [getScheduleUrl, getPageUrl]
  );

  const toggleType = useCallback((type: string) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((value) => value !== type) : [...prev, type]
    );
  }, []);

  const renderPopoverBody = useCallback(
    (cell: HeatmapCell, overloaded: boolean): ReactNode => (
      <PopoverList>
        {overloaded && (
          <Content component="small">
            <ExclamationTriangleIcon color="var(--pf-t--global--icon--color--status--warning--default)" />{' '}
            {t('Busy time slot')}
          </Content>
        )}
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
  if (!results || results.length === 0) {
    return (
      <EmptyStateNoData
        title={t('No scheduled job runs')}
        description={t('There are no schedules you have access to.')}
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
    <>
      <Toolbar>
        <ToolbarContent>
          <ToolbarItem variant="label">{t('Time window')}</ToolbarItem>
          <ToolbarItem>
            <ToggleGroup aria-label={t('Time window')}>
              {WINDOW_OPTIONS.map((days) => (
                <ToggleGroupItem
                  key={days}
                  text={t('{{days}} days', { days })}
                  isSelected={windowDays === days}
                  onChange={() => setWindowDays(days)}
                />
              ))}
            </ToggleGroup>
          </ToolbarItem>
          {presentTypes.length > 1 && (
            <>
              <ToolbarItem variant="separator" />
              <ToolbarItem variant="label">{t('Job type')}</ToolbarItem>
              <ToolbarItem>
                <ToggleGroup aria-label={t('Job type')}>
                  {presentTypes.map((type) => (
                    <ToggleGroupItem
                      key={type}
                      text={typeLabels[type] ?? type}
                      isSelected={selectedTypes.includes(type)}
                      onChange={(event) => {
                        toggleType(type);
                        // Drop the lingering focus ring after a mouse click, but keep
                        // keyboard focus (event.detail is 0 for keyboard activation).
                        if (event.detail > 0 && document.activeElement instanceof HTMLElement) {
                          document.activeElement.blur();
                        }
                      }}
                    />
                  ))}
                </ToggleGroup>
              </ToolbarItem>
            </>
          )}
          <ToolbarItem variant="separator" />
          <ToolbarItem variant="label">{t('Overload ≥')}</ToolbarItem>
          <ToolbarItem>
            <NumberInput
              value={threshold}
              min={1}
              onMinus={() => setThreshold((value) => Math.max(1, value - 1))}
              onPlus={() => setThreshold((value) => value + 1)}
              onChange={(event) => {
                const value = Number((event.target as HTMLInputElement).value);
                if (!Number.isNaN(value)) setThreshold(Math.max(1, value));
              }}
              inputAriaLabel={t('Overload threshold')}
            />
          </ToolbarItem>
        </ToolbarContent>
      </Toolbar>
      <Scrollable marginTop={16} marginBottom={16}>
        <Grid hasGutter>
          <GridItem lg={8}>
            <Card>
              <CardTitle>{t('Scheduled job runs')}</CardTitle>
              <CardBody>
                <Content component="p">
                  {t(
                    'Enabled schedules bucketed by weekday and hour in your local time zone. Click a cell to open its schedules. Total runs: {{total}}.',
                    { total }
                  )}
                </Content>
                {total === 0 ? (
                  <EmptyStateNoData
                    title={t('No scheduled job runs')}
                    description={t('No runs match the current filters and time window.')}
                  />
                ) : (
                  <>
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
                                const overloaded = cell.runs > 0 && cell.runs >= threshold;
                                const label = slotLabel(dayLabel, hour);
                                return (
                                  <CellTd key={hour}>
                                    <CellButton
                                      $level={level}
                                      $overload={overloaded}
                                      type="button"
                                      disabled={cell.runs === 0}
                                      aria-label={label}
                                      title={cell.runs > 0 ? label : undefined}
                                      onClick={(event) => {
                                        triggerRef.current = event.currentTarget;
                                        setPopover({ cell, label, overloaded });
                                      }}
                                    />
                                  </CellTd>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </HeatmapTable>
                    </ScrollContainer>
                    {popover && (
                      <Popover
                        isVisible
                        shouldClose={() => setPopover(null)}
                        triggerRef={triggerRef}
                        headerContent={popover.label}
                        bodyContent={renderPopoverBody(popover.cell, popover.overloaded)}
                      />
                    )}
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
                  </>
                )}
              </CardBody>
            </Card>
          </GridItem>
          <GridItem lg={4}>
            <Card>
              <CardTitle>{t('Upcoming runs')}</CardTitle>
              <CardBody>
                {upcoming.length === 0 ? (
                  <Content component="small">{t('No upcoming runs in this time window.')}</Content>
                ) : (
                  <TimelineList>
                    <List isPlain>
                      {upcoming.slice(0, MAX_UPCOMING).map((occurrence) => {
                        const href = getScheduleHref(occurrence.schedule);
                        return (
                          <ListItem key={`${occurrence.schedule.id}-${occurrence.date.getTime()}`}>
                            <Content component="small">
                              <DateTimeCell value={occurrence.date.getTime()} />
                            </Content>
                            {href ? (
                              <Link to={href}>{occurrence.schedule.name}</Link>
                            ) : (
                              <span>{occurrence.schedule.name}</span>
                            )}
                          </ListItem>
                        );
                      })}
                    </List>
                  </TimelineList>
                )}
              </CardBody>
            </Card>
          </GridItem>
        </Grid>
      </Scrollable>
    </>
  );
}
