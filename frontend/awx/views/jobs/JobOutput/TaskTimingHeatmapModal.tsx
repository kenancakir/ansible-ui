import { EmptyStateNoData } from '@ansible/ansible-ui-framework/components/EmptyStateNoData';
import {
  Bullseye,
  Modal,
  ModalBody,
  ModalHeader,
  Spinner,
  Stack,
  StackItem,
  Tooltip,
} from '@patternfly/react-core';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { ProfileTaskTiming } from './parseProfileTasks';

const Strip = styled.div`
  display: flex;
  width: 100%;
  height: 48px;
  gap: 1px;
  overflow: hidden;
  border: 1px solid var(--pf-t--global--border--color--100);
  border-radius: 4px;
`;
const Segment = styled.button`
  border: 0;
  padding: 0;
  min-width: 4px;
  cursor: pointer;
  height: 100%;
`;
const LegendBar = styled.div`
  height: 12px;
  width: 160px;
  border-radius: 4px;
  background: linear-gradient(to right, hsl(120, 70%, 45%), hsl(60, 70%, 45%), hsl(0, 70%, 45%));
`;
const LegendRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

function heatColor(ratio: number): string {
  const hue = (1 - Math.max(0, Math.min(1, ratio))) * 120;
  return `hsl(${hue}, 70%, 45%)`;
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

export function TaskTimingHeatmapModal(
  props: Readonly<{
    isOpen: boolean;
    onClose: () => void;
    timings: ProfileTaskTiming[] | undefined;
    isLoading: boolean;
    error?: Error;
    onSelectTask: (line: number) => void;
  }>
) {
  const { isOpen, onClose, timings, isLoading, error, onSelectTask } = props;
  const { t } = useTranslation();

  const maxDuration = timings?.reduce((max, task) => Math.max(max, task.duration), 0) ?? 0;
  const totalDuration = timings?.reduce((sum, task) => sum + task.duration, 0) ?? 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      aria-label={t`Task timing heatmap`}
      width="75%"
      ouiaId="task-timing-heatmap-modal"
    >
      <ModalHeader title={t`Task timing heatmap`} />
      <ModalBody>
        {isLoading ? (
          <Bullseye>
            <Spinner aria-label={t`Loading job events`} />
          </Bullseye>
        ) : error ? (
          <EmptyStateNoData
            title={t`Unable to load task timings`}
            description={t`The job events could not be loaded.`}
          />
        ) : !timings || timings.length === 0 ? (
          <EmptyStateNoData
            title={t`No task timing data`}
            description={t`This job has no task timing data to build a heatmap from.`}
          />
        ) : (
          <Stack hasGutter>
            <StackItem>
              {t('Total task time: {{total}} across {{count}} tasks', {
                total: formatSeconds(totalDuration),
                count: timings.length,
              })}
            </StackItem>
            <StackItem>
              <Strip>
                {timings.map((task) => {
                  const label = `${task.name} — ${formatSeconds(task.duration)}`;
                  return (
                    <Tooltip key={task.counter} content={label}>
                      <Segment
                        type="button"
                        aria-label={label}
                        onClick={() => onSelectTask(task.line)}
                        style={{
                          flexGrow: Math.max(task.duration, 0.001),
                          backgroundColor: heatColor(maxDuration ? task.duration / maxDuration : 0),
                        }}
                      />
                    </Tooltip>
                  );
                })}
              </Strip>
            </StackItem>
            <StackItem>
              <LegendRow>
                <span>{t`Faster`}</span>
                <LegendBar />
                <span>{t('Slower ({{max}})', { max: formatSeconds(maxDuration) })}</span>
              </LegendRow>
            </StackItem>
            <StackItem>{t`Click a segment to jump to that task in the output.`}</StackItem>
          </Stack>
        )}
      </ModalBody>
    </Modal>
  );
}
