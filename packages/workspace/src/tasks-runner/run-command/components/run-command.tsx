import { Text, useApp } from 'ink';
import * as React from 'react';
import { useState } from 'react';
import { NoTargetsRun } from './no-targets-run';
import { NxOutputRowTitle } from './nx-output-row-title';
import { RunMany } from './run-many';

type RunCommandState = 'INIT' | 'NO_TARGETS_RUN' | 'RUN_MANY';

export function RunCommandComponent({ lifeCycle, ...otherProps }) {
  const [runCommandState, setRunCommandState] =
    useState<RunCommandState>('INIT');
  const [onStartCommandParamsState, setOnStartCommandParamsState] =
    useState(null);
  const [tasksState, setTasksState] = useState(null);
  const { exit } = useApp();

  const lifeCycleCallbacks = lifeCycle.lifeCycles[0].callbacks;

  lifeCycleCallbacks.onStartCommand = (params) => {
    setOnStartCommandParamsState(params);
    if (params.projectNames.length <= 0) {
      setRunCommandState('NO_TARGETS_RUN');
      return exit();
    }
    setTasksState({
      target: params.args.target,
      projectNames: params.projectNames,
      tasks: null,
      taskResults: null,
    });
    setRunCommandState('RUN_MANY');
  };

  lifeCycleCallbacks.onStartTasks = (tasks) => {
    setTasksState((state) => ({
      ...state,
      tasks: [...(state.tasks || []), ...tasks],
    }));
  };

  lifeCycleCallbacks.onEndTasks = (taskResults) => {
    setTasksState((state) => ({
      ...state,
      taskResults: [...(state.taskResults || []), ...taskResults],
    }));
  };

  switch (runCommandState) {
    case 'INIT':
      return <NxOutputRowTitle>{''}</NxOutputRowTitle>;
    case 'NO_TARGETS_RUN':
      return <NoTargetsRun onStartCommandParams={onStartCommandParamsState} />;
    case 'RUN_MANY':
      return <RunMany tasksState={tasksState} />;
    default:
      return <Text>{runCommandState}</Text>;
  }
}
