import type { LifeCycle } from '@nrwl/workspace/src/tasks-runner/life-cycle';
import * as chalk from 'chalk';
import { dots } from 'cli-spinners';
import { EOL } from 'os';
import * as readline from 'readline';
import type { Task, TaskStatus } from '../tasks-runner';
import { prettyTime } from './pretty-time';

const X_PADDING = ' ';

function applyNxPrefix(color = 'cyan', text: string) {
  return `${chalk[color]('>')} ${chalk.reset.inverse.bold[color](
    ' NX '
  )}  ${text}`;
}

function writeLine(line: string) {
  const additionalXPadding = '   ';
  process.stdout.write(X_PADDING + additionalXPadding + line + EOL);
}

function writeCommandOutputBlock(output: string) {
  output = output || '';
  const additionalXPadding = '      ';
  const lines = output.split(EOL);
  /**
   * There's not much we can do in order to "neaten up" the outputs of
   * commands we do not control, but at the very least we can trim excess
   * newlines so that there isn't unncecessary vertical whitespace.
   */
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
  process.stdout.write(
    lines.map((l) => `${X_PADDING}${additionalXPadding}${l}`).join(EOL) + EOL
  );
}

export async function createOutputRenderer({
  projectNames,
  tasks,
  args,
  overrides,
}: {
  projectNames: string[];
  tasks: Task[];
  args: { target?: string; configuration?: string; parallel?: number };
  overrides: Record<string, unknown>;
}): Promise<{ lifeCycle: LifeCycle; renderIsDone: Promise<void> }> {
  let resolveRenderIsDonePromise: (value: void) => void;
  const renderIsDone = new Promise<void>(
    (resolve) => (resolveRenderIsDonePromise = resolve)
  ).then(() => clearRenderInterval());

  function clearRenderInterval() {
    if (renderProjectRowsIntervalId) {
      clearInterval(renderProjectRowsIntervalId);
    }
  }

  function teardown() {
    clearRenderInterval();
    if (resolveRenderIsDonePromise) {
      resolveRenderIsDonePromise();
    }
  }

  process.on('exit', () => teardown());
  process.on('SIGINT', () => teardown());
  process.on('unhandledRejection', () => teardown());
  process.on('uncaughtException', () => teardown());

  const lifeCycle = {} as any;
  const isVerbose = overrides.verbose === true;

  const start = process.hrtime();
  const figures = await import('figures');

  const totalTasks = tasks.length;
  const totalProjects = projectNames.length;
  const totalDependentTasks = totalTasks - totalProjects;
  const targetName = args.target;
  const projectRows = projectNames.map((projectName) => {
    return {
      projectName,
      status: 'pending',
    };
  });

  const tasksToTerminalOutputs: Record<string, string> = {};
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

  const renderPinnedFooter = (lines: string[], dividerColor = 'cyan') => {
    let additionalLines = 0;
    if (hasTaskOutput) {
      let divider = '';
      for (let i = 0; i < process.stdout.columns - X_PADDING.length * 2; i++) {
        divider += '\u2014';
      }
      process.stdout.write(EOL);
      process.stdout.write(
        X_PADDING + chalk.dim[dividerColor](divider + EOL) + EOL
      );
      additionalLines += 3;
    }
    // Create vertical breathing room for cursor position under the pinned footer
    lines.push('');
    for (const line of lines) {
      process.stdout.write(X_PADDING + line + EOL);
    }
    pinnedFooterNumLines = lines.length + additionalLines;
  };

  const printTaskResult = (task: Task, status: TaskStatus) => {
    clearPinnedFooter();
    // If this is the very first output, add some vertical breathing room
    if (!hasTaskOutput) {
      process.stdout.write(EOL);
    }
    hasTaskOutput = true;

    switch (status) {
      case 'local-cache':
        writeLine(
          `${
            chalk.green(figures.tick) + chalk.dim('  nx run ') + task.id
          }  ${chalk.gray('[local cache]')}`
        );
        if (isVerbose) {
          process.stdout.write(EOL);
          writeCommandOutputBlock(tasksToTerminalOutputs[task.id]);
        }
        break;
      case 'remote-cache':
        writeLine(
          `${
            chalk.green(figures.tick) + chalk.dim('  nx run ') + task.id
          }  ${chalk.gray('[remote cache]')}`
        );
        if (isVerbose) {
          process.stdout.write(EOL);
          writeCommandOutputBlock(tasksToTerminalOutputs[task.id]);
        }
        break;
      case 'success': {
        const timeTakenText = prettyTime(
          process.hrtime(tasksToProcessStartTimes[task.id])
        );
        writeLine(
          chalk.green(figures.tick) +
            chalk.dim('  nx run ') +
            task.id +
            chalk.dim.gray(` (${timeTakenText})`)
        );
        if (isVerbose) {
          process.stdout.write(EOL);
          writeCommandOutputBlock(tasksToTerminalOutputs[task.id]);
        }
        break;
      }
      case 'failure':
        process.stdout.write(EOL);
        writeLine(
          chalk.red(figures.cross) + chalk.dim('  nx run ') + chalk.red(task.id)
        );
        writeCommandOutputBlock(tasksToTerminalOutputs[task.id]);
        break;
    }

    delete tasksToTerminalOutputs[task.id];
    renderPinnedFooter([]);
    renderProjectRows();
  };

  const renderProjectRows = () => {
    const max = dots.frames.length - 1;
    const curr = projectRowsCurrentFrame;
    projectRowsCurrentFrame = curr >= max ? 0 : curr + 1;

    const additionalFooterRows: string[] = [''];
    const runningTasks = projectRows.filter((row) => row.status === 'running');
    const remainingTasks = totalTasks - totalCompletedTasks;

    if (runningTasks.length > 0) {
      additionalFooterRows.push(
        chalk.dim(
          `   ${chalk.cyan(figures.arrowRight)}    Executing ${
            runningTasks.length
          }/${remainingTasks} remaining tasks${
            runningTasks.length > 1 ? ' in parallel' : ''
          }...`
        )
      );
      additionalFooterRows.push('');
      for (const projectRow of runningTasks) {
        additionalFooterRows.push(
          `   ${chalk.dim.cyan(dots.frames[projectRowsCurrentFrame])}    ${
            chalk.dim('nx run ') + projectRow.projectName + ':' + targetName
          }`
        );
      }
      /**
       * Reduce layout thrashing by ensuring that there is a relatively consistent
       * height for the area in which the task rows are rendered.
       *
       * We can look at the parallel flag to know how many rows are likely to be
       * needed in the common case and always render that at least that many.
       */
      if (
        totalCompletedTasks !== totalTasks &&
        Number.isInteger(args.parallel) &&
        runningTasks.length < args.parallel
      ) {
        // Don't bother with this optimization if there are fewer tasks remaining than rows required
        if (remainingTasks >= args.parallel) {
          for (let i = runningTasks.length; i < args.parallel; i++) {
            additionalFooterRows.push('');
          }
        }
      }
    }

    if (totalSuccessfulTasks > 0 || totalFailedTasks > 0) {
      additionalFooterRows.push('');
    }

    if (totalFailedTasks > 0) {
      additionalFooterRows.push(
        `   ${chalk.red(
          figures.cross
        )}    ${totalFailedTasks}${`/${totalCompletedTasks}`} failed`
      );
    }

    if (totalSuccessfulTasks > 0) {
      additionalFooterRows.push(
        `   ${chalk.green(
          figures.tick
        )}    ${totalSuccessfulTasks}${`/${totalCompletedTasks}`} succeeded ${chalk.gray(
          `[${totalCachedTasks} read from cache]`
        )}`
      );
    }

    clearPinnedFooter();

    if (additionalFooterRows.length > 1) {
      let text = `Running target ${chalk.bold.cyan(
        targetName
      )} for ${chalk.bold.cyan(totalProjects)} projects`;
      if (totalDependentTasks > 0) {
        text += ` and ${chalk.bold(
          totalDependentTasks
        )} task(s) they depend on`;
      }

      const taskOverridesRows = [];
      if (Object.keys(overrides).length > 0) {
        const leftPadding = `${X_PADDING}       `;
        taskOverridesRows.push('');
        taskOverridesRows.push(
          `${leftPadding}${chalk.dim.cyan('With additional flags:')}`
        );
        Object.entries(overrides)
          .map(([flag, value]) =>
            chalk.dim.cyan(`${leftPadding}  --${flag}=${value}`)
          )
          .forEach((arg) => taskOverridesRows.push(arg));
      }

      const pinnedFooterLines = [
        applyNxPrefix('cyan', chalk.cyan(text)),
        ...taskOverridesRows,
        ...additionalFooterRows,
      ];

      // Vertical breathing room when there isn't yet any output or divider
      if (!hasTaskOutput) {
        pinnedFooterLines.unshift('');
      }

      renderPinnedFooter(pinnedFooterLines);
    } else {
      renderPinnedFooter([]);
    }
  };

  lifeCycle.startCommand = (params) => {
    if (totalProjects <= 0) {
      let description = `with target ${chalk.white.bold(targetName)}`;
      if (params?.args.configuration) {
        description += ` that are configured for "${params.args.configuration}"`;
      }
      renderPinnedFooter([
        '',
        applyNxPrefix('gray', `No projects ${description} were run`),
      ]);
      resolveRenderIsDonePromise();
      return;
    }
    renderPinnedFooter([]);
  };

  lifeCycle.startTasks = (tasks: Task[]) => {
    for (const task of tasks) {
      tasksToProcessStartTimes[task.id] = process.hrtime();
    }
    for (const projectRow of projectRows) {
      const matchedTask = tasks.find(
        (t) => t.target.project === projectRow.projectName
      );
      if (!matchedTask) {
        continue;
      }
      projectRow.status = 'running';
    }
    if (!renderProjectRowsIntervalId) {
      renderProjectRowsIntervalId = setInterval(renderProjectRows, 100);
    }
  };

  lifeCycle.printTaskTerminalOutput = (task, _cacheStatus, output) => {
    tasksToTerminalOutputs[task.id] = output;
  };

  lifeCycle.endTasks = (taskResults) => {
    totalCompletedTasks++;

    for (let t of taskResults) {
      const matchingProjectRow = projectRows.find(
        (pr) => pr.projectName === t.task.target.project
      );
      if (matchingProjectRow) {
        matchingProjectRow.status = t.status;
      }

      switch (t.status) {
        case 'remote-cache':
        case 'local-cache':
          totalCachedTasks++;
        case 'success':
          totalSuccessfulTasks++;
          break;
        case 'failure':
          totalFailedTasks++;
          break;
      }

      printTaskResult(t.task, t.status);
    }

    if (totalCompletedTasks === totalTasks) {
      clearRenderInterval();
      const timeTakenText = prettyTime(process.hrtime(start));

      clearPinnedFooter();

      if (totalSuccessfulTasks === totalTasks) {
        let text = `Successfully ran target ${chalk.bold(
          targetName
        )} for ${chalk.bold(totalProjects)} projects`;
        if (totalDependentTasks > 0) {
          text += ` and ${chalk.bold(
            totalDependentTasks
          )} task(s) they depend on`;
        }

        const pinnedFooterLines = [
          applyNxPrefix(
            'green',
            chalk.green(text) + chalk.dim.white(` (${timeTakenText})`)
          ),
        ];
        if (totalCachedTasks > 0) {
          pinnedFooterLines.push(
            chalk.gray(
              `\n   Nx read the output from the cache instead of running the command for ${totalCachedTasks} out of ${totalTasks} tasks.`
            )
          );
        }
        renderPinnedFooter(pinnedFooterLines, 'green');
      } else {
        let text = `Ran target ${chalk.bold(targetName)} for ${chalk.bold(
          totalProjects
        )} projects`;
        if (totalDependentTasks > 0) {
          text += ` and ${chalk.bold(
            totalDependentTasks
          )} task(s) they depend on`;
        }

        renderPinnedFooter(
          [
            applyNxPrefix(
              'red',
              chalk.red(text) + chalk.dim.white(` (${timeTakenText})`)
            ),
            '',
            `   ${chalk.red(
              figures.cross
            )}    ${totalFailedTasks}${`/${totalCompletedTasks}`} failed`,
            `   ${chalk.gray(
              figures.tick
            )}    ${totalSuccessfulTasks}${`/${totalCompletedTasks}`} succeeded ${chalk.gray(
              `[${totalCachedTasks} read from cache]`
            )}`,
          ],
          'red'
        );
      }
      resolveRenderIsDonePromise();
    }
  };

  return { lifeCycle, renderIsDone };
}
