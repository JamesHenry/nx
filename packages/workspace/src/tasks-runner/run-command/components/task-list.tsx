// @ts-check
import { Box, Text } from 'ink';
import * as React from 'react';
import { TaskRow } from './task-row';

export function TaskList({ tasksState, taskList }) {
  const pendingTasks = taskList.filter((task) => task.state === 'pending');
  const runningTasks = taskList.filter((task) => task.state === 'loading');
  const successfulTasks = taskList.filter((task) => task.state === 'success');
  const locallyCachedTasks = successfulTasks.filter(
    (task) => task.status === 'from local cache'
  );
  const cloudCachedTasks = successfulTasks.filter(
    (task) => task.status === 'from cloud cache'
  );
  const failedTasks = taskList.filter((task) => task.state === 'error');
  const numCompletedTasks = successfulTasks.length + failedTasks.length;

  return (
    <Box paddingLeft={5} flexDirection="column">
      {runningTasks.length > 0 && (
        <Box marginY={1}>
          <Text color="grey" dimColor={false}>{`Executing ${
            runningTasks.length
          }/${
            pendingTasks.length + runningTasks.length
          } remaining tasks in parallel...`}</Text>
        </Box>
      )}

      <Box flexDirection="column" marginBottom={1}>
        {runningTasks.map((task) => (
          <TaskRow
            key={task.projectName}
            label={task.projectName}
            state={task.state}
            status={task.status}
            muted={false}
          />
        ))}
      </Box>

      <Box flexDirection="row">
        {successfulTasks.length !== taskList.length && (
          <Box>
            {successfulTasks.length > 0 && (
              <TaskRow
                key="successful"
                label={`${successfulTasks.length}/${numCompletedTasks} succeeded`}
                state="success"
                status=""
                muted={failedTasks.length > 0}
              />
            )}
          </Box>
        )}

        {failedTasks.length !== taskList.length && (
          <Box marginLeft={successfulTasks.length > 0 ? 4 : 0}>
            {failedTasks.length > 0 && (
              <TaskRow
                key="failed"
                label={`${failedTasks.length}/${numCompletedTasks} failed (see output above)`}
                state="error"
                status=""
                muted={false}
              />
            )}
          </Box>
        )}
      </Box>

      {pendingTasks.length === 0 &&
        successfulTasks.length === taskList.length &&
        (locallyCachedTasks.length > 0 || cloudCachedTasks.length > 0) && (
          <Box marginTop={2}>
            {locallyCachedTasks.length > 0 && (
              <TaskRow
                key="local-cache"
                label={`${locallyCachedTasks.length} results retrieved from local cache`}
                state="local-cache"
                status=""
                muted={false}
              />
            )}

            {cloudCachedTasks.length > 0 && (
              <TaskRow
                key="cloud-cache"
                label={`${cloudCachedTasks.length} results retrieved from cloud cache`}
                state="cloud-cache"
                status=""
                muted={false}
              />
            )}
          </Box>
        )}
    </Box>
  );
}
