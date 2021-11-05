import type { NxJsonConfiguration } from '@nrwl/devkit';
import { logger } from '@nrwl/devkit';
import { stripIndent } from '@nrwl/tao/src/shared/logger';
import { appRootPath } from '@nrwl/tao/src/utils/app-root';
import { Box, measureElement, Static, Text } from 'ink';
import { join } from 'path';
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { of } from 'rxjs';
import { concatMap, delay } from 'rxjs/operators';
import { NxArgs } from '../../../command-line/utils';
import { Hasher } from '../../../core/hasher/hasher';
import { isRelativePath } from '../../../utilities/fileutils';
import { output } from '../../../utilities/output';
import { AffectedEventType, TasksRunner } from '../../tasks-runner';
import { createTasksForProjectToRun } from '../utils';
import { ProgressBar } from './progress-bar';
import { TaskRow } from './task-row';
import { Timer } from './timer';

function randomDelay(bottom, top) {
  return Math.floor(Math.random() * (1 + top - bottom)) + bottom;
}

export function RunCommand({
  projectsToRun,
  projectGraph,
  nxJson,
  workspaceResults,
  nxArgs,
  overrides,
  reporter,
  initiatingProject,
}) {
  const progressBoxRef = useRef();
  const [progressBoxWidth, setProgressBoxWidth] = useState(0);
  const [taskList, setTaskList] = useState(
    projectsToRun.map((project) => ({
      projectName: project.name,
      state: 'loading',
      status: '',
      output: '',
    }))
  );

  useEffect(() => {
    // Needed for progress bar
    const { width } = measureElement(progressBoxRef.current);
    setProgressBoxWidth(width);

    async function main() {
      const { tasksRunner, runnerOptions } = getRunner(nxArgs, nxJson);
      // console.log('tasksRunner', tasksRunner);
      // Doing this for backwards compatibility, should be removed in v14
      ensureTargetDependenciesBackwardCompatibility(nxJson, nxArgs);
      const defaultDependencyConfigs = nxJson.targetDependencies;
      const tasks = createTasksForProjectToRun(
        projectsToRun,
        {
          target: nxArgs.target,
          configuration: nxArgs.configuration,
          overrides,
        },
        projectGraph,
        initiatingProject,
        defaultDependencyConfigs
      );
      // reporter.beforeRun(projectsToRun.map((p) => p.name), tasks, nxArgs, overrides);
      // TODO: vsavkin remove hashing after Nx 13
      const hasher = new Hasher(projectGraph, nxJson, runnerOptions);
      const res = await Promise.all(
        tasks.map((t) => hasher.hashTaskWithDepsAndContext(t))
      );
      for (let i = 0; i < res.length; ++i) {
        tasks[i].hash = res[i].value;
        tasks[i].hashDetails = res[i].details;
      }
      const cachedTasks = [];
      const failedTasks = [];
      const tasksWithFailedDependencies = [];
      tasksRunner(tasks, runnerOptions, {
        initiatingProject,
        target: nxArgs.target,
        projectGraph,
        nxJson,
        hideCachedOutput: nxArgs.hideCachedOutput,
      })
        .pipe(concatMap((i) => of(i).pipe(delay(randomDelay(100, 500)))))
        .subscribe({
          next: (event) => {
            // console.log({ event });
            if (
              projectsToRun
                .map((project) => project.name)
                .includes(event.task.target.project) &&
              event.task.target.target === nxArgs.target
            ) {
              workspaceResults.setResult(
                event.task.target.project,
                event.success
              );
            }

            setTaskList((currentTaskList) =>
              currentTaskList.map((task) => {
                if (task.projectName === event.task.target.project) {
                  let state = 'loading';
                  let status = '';
                  // console.log(event.type);
                  switch (event.type) {
                    case AffectedEventType.TaskComplete:
                      state = 'success';
                      break;
                    case AffectedEventType.TaskDependencyFailed:
                      state = 'failed';
                      break;
                    case AffectedEventType.TaskCacheRead:
                      state = 'success';
                      // status = 'from cache';
                      break;
                    default:
                      console.log('UNHANDLED', event.type, { event });
                  }
                  return {
                    projectName: task.projectName,
                    state,
                    status,
                  };
                }
                return task;
              })
            );

            switch (event.type) {
              case AffectedEventType.TaskComplete: {
                if (!event.success) {
                  failedTasks.push(event.task);
                }
                break;
              }
              case AffectedEventType.TaskDependencyFailed: {
                tasksWithFailedDependencies.push(event.task);
                break;
              }
              case AffectedEventType.TaskCacheRead: {
                cachedTasks.push(event.task);
                if (!event.success) {
                  failedTasks.push(event.task);
                }
                break;
              }
            }
          },
          error: console.error,
          complete: () => {
            // console.log('COMPLETE YEAH');
            // fix for https://github.com/nrwl/nx/issues/1666
            if (process.stdin['unref']) process.stdin.unref();
            // workspaceResults.saveResults();
            // reporter.printResults(nxArgs, workspaceResults.startedWithFailedProjects, tasks, failedTasks, tasksWithFailedDependencies, cachedTasks);
            if (workspaceResults.hasFailure) {
              process.exit(1);
            }
          },
        });
    }
    main();
  }, []);

  const items = [
    {
      id: '1',
      title: 'Projects',
    },
  ];

  const shouldStopTimer = taskList.every((task) => task.state === 'success');

  return (
    <>
      <Static items={items}>
        {(test) => (
          <Box marginTop={1} key={test.id}>
            <Text color="cyan">&gt; </Text>
            <Text color="cyan" inverse bold>
              {' '}
              NX{' '}
            </Text>
            <Text dimColor> Running target </Text>
            <Text bold>test</Text>
            <Text dimColor> for </Text>
            <Text bold>{projectsToRun.length} project(s):</Text>
          </Box>
        )}
      </Static>

      <Box marginTop={1} paddingLeft={3} paddingRight={3}>
        <Box ref={progressBoxRef} width="100%">
          <Timer
            render={({ counter, intervalId }) => {
              let color = 'grey';
              if (shouldStopTimer) {
                clearInterval(intervalId);
                color = 'green';
              }
              return <Text color={color}>{(counter / 1000).toFixed(2)}s</Text>;
            }}
          />
          <Text>{'    '}</Text>
          <Text dimColor color="green">
            {progressBoxWidth !== 0 && (
              <ProgressBar
                left={'         '.length}
                width={progressBoxWidth}
                // right={'         '.length}
                percent={
                  taskList.filter((task) => task.state === 'success').length /
                  taskList.length
                }
                rightPad={true}
                character={'='}
                incompleteChar={'-'}
              />
            )}
          </Text>
        </Box>
      </Box>

      <Box marginY={1} paddingLeft={3} flexDirection="column">
        {taskList.map((task) => (
          <TaskRow
            key={task.projectName}
            label={task.projectName}
            state={task.state}
            status={task.status}
            output={task.output}
          />
        ))}
      </Box>
    </>
  );
}

