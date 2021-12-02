// @ts-check
import * as React from 'react';
import { Text, Box, Static, measureElement } from 'ink';
import { useState, useRef, useEffect } from 'react';
import { Timer } from './timer';
import { TaskRow } from './task-row';
import { ProgressBar } from './progress-bar';
import { NxOutputRowTitle } from './nx-output-row-title';
import { TaskList } from './task-list';

export function RunMany({ tasksState }) {
  const progressBoxRef = useRef();
  const [progressBoxWidth, setProgressBoxWidth] = useState(0);
  const [taskList, setTaskList] = useState(
    tasksState.projectNames.map((projectName) => ({
      projectName,
      state: 'pending',
      status: '',
      output: '',
    }))
  );

  useEffect(() => {
    // Needed for progress bar
    //   const { width } = measureElement(progressBoxRef.current);
    //   setProgressBoxWidth(width);
    //   async function main() {
    //     const { tasksRunner, runnerOptions } = getRunner(nxArgs, nxJson);
    //     // console.log('tasksRunner', tasksRunner);
    //     // Doing this for backwards compatibility, should be removed in v14
    //     ensureTargetDependenciesBackwardCompatibility(nxJson, nxArgs);
    //     const defaultDependencyConfigs = nxJson.targetDependencies;
    //     const tasks = createTasksForProjectToRun(
    //       projectsToRun,
    //       {
    //         target: nxArgs.target,
    //         configuration: nxArgs.configuration,
    //         overrides,
    //       },
    //       projectGraph,
    //       initiatingProject,
    //       defaultDependencyConfigs
    //     );
    //     // reporter.beforeRun(projectsToRun.map((p) => p.name), tasks, nxArgs, overrides);
    //     // TODO: vsavkin remove hashing after Nx 13
    //     const hasher = new Hasher(projectGraph, nxJson, runnerOptions);
    //     const res = await Promise.all(
    //       tasks.map((t) => hasher.hashTaskWithDepsAndContext(t))
    //     );
    //     for (let i = 0; i < res.length; ++i) {
    //       tasks[i].hash = res[i].value;
    //       tasks[i].hashDetails = res[i].details;
    //     }
    //     const cachedTasks = [];
    //     const failedTasks = [];
    //     const tasksWithFailedDependencies = [];
    //     tasksRunner(tasks, runnerOptions, {
    //       initiatingProject,
    //       target: nxArgs.target,
    //       projectGraph,
    //       nxJson,
    //       hideCachedOutput: nxArgs.hideCachedOutput,
    //     })
    //       .pipe(concatMap((i) => of(i).pipe(delay(randomDelay(100, 500)))))
    //       .subscribe({
    //         next: (event) => {
    //           // console.log({ event });
    //           if (
    //             projectsToRun
    //               .map((project) => project.name)
    //               .includes(event.task.target.project) &&
    //             event.task.target.target === nxArgs.target
    //           ) {
    //             workspaceResults.setResult(
    //               event.task.target.project,
    //               event.success
    //             );
    //           }
    //           setTaskList((currentTaskList) =>
    //             currentTaskList.map((task) => {
    //               if (task.projectName === event.task.target.project) {
    //                 let state = 'loading';
    //                 let status = '';
    //                 // console.log(event.type);
    //                 switch (event.type) {
    //                   case AffectedEventType.TaskComplete:
    //                     state = 'success';
    //                     break;
    //                   case AffectedEventType.TaskDependencyFailed:
    //                     state = 'failed';
    //                     break;
    //                   case AffectedEventType.TaskCacheRead:
    //                     state = 'success';
    //                     // status = 'from cache';
    //                     break;
    //                   default:
    //                     console.log('UNHANDLED', event.type, { event });
    //                 }
    //                 return {
    //                   projectName: task.projectName,
    //                   state,
    //                   status,
    //                 };
    //               }
    //               return task;
    //             })
    //           );
    //           switch (event.type) {
    //             case AffectedEventType.TaskComplete: {
    //               if (!event.success) {
    //                 failedTasks.push(event.task);
    //               }
    //               break;
    //             }
    //             case AffectedEventType.TaskDependencyFailed: {
    //               tasksWithFailedDependencies.push(event.task);
    //               break;
    //             }
    //             case AffectedEventType.TaskCacheRead: {
    //               cachedTasks.push(event.task);
    //               if (!event.success) {
    //                 failedTasks.push(event.task);
    //               }
    //               break;
    //             }
    //           }
    //         },
    //         error: console.error,
    //         complete: () => {
    //           // console.log('COMPLETE YEAH');
    //           // fix for https://github.com/nrwl/nx/issues/1666
    //           if (process.stdin['unref']) process.stdin.unref();
    //           // workspaceResults.saveResults();
    //           // reporter.printResults(nxArgs, workspaceResults.startedWithFailedProjects, tasks, failedTasks, tasksWithFailedDependencies, cachedTasks);
    //           if (workspaceResults.hasFailure) {
    //             process.exit(1);
    //           }
    //         },
    //       });
    //   }
    //   main();
  }, []);

  useEffect(() => {
    if (!tasksState.taskResults) {
      return;
    }
    setTaskList((state) => {
      return state.map((task) => {
        const taskResult = tasksState.taskResults.find(
          (tr) => tr.task.target.project === task.projectName
        );
        if (!taskResult) {
          return task;
        }
        switch (taskResult.status) {
          case 'cache':
            return {
              ...task,
              state: 'success',
              status: 'from cache',
            };
          case 'success':
            return {
              ...task,
              state: 'success',
              status: '',
            };
          case 'failure':
            return {
              ...task,
              state: 'error',
              status: '',
              output: taskResult.terminalOutput,
            };
          default:
            return task;
        }
      });
    });
  }, [tasksState.taskResults]);

  useEffect(() => {
    if (!tasksState.tasks) {
      return;
    }
    setTaskList((state) => {
      return state.map((task) => {
        const matchedRunningTask = tasksState.tasks.find(
          (t) => t.target.project === task.projectName
        );
        if (!matchedRunningTask || task.state !== 'pending') {
          return task;
        }
        return {
          ...task,
          state: 'loading',
        };
      });
    });
  }, [tasksState.tasks]);

  const isEveryTaskSuccessfullyComplete = taskList.every(
    (task) => task.state === 'success'
  );

  const failedTasks: { projectName: string; output: string }[] =
    taskList.filter((task) => task.state === 'error');

  // const shouldStopTimer = isEveryTaskSuccessfullyComplete;

  // if (!tasksState || !tasksState.tasks) {
  //     return null;
  // }

  return (
    <>
      <Static items={failedTasks}>
        {(task, i) => (
          <Box
            key={task.projectName}
            marginTop={1}
            flexDirection="column"
            marginX={2}
          >
            <Box flexDirection="column">
              <Text
                bold={true}
                color="red"
              >{`> nx run ${task.projectName}:${tasksState.target}`}</Text>

              <Box marginLeft={2}>
                <Text>{task.output}</Text>
              </Box>
            </Box>

            {i === failedTasks.length - 1 && (
              <Box marginY={1}>
                <Text color="gray" dimColor={true}>
                  {
                    '———————————————————————————————————————————————————————————————————————'
                  }
                </Text>
              </Box>
            )}
          </Box>
        )}
      </Static>

      <Box marginTop={1} marginX={2}>
        <RunManyTitle
          tasksState={tasksState}
          taskList={taskList}
        ></RunManyTitle>
      </Box>

      {/* <Box marginTop={1} paddingLeft={3} paddingRight={3}>
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
          </Box> */}

      <Box marginBottom={!isEveryTaskSuccessfullyComplete ? 2 : 0}>
        <TaskList tasksState={tasksState} taskList={taskList}></TaskList>
      </Box>
    </>
  );
}

