import type { Task } from '@nrwl/devkit';
import { neoOutput, TaskCacheStatus } from '../utilities/output';
import { LifeCycle } from './life-cycle';
import { TaskStatus } from './tasks-runner';
import { getCommandArgsForTask } from './utils';

export class RunOneTerminalOutputLifeCycle implements LifeCycle {
  failedTasks = [] as Task[];
  cachedTasks = [] as Task[];
  skippedTasks = [] as Task[];

  constructor(
    private readonly initiatingProject: string,
    private readonly projectNames: string[],
    private readonly tasks: Task[],
    private readonly args: {
      target?: string;
      configuration?: string;
    }
  ) {}

  startCommand(): void {
    if (process.env.NX_INVOKED_BY_RUNNER) {
      return;
    }
    const numberOfDeps = this.tasks.length - 1;

    if (numberOfDeps > 0) {
      neoOutput.log({
        color: 'cyan',
        title: `Running target ${neoOutput.bold(
          this.args.target
        )} for project ${neoOutput.bold(
          this.initiatingProject
        )} and ${neoOutput.bold(numberOfDeps)} task(s) it depends on`,
      });
      neoOutput.addVerticalSeparatorWithoutNewLines('cyan');
    }
  }

  endCommand(): void {
    // Silent for a single task
    if (process.env.NX_INVOKED_BY_RUNNER) {
      return;
    }
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
        )} for project ${neoOutput.bold(this.initiatingProject)}`,
        bodyLines,
      });
    } else {
      neoOutput.addVerticalSeparatorWithoutNewLines('red');

      const bodyLines = [
        neoOutput.colors.gray('Failed tasks:'),
        '',
        ...this.failedTasks.map(
          (task) => `${neoOutput.colors.gray('-')} ${task.id}`
        ),
        '',
        `${neoOutput.colors.gray(
          'Hint: run the command with'
        )} --verbose ${neoOutput.colors.gray('for more details.')}`,
      ];
      neoOutput.error({
        title: `Running target "${this.initiatingProject}:${this.args.target}" failed`,
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
    if (
      cacheStatus === TaskCacheStatus.NoCache ||
      task.target.project === this.initiatingProject
    ) {
      const args = getCommandArgsForTask(task);
      neoOutput.logCommand(
        `${args.filter((a) => a !== 'run').join(' ')}`,
        cacheStatus
      );
      neoOutput.writeCommandOutputBlock(terminalOutput);
    }
  }
}
