import * as cliCursor from 'cli-cursor';
import { dots } from 'cli-spinners';
import { EOL } from 'os';
import * as readline from 'readline';
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

  let resolveRenderIsDonePromise: (value: void) => void;
  const renderIsDone = new Promise<void>(
    (resolve) => (resolveRenderIsDonePromise = resolve)
  );

  const start = process.hrtime();
  const targets = args.targets;
  const totalTasks = tasks.length;

  let totalCachedTasks = 0;
  let totalSuccessfulTasks = 0;
  let totalFailedTasks = 0;
  let totalCompletedTasks = 0;
  let timeTakenText: string;

  const failedTasks = new Set<string>();
  const tasksToTerminalOutputs: Record<
    string,
    { terminalOutput: string; taskStatus: TaskStatus }
  > = {};

  lifeCycle.printTaskTerminalOutput = (task, taskStatus, terminalOutput) => {
    tasksToTerminalOutputs[task.id] = { terminalOutput, taskStatus };
  };

  lifeCycle.endTasks = (taskResults) => {
    for (let t of taskResults) {
      totalCompletedTasks++;

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
    if (totalTasks === 0) {
      console.log(output.applyNxPrefix('gray', 'No tasks were run'));
      return;
    }

    if (initiatingProject && targets?.length === 1) {
      const ranTask = createTaskId(
        initiatingProject,
        targets[0],
        args.configuration
      );
      const results = tasksToTerminalOutputs[ranTask];
      if (ranTask && results) {
        output.logCommandOutput(
          ranTask,
          results.taskStatus,
          results.terminalOutput
        );
        output.addVerticalSeparator('gray');
      }
    }

    if (totalSuccessfulTasks === totalTasks) {
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

      const lines = [
        output.applyNxPrefix(
          'green',
          output.colors.green(text) + output.dim.white(` (${timeTakenText})`)
        ),
        ...taskOverridesRows,
      ];
      if (totalCachedTasks > 0) {
        lines.push(
          output.dim(
            `${EOL}Nx read the output from the cache instead of running the command for ${totalCachedTasks} out of ${totalTasks} tasks.`
          )
        );
      }
      console.log(output.colors.green(lines.join(EOL)));
    } else {
      const text = `Ran ${formatTargetsAndProjects(
        projectNames,
        targets,
        tasks
      )}`;
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

      console.log(output.colors.red(failureSummaryRows.join(EOL)));
    }
  };
  return { lifeCycle, printSummary };
}
