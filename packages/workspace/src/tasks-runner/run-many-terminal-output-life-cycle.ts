import type { Task } from '@nrwl/devkit';
import { neoOutput, TaskCacheStatus } from '../utilities/output';
import { LifeCycle } from './life-cycle';
import { TaskStatus } from './tasks-runner';
import { getCommandArgsForTask } from './utils';

export class RunManyTerminalOutputLifeCycle implements LifeCycle {
  failedTasks = [] as Task[];
  cachedTasks = [] as Task[];
  skippedTasks = [] as Task[];

  constructor(
    private readonly projectNames: string[],
    private readonly tasks: Task[],
    private readonly args: {
      target?: string;
      configuration?: string;
    },
    private readonly taskOverrides: any
  ) {}

  startCommand(): void {
    if (this.projectNames.length <= 0) {
      let description = `with "${this.args.target}"`;
      if (this.args.configuration) {
        description += ` that are configured for "${this.args.configuration}"`;
      }
      neoOutput.logSingleLine(`No projects ${description} were run`);
      return;
    }

    const bodyLines = this.projectNames.map(
      (affectedProject) => ` ${neoOutput.colors.gray('-')} ${affectedProject}`
    );
    if (Object.keys(this.taskOverrides).length > 0) {
      bodyLines.push('');
      bodyLines.push(`${neoOutput.colors.gray('With flags:')}`);
      Object.entries(this.taskOverrides)
        .map(([flag, value]) => `  --${flag}=${value}`)
        .forEach((arg) => bodyLines.push(arg));
    }

    let title = `Running target ${neoOutput.bold(
      this.args.target
    )} for ${neoOutput.bold(this.projectNames.length)} projects`;
    const dependentTasksCount = this.tasks.length - this.projectNames.length;
    if (dependentTasksCount > 0) {
      title += ` and ${neoOutput.bold(
        dependentTasksCount
      )} task(s) they depend on`;
    }
    title += ':';

    neoOutput.log({
      color: 'cyan',
      title,
      bodyLines,
    });

    neoOutput.addVerticalSeparatorWithoutNewLines('cyan');
  }

  endCommand(): void {
    neoOutput.addNewline();

    if (this.failedTasks.length === 0) {
      neoOutput.addVerticalSeparatorWithoutNewLines('green');

      const bodyLines =
        this.cachedTasks.length > 0
          ? [
              neoOutput.colors.gray(
                `Nx read the output from the cache instead of running the command for ${this.cachedTasks.length} out of ${this.tasks.length} tasks.`
              ),
            ]
          : [];

      neoOutput.success({
        title: `Successfully ran target ${neoOutput.bold(
          this.args.target
        )} for ${neoOutput.bold(this.projectNames.length)} projects`,
        bodyLines,
      });
    } else {
      neoOutput.addVerticalSeparatorWithoutNewLines('red');

      const bodyLines = [];
      if (this.skippedTasks.length > 0) {
        bodyLines.push(
          neoOutput.colors.gray(
            'Tasks not run because their dependencies failed:'
          ),
          '',
          ...this.skippedTasks.map(
            (task) => `${neoOutput.colors.gray('-')} ${task.id}`
          ),
          ''
        );
      }
      bodyLines.push(
        neoOutput.colors.gray('Failed tasks:'),
        '',
        ...this.failedTasks.map(
          (task) => `${neoOutput.colors.gray('-')} ${task.id}`
        )
      );
      neoOutput.error({
        title: `Running target "${this.args.target}" failed`,
        bodyLines,
      });
    }
  }

  endTasks(
    taskResults: { task: Task; status: TaskStatus; code: number }[]
  ): void {
    for (let t of taskResults) {
      if (t.status === 'failure') {
        this.failedTasks.push(t.task);
      } else if (t.status === 'skipped') {
        this.skippedTasks.push(t.task);
      } else if (t.status === 'local-cache') {
        this.cachedTasks.push(t.task);
      } else if (t.status === 'remote-cache') {
        this.cachedTasks.push(t.task);
      }
    }
  }

  printTaskTerminalOutput(
    task: Task,
    cacheStatus: TaskCacheStatus,
    terminalOutput: string
  ) {
    const args = getCommandArgsForTask(task);
    neoOutput.logCommand(
      `${args.filter((a) => a !== 'run').join(' ')}`,
      cacheStatus
    );
    neoOutput.writeCommandOutputBlock(terminalOutput);
  }
}