export function getRunner(
  nxArgs: NxArgs,
  nxJson: NxJsonConfiguration
): {
  tasksRunner: TasksRunner;
  runnerOptions: unknown;
} {
  let runner = nxArgs.runner;

  //TODO: vsavkin remove in Nx 12
  if (!nxJson.tasksRunnerOptions) {
    const t = require('../../default-tasks-runner');
    return {
      tasksRunner: t.defaultTasksRunner,
      runnerOptions: nxArgs,
    };
  }

  //TODO: vsavkin remove in Nx 12
  if (!runner && !nxJson.tasksRunnerOptions.default) {
    const t = require('../../default-tasks-runner');
    return {
      tasksRunner: t.defaultTasksRunner,
      runnerOptions: nxArgs,
    };
  }

  runner = runner || 'default';

  if (nxJson.tasksRunnerOptions[runner]) {
    let modulePath: string = nxJson.tasksRunnerOptions[runner].runner;

    let tasksRunner;
    if (modulePath) {
      if (isRelativePath(modulePath)) {
        modulePath = join(appRootPath, modulePath);
      }

      tasksRunner = require(modulePath);
      // to support both babel and ts formats
      if (tasksRunner.default) {
        tasksRunner = tasksRunner.default;
      }
    } else {
      tasksRunner = require('../../default-tasks-runner').defaultTasksRunner;
    }

    return {
      tasksRunner,
      runnerOptions: {
        ...nxJson.tasksRunnerOptions[runner].options,
        ...nxArgs,
      },
    };
  } else {
    output.error({
      title: `Could not find runner configuration for ${runner}`,
    });
    process.exit(1);
  }
}

function ensureTargetDependenciesBackwardCompatibility(
  nxJson: NxJsonConfiguration,
  nxArgs: NxArgs
): void {
  nxJson.targetDependencies ??= {};
  if (nxArgs.withDeps) {
    logger.warn(
      stripIndent(`
          DEPRECATION WARNING: --with-deps is deprecated and it will be removed in v14.
          Configure target dependencies instead: https://nx.dev/latest/angular/core-concepts/configuration#target-dependencies.
        `)
    );

    if (!nxJson.targetDependencies[nxArgs.target]) {
      nxJson.targetDependencies[nxArgs.target] = [
        { target: nxArgs.target, projects: 'dependencies' },
      ];
    }
  }
}
