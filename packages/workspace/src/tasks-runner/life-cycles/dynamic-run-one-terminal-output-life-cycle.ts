import * as cliCursor from 'cli-cursor';
import { dots } from 'cli-spinners';
import { EOL } from 'os';
import * as readline from 'readline';
import { output } from '../../utilities/output';
import type { LifeCycle } from '../life-cycle';
import type { Task, TaskStatus } from '../tasks-runner';
import { prettyTime } from './pretty-time';
import { StaticRunOneTerminalOutputLifeCycle } from './static-run-one-terminal-output-life-cycle';

type State =
  | 'EXECUTING_DEPENDENT_TARGETS'
  | 'EXECUTING_INITIATING_PROJECT_TARGET'
  | 'COMPLETED_SUCCESSFULLY'
  | 'COMPLETED_WITH_ERRORS';

/**
 * The following function is responsible for creating a life cycle with dynamic
 * outputs, meaning previous outputs can be rewritten or modified as new outputs
 * are added. It is therefore intended for use on a user's local machines.
 *
 * In CI environments the static equivalent of this life cycle should be used.
 */
export async function createRunOneDynamicOutputRenderer({
  initiatingProject,
  projectNames,
  tasks,
  args,
  overrides,
}: {
  initiatingProject: string;
  projectNames: string[];
  tasks: Task[];
  args: { target?: string; configuration?: string; parallel?: number };
  overrides: Record<string, unknown>;
}): Promise<{ lifeCycle: LifeCycle; renderIsDone: Promise<void> }> {
  cliCursor.hide();
  let resolveRenderIsDonePromise: (value: void) => void;
  const renderIsDone = new Promise<void>(
    (resolve) => (resolveRenderIsDonePromise = resolve)
  ).then(() => {
    clearRenderInterval();
    cliCursor.show();
  });

  function clearRenderInterval() {
    if (renderProjectRowsIntervalId) {
      clearInterval(renderProjectRowsIntervalId);
    }
  }

  process.on('exit', () => clearRenderInterval());
  process.on('SIGINT', () => clearRenderInterval());
  process.on('SIGTERM', () => clearRenderInterval());
  process.on('SIGHUP', () => clearRenderInterval());

  const lifeCycle = {} as Partial<LifeCycle>;
  const isVerbose = overrides.verbose === true;

  const start = process.hrtime();
  const figures = await import('figures');

  const totalTasks = tasks.length;
  const totalProjects = projectNames.length;
  const totalDependentTasks = totalTasks - 1;
  const totalTasksFromInitiatingProject = tasks.filter(
    (t) => t.target.project === initiatingProject
  ).length;
  // Tasks from initiating project are treated differently, they forward their output
  const totalDependentTasksNotFromInitiatingProject =
    totalTasks - totalTasksFromInitiatingProject;

  const targetName = args.target;

  let state: State = 'EXECUTING_DEPENDENT_TARGETS';

  const tasksToProcessStartTimes: Record<
    string,
    ReturnType<NodeJS.HRTime>
  > = {};
  let hasTaskOutput = false;
  let pinnedFooterNumLines = 0;
  let totalCompletedTasks = 0;
  let totalSuccessfulTasks = 0;
  let totalFailedTasks = 0;
  let totalCachedTasks = 0;

  // Used to control the rendering of the spinner on each project row
  let projectRowsCurrentFrame = 0;
  let renderProjectRowsIntervalId: NodeJS.Timeout | undefined;

  const clearPinnedFooter = () => {
    for (let i = 0; i < pinnedFooterNumLines; i++) {
      readline.moveCursor(process.stdout, 0, -1);
      readline.clearLine(process.stdout, 0);
    }
  };

  const renderPinnedFooter = (
    lines: string[],
    dividerColor = 'cyan',
    renderDivider = true
  ) => {
    let additionalLines = 0;
    if (renderDivider) {
      output.addVerticalSeparator(dividerColor);
      additionalLines += 3;
    }
    // Create vertical breathing room for cursor position under the pinned footer
    if (renderDivider) {
      lines.push('');
    }
    for (const line of lines) {
      process.stdout.write(output.X_PADDING + line + EOL);
    }
    pinnedFooterNumLines = lines.length + additionalLines;
  };

  const renderProjectRows = (renderDivider = true) => {
    if (totalDependentTasksNotFromInitiatingProject <= 0) {
      return;
    }
    const max = dots.frames.length - 1;
    const curr = projectRowsCurrentFrame;
    projectRowsCurrentFrame = curr >= max ? 0 : curr + 1;

    const additionalFooterRows: string[] = [''];
    const remainingDependentTasksNotFromInitiatingProject =
      totalDependentTasksNotFromInitiatingProject - totalCompletedTasks;

    switch (state) {
      case 'EXECUTING_DEPENDENT_TARGETS':
        additionalFooterRows.push(
          output.dim(
            `   ${output.dim.cyan(
              dots.frames[projectRowsCurrentFrame]
            )}    Waiting on ${remainingDependentTasksNotFromInitiatingProject} dependent project tasks before running tasks from ${output.colors.white(
              `${initiatingProject}`
            )}...`
          )
        );
        if (totalSuccessfulTasks > 0 || totalFailedTasks > 0) {
          additionalFooterRows.push('');
        }
        break;
    }

    if (totalFailedTasks > 0) {
      additionalFooterRows.push(
        `   ${output.colors.red(
          figures.cross
        )}    ${totalFailedTasks}${`/${totalCompletedTasks}`} failed`
      );
    }

    if (totalSuccessfulTasks > 0) {
      // if (remainingDependentTasksNotFromInitiatingProject === 0) {
      additionalFooterRows.push(
        output.colors.cyan.dim(
          `   ${output.colors.cyan(
            figures.tick
          )}    ${totalSuccessfulTasks}${`/${totalCompletedTasks}`} dependent project tasks succeeded ${output.colors.gray(
            `[${totalCachedTasks} read from cache]`
          )}`
        )
      );
      // } else {
      //   additionalFooterRows.push(
      //     `   ${output.colors.green(
      //       figures.tick
      //     )}    ${totalSuccessfulTasks}${`/${totalCompletedTasks}`} dependent project tasks succeeded ${output.colors.gray(
      //       `[${totalCachedTasks} read from cache]`
      //     )}`
      //   );
      // }
    }

    clearPinnedFooter();

    if (additionalFooterRows.length > 1) {
      let text = `Running target ${output.bold.cyan(
        targetName
      )} for project ${output.bold.cyan(initiatingProject)}`;
      if (totalDependentTasks > 0) {
        text += ` and ${output.bold(
          totalDependentTasks
        )} task(s) it depends on`;
      }

      const taskOverridesRows = [];
      if (Object.keys(overrides).length > 0) {
        const leftPadding = `${output.X_PADDING}       `;
        taskOverridesRows.push('');
        taskOverridesRows.push(
          `${leftPadding}${output.dim.cyan('With additional flags:')}`
        );
        Object.entries(overrides)
          .map(([flag, value]) =>
            output.dim.cyan(`${leftPadding}  --${flag}=${value}`)
          )
          .forEach((arg) => taskOverridesRows.push(arg));
      }

      const pinnedFooterLines = [
        output.applyNxPrefix('cyan', output.colors.cyan(text)),
        ...taskOverridesRows,
        ...additionalFooterRows,
      ];

      // Vertical breathing room when there isn't yet any output or divider
      if (!hasTaskOutput) {
        pinnedFooterLines.unshift('');
      }

      renderPinnedFooter(
        pinnedFooterLines,
        'cyan',
        renderDivider && state !== 'EXECUTING_DEPENDENT_TARGETS'
      );
    } else {
      renderPinnedFooter([]);
    }
  };

  lifeCycle.startCommand = () => {
    renderProjectRows();
  };

  lifeCycle.endCommand = () => {
    clearRenderInterval();
    const timeTakenText = prettyTime(process.hrtime(start));

    if (totalSuccessfulTasks === totalTasks) {
      let text = `Successfully ran target ${output.bold(
        targetName
      )} for project ${output.bold(initiatingProject)}`;
      if (totalDependentTasks > 0) {
        text += ` and ${output.bold(
          totalDependentTasks
        )} task(s) it depends on`;
      }

      const taskOverridesRows = [];
      if (Object.keys(overrides).length > 0) {
        const leftPadding = `${output.X_PADDING}       `;
        taskOverridesRows.push('');
        taskOverridesRows.push(
          `${leftPadding}${output.dim.green('With additional flags:')}`
        );
        Object.entries(overrides)
          .map(([flag, value]) =>
            output.dim.green(`${leftPadding}  --${flag}=${value}`)
          )
          .forEach((arg) => taskOverridesRows.push(arg));
      }

      const pinnedFooterLines = [
        output.applyNxPrefix(
          'green',
          output.colors.green(text) + output.dim.white(` (${timeTakenText})`)
        ),
        ...taskOverridesRows,
      ];
      if (totalCachedTasks > 0) {
        pinnedFooterLines.push(
          output.colors.gray(
            `${EOL}   Nx read the output from the cache instead of running the command for ${totalCachedTasks} out of ${totalTasks} tasks.`
          )
        );
      }
      renderPinnedFooter(pinnedFooterLines, 'green');
    } else {
      let text = `Ran target ${output.bold(targetName)} for ${output.bold(
        totalProjects
      )} projects`;
      if (totalDependentTasks > 0) {
        text += ` and ${output.bold(
          totalDependentTasks
        )} task(s) it depends on`;
      }

      const taskOverridesRows = [];
      if (Object.keys(overrides).length > 0) {
        const leftPadding = `${output.X_PADDING}       `;
        taskOverridesRows.push('');
        taskOverridesRows.push(
          `${leftPadding}${output.dim.red('With additional flags:')}`
        );
        Object.entries(overrides)
          .map(([flag, value]) =>
            output.dim.red(`${leftPadding}  --${flag}=${value}`)
          )
          .forEach((arg) => taskOverridesRows.push(arg));
      }

      renderPinnedFooter(
        [
          output.applyNxPrefix(
            'red',
            output.colors.red(text) + output.dim.white(` (${timeTakenText})`)
          ),
          ...taskOverridesRows,
          '',
          `   ${output.colors.red(
            figures.cross
          )}    ${totalFailedTasks}${`/${totalCompletedTasks}`} failed`,
          `   ${output.colors.gray(
            figures.tick
          )}    ${totalSuccessfulTasks}${`/${totalCompletedTasks}`} succeeded ${output.colors.gray(
            `[${totalCachedTasks} read from cache]`
          )}`,
        ],
        'red'
      );
    }
    resolveRenderIsDonePromise();
  };

  lifeCycle.startTasks = (tasks: Task[]) => {
    for (const task of tasks) {
      tasksToProcessStartTimes[task.id] = process.hrtime();
      if (
        task.target.project === initiatingProject &&
        state !== 'EXECUTING_INITIATING_PROJECT_TARGET'
      ) {
        state = 'EXECUTING_INITIATING_PROJECT_TARGET';
        clearRenderInterval();
        renderProjectRows(false);
        if (totalDependentTasksNotFromInitiatingProject > 0) {
          output.addVerticalSeparator('cyan');
        }
      }
    }
    if (
      !renderProjectRowsIntervalId &&
      state === 'EXECUTING_DEPENDENT_TARGETS'
    ) {
      renderProjectRowsIntervalId = setInterval(renderProjectRows, 100);
    }
  };

  lifeCycle.printTaskTerminalOutput = (task, cacheStatus, terminalOutput) => {
    if (task.target.project === initiatingProject) {
      output.logCommand(task.id, cacheStatus);
      output.addNewline();
      process.stdout.write(terminalOutput);
    }
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
          break;
      }
    }
  };

  return { lifeCycle, renderIsDone };
}

function writeLine(line: string) {
  const additionalXPadding = '   ';
  process.stdout.write(output.X_PADDING + additionalXPadding + line + EOL);
}

/**
 * There's not much we can do in order to "neaten up" the outputs of
 * commands we do not control, but at the very least we can trim any
 * leading whitespace and any _excess_ trailing newlines so that there
 * isn't unncecessary vertical whitespace.
 */
function writeCommandOutputBlock(commandOutput: string) {
  commandOutput = commandOutput || '';
  commandOutput = commandOutput.trimStart();
  const additionalXPadding = '      ';
  const lines = commandOutput.split(EOL);
  let totalTrailingEmptyLines = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i] !== '') {
      break;
    }
    totalTrailingEmptyLines++;
  }
  if (totalTrailingEmptyLines > 1) {
    const linesToRemove = totalTrailingEmptyLines - 1;
    lines.splice(lines.length - linesToRemove, linesToRemove);
  }
  // Indent the command output to make it look more "designed" in the context of the dynamic output
  process.stdout.write(
    lines.map((l) => `${output.X_PADDING}${additionalXPadding}${l}`).join(EOL) +
      EOL
  );
}
