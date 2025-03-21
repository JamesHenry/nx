import { EOL } from 'os';
import { output } from '../../utils/output';
import type { LifeCycle } from '../life-cycle';
import type { TaskStatus } from '../tasks-runner';
import { Task } from '../../config/task-graph';
import { prettyTime } from './pretty-time';
import { formatFlags, formatTargetsAndProjects } from './formatting-utils';
import { viewLogsFooterRows } from './view-logs-utils';
import figures = require('figures');
import { createTaskId } from '../create-task-graph';

const LEFT_PAD = `   `;
const SPACER = `  `;
const EXTENDED_LEFT_PAD = `      `;

export function getTuiTerminalSummaryLifeCycle({
  projectNames,
  tasks,
  args,
  overrides,
  initiatingProject,
}: {
  projectNames: string[];
  tasks: Task[];
  args: { targets?: string[]; configuration?: string; parallel?: number };
  overrides: Record<string, unknown>;
  initiatingProject: string;
}) {
  const lifeCycle = {} as Partial<LifeCycle>;

  const start = process.hrtime();
  const targets = args.targets;
  const totalTasks = tasks.length;

  let totalCachedTasks = 0;
  let totalSuccessfulTasks = 0;
  let totalFailedTasks = 0;
  let totalCompletedTasks = 0;
  let timeTakenText: string;

  const failedTasks = new Set<string>();
  const inProgressTasks = new Set<string>();
  const tasksToTerminalOutputs: Record<
    string,
    { terminalOutput: string; taskStatus: TaskStatus }
  > = {};
  const taskIdsInOrderOfCompletion: string[] = [];

  lifeCycle.startTasks = (tasks) => {
    for (let t of tasks) {
      inProgressTasks.add(t.id);
    }
  };

  lifeCycle.printTaskTerminalOutput = (task, taskStatus, terminalOutput) => {
    tasksToTerminalOutputs[task.id] = { terminalOutput, taskStatus };
    taskIdsInOrderOfCompletion.push(task.id);
  };

  lifeCycle.endTasks = (taskResults) => {
    for (let t of taskResults) {
      totalCompletedTasks++;
      inProgressTasks.delete(t.task.id);

      switch (t.status) {
        case 'remote-cache':
        case 'local-cache':
        case 'local-cache-kept-existing':
          totalCachedTasks++;
          totalSuccessfulTasks++;
          break;
        case 'success':
          totalSuccessfulTasks++;
          break;
        case 'failure':
          totalFailedTasks++;
          failedTasks.add(t.task.id);
          break;
      }
    }
  };

  lifeCycle.endCommand = () => {
    timeTakenText = prettyTime(process.hrtime(start));
  };

  const printSummary = () => {
    const lines = [''];
    // Handles when the user interrupts the process
    timeTakenText ??= prettyTime(process.hrtime(start));

    // Treats cancellation as a failure
    const failure = totalFailedTasks > 0 || inProgressTasks.size > 0;

    if (totalTasks === 0) {
      console.log(output.applyNxPrefix('gray', 'No tasks were run'));
      return;
    }

    const initiatingTaskId = initiatingProject
      ? createTaskId(initiatingProject, targets[0], args.configuration)
      : null;

    for (const taskId of taskIdsInOrderOfCompletion) {
      if (taskId !== initiatingTaskId) {
        const { terminalOutput, taskStatus } = tasksToTerminalOutputs[taskId];
        if (taskStatus === 'failure') {
          output.logCommandOutput(taskId, taskStatus, terminalOutput);
          lines.push(
            `${LEFT_PAD}${output.colors.red(
              figures.cross
            )}${SPACER}${output.colors.gray('nx run ')}${taskId}`
          );
        } else {
          lines.push(
            `${LEFT_PAD}${output.colors.green(
              figures.tick
            )}${SPACER}${output.colors.gray('nx run ')}${taskId}`
          );
        }
      }
    }

    for (const taskId of inProgressTasks) {
      if (taskId !== initiatingTaskId) {
        lines.push(
          `${LEFT_PAD}${output.colors.cyan(
            figures.circleDotted
          )}${SPACER}${taskId}`
        );
      }
    }

    if (initiatingProject && targets?.length === 1) {
      const results = tasksToTerminalOutputs[initiatingTaskId];
      if (results) {
        output.logCommandOutput(
          initiatingTaskId,
          results.taskStatus,
          results.terminalOutput
        );
        output.addVerticalSeparator(failure ? 'red' : 'green');
      }
    } else if (totalTasks > 0) {
      lines.push(
        ...output.getVerticalSeparatorLines(failure ? 'red' : 'green')
      );
    }

    if (totalSuccessfulTasks === totalTasks) {
      const successSummaryRows = [];
      const text = `Successfully ran ${formatTargetsAndProjects(
        projectNames,
        targets,
        tasks
      )}`;
      const taskOverridesRows = [];
      if (Object.keys(overrides).length > 0) {
        taskOverridesRows.push('');
        taskOverridesRows.push(
          `${EXTENDED_LEFT_PAD}${output.dim.green('With additional flags:')}`
        );
        Object.entries(overrides)
          .map(([flag, value]) =>
            output.dim.green(formatFlags(EXTENDED_LEFT_PAD, flag, value))
          )
          .forEach((arg) => taskOverridesRows.push(arg));
      }

      successSummaryRows.push(
        ...[
          output.applyNxPrefix(
            'green',
            output.colors.green(text) + output.dim.white(` (${timeTakenText})`)
          ),
          ...taskOverridesRows,
        ]
      );
      if (totalCachedTasks > 0) {
        successSummaryRows.push(
          output.dim(
            `${EOL}Nx read the output from the cache instead of running the command for ${totalCachedTasks} out of ${totalTasks} tasks.`
          )
        );
      }
      lines.push(output.colors.green(successSummaryRows.join(EOL)));
    } else {
      const text = `${
        inProgressTasks.size ? 'Cancelled while running' : 'Ran'
      } ${formatTargetsAndProjects(projectNames, targets, tasks)}`;
      const taskOverridesRows = [];
      if (Object.keys(overrides).length > 0) {
        taskOverridesRows.push('');
        taskOverridesRows.push(
          `${EXTENDED_LEFT_PAD}${output.dim.red('With additional flags:')}`
        );
        Object.entries(overrides)
          .map(([flag, value]) =>
            output.dim.red(formatFlags(EXTENDED_LEFT_PAD, flag, value))
          )
          .forEach((arg) => taskOverridesRows.push(arg));
      }

      const numFailedToPrint = 5;
      const failedTasksForPrinting = Array.from(failedTasks).slice(
        0,
        numFailedToPrint
      );
      const failureSummaryRows = [
        output.applyNxPrefix(
          'red',
          output.colors.red(text) + output.dim.white(` (${timeTakenText})`)
        ),
        ...taskOverridesRows,
        '',
        output.dim(
          `${LEFT_PAD}${output.dim(
            figures.tick
          )}${SPACER}${totalSuccessfulTasks}${`/${totalCompletedTasks}`} succeeded ${output.dim(
            `[${totalCachedTasks} read from cache]`
          )}`
        ),
        '',
        `${LEFT_PAD}${output.colors.red(
          figures.cross
        )}${SPACER}${totalFailedTasks}${`/${totalCompletedTasks}`} targets failed, including the following:`,
        '',
        `${failedTasksForPrinting
          .map(
            (t) =>
              `${EXTENDED_LEFT_PAD}${output.colors.red(
                '-'
              )} ${output.formatCommand(t.toString())}`
          )
          .join('\n')}`,
      ];

      if (failedTasks.size > numFailedToPrint) {
        failureSummaryRows.push(
          output.dim(
            `${EXTENDED_LEFT_PAD}...and ${
              failedTasks.size - numFailedToPrint
            } more...`
          )
        );
      }

      failureSummaryRows.push(...viewLogsFooterRows(failedTasks.size));

      lines.push(output.colors.red(failureSummaryRows.join(EOL)));
    }

    // adds some vertical space after the summary to avoid bunching against terminal
    lines.push('');

    console.log(lines.join(EOL));
  };
  return { lifeCycle, printSummary };
}
