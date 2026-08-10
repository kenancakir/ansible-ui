import { IToolbarFilter } from '@ansible/ansible-ui-framework';
import {
  IFilterState,
  PageToolbarFilters,
} from '@ansible/ansible-ui-framework/PageToolbar/PageToolbarFilter';
import { Button, Toolbar, ToolbarContent } from '@patternfly/react-core';
import { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { JobStatus, isJobRunning } from './util';

interface IJobOutputToolbarProps {
  toolbarFilters: IToolbarFilter[];
  filterState: IFilterState;
  setFilterState: Dispatch<SetStateAction<IFilterState>>;
  jobStatus?: JobStatus;
  isFollowModeEnabled: boolean;
  setIsFollowModeEnabled: (value: boolean) => void;
  onOpenHeatmap: () => void;
}

export function JobOutputToolbar(props: Readonly<IJobOutputToolbarProps>) {
  const {
    toolbarFilters,
    filterState,
    setFilterState,
    jobStatus,
    isFollowModeEnabled,
    setIsFollowModeEnabled,
    onOpenHeatmap,
  } = props;
  const { t } = useTranslation();

  const handleFollowToggle = () => {
    if (isFollowModeEnabled) {
      setIsFollowModeEnabled(false);
    } else {
      setIsFollowModeEnabled(true);
    }
  };

  return (
    <Toolbar clearAllFilters={() => setFilterState({})}>
      <ToolbarContent>
        <PageToolbarFilters
          toolbarFilters={toolbarFilters}
          filterState={filterState}
          setFilterState={setFilterState}
        />
        {isJobRunning(jobStatus) ? (
          <Button
            variant={isFollowModeEnabled ? 'secondary' : 'primary'}
            onClick={handleFollowToggle}
          >
            {isFollowModeEnabled ? t('Unfollow') : t('Follow')}
          </Button>
        ) : null}
        <Button variant="secondary" onClick={onOpenHeatmap} ouiaId="task-timing-heatmap-button">
          {t('Task timing')}
        </Button>
      </ToolbarContent>
    </Toolbar>
  );
}