function RunManyTitle({ tasksState, taskList }) {
  const isEveryTaskComplete = taskList.every(
    (task) => task.state === 'success' || task.state === 'error'
  );

  if (!isEveryTaskComplete) {
    return (
      <NxOutputRowTitle>
        <Text dimColor color="white">
          Running target{' '}
        </Text>
        <Text bold color="white">
          {tasksState.target}
        </Text>
        <Text dimColor color="white">
          {' '}
          for{' '}
        </Text>
        <Text bold color="white">
          {tasksState.projectNames.length} project(s):
        </Text>
      </NxOutputRowTitle>
    );
  }

  const isEveryTaskSuccessfullyComplete = taskList.every(
    (task) => task.state === 'success'
  );

  if (isEveryTaskSuccessfullyComplete) {
    return (
      <NxOutputRowTitle success={true}>
        <Text dimColor color="green">
          Successfully ran{' '}
        </Text>
        <Text bold color="green">
          {tasksState.target}
        </Text>
        <Text dimColor color="green">
          {' '}
          for{' '}
        </Text>
        <Text bold color="green">
          {tasksState.projectNames.length} project(s)
        </Text>
      </NxOutputRowTitle>
    );
  }

  return (
    <NxOutputRowTitle>
      <Text dimColor color="white">
        Ran target{' '}
      </Text>
      <Text bold color="white">
        {tasksState.target}
      </Text>
      <Text dimColor color="white">
        {' '}
        for{' '}
      </Text>
      <Text bold color="white">
        {tasksState.projectNames.length} project(s)
      </Text>
    </NxOutputRowTitle>
  );
}
