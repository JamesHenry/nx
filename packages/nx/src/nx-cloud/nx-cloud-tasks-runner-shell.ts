import { Task } from '../config/task-graph';
import {
  defaultTasksRunner,
  DefaultTasksRunnerOptions,
} from '../tasks-runner/default-tasks-runner';
import { TasksRunner } from '../tasks-runner/tasks-runner';
import { output } from '../utils/output';
import { workspaceRoot } from '../utils/workspace-root';
import { findAncestorNodeModules } from './resolution-helpers';
import {
  NxCloudClientUnavailableError,
  NxCloudEnterpriseOutdatedError,
  verifyOrUpdateNxCloudClient,
} from './update-manager';

export interface CloudTaskRunnerOptions extends DefaultTasksRunnerOptions {
  accessToken?: string;
  canTrackAnalytics?: boolean;
  encryptionKey?: string;
  maskedProperties?: string[];
  showUsageWarnings?: boolean;
  customProxyConfigPath?: string;
  useLatestApi?: boolean;
  url?: string;
  useLightClient?: boolean;
  clientVersion?: string;
  nxCloudId?: string;
}

const originalStdoutWrite = process.stdout.write;

export const nxCloudTasksRunnerShell: TasksRunner<
  CloudTaskRunnerOptions
> = async (tasks: Task[], options: CloudTaskRunnerOptions, context) => {
  try {
    if (process.env.NX_TUI === 'true') {
      const { writeFileSync, rmSync } = require('node:fs');
      const { join } = require('node:path');
      const { stripVTControlCharacters } = require('node:util');

      // Remove any previous log file
      const logFilePath = join(
        workspaceRoot,
        '.nx',
        'cache',
        'cloud',
        'client-messages-for-tui.json'
      );
      rmSync(logFilePath, { force: true });

      /**
       * Patch stdout.write method to save Nx Cloud client logs to a file for the TUI to read and handle instead of printing directly.
       * The TUI writes to stderr, so this does not interfere with that.
       */
      const createPatchedLogWrite = (
        originalWrite: typeof process.stdout.write
      ): typeof process.stdout.write => {
        // @ts-ignore
        return (chunk, encoding, callback) => {
          // Check if the log came from the Nx Cloud client, otherwise invoke the original write method
          const stackTrace = new Error().stack;
          const isNxCloudLog = stackTrace.includes(
            join(workspaceRoot, '.nx', 'cache', 'cloud')
          );
          if (!isNxCloudLog) {
            return originalWrite(chunk, encoding, callback);
          }

          // Do not bother to store logs with only whitespace characters, they aren't relevant for the TUI
          const trimmedChunk = chunk.toString().trim();
          if (trimmedChunk.length) {
            // Remove ANSI escape codes and create log entry for the TUI to pick up
            const logEntry = {
              content: stripVTControlCharacters(trimmedChunk),
            };
            writeFileSync(logFilePath, JSON.stringify(logEntry) + '\n');
          }
          // Preserve original behavior around callback and return value, just in case
          if (callback) {
            callback();
          }
          return true;
        };
      };

      process.stdout.write = createPatchedLogWrite(originalStdoutWrite);
    }

    const { nxCloudClient, version } = await verifyOrUpdateNxCloudClient(
      options
    );

    options.clientVersion = version;

    const paths = findAncestorNodeModules(__dirname, []);
    nxCloudClient.configureLightClientRequire()(paths);

    return nxCloudClient.nxCloudTasksRunner(tasks, options, context);
  } catch (e: any) {
    const body =
      e instanceof NxCloudEnterpriseOutdatedError
        ? [
            'If you are an Nx Enterprise customer, please reach out to your assigned Developer Productivity Engineer.',
            'If you are NOT an Nx Enterprise customer but are seeing this message, please reach out to cloud-support@nrwl.io.',
          ]
        : e instanceof NxCloudClientUnavailableError
        ? [
            'You might be offline. Nx Cloud will be re-enabled when you are back online.',
          ]
        : [];

    if (e instanceof NxCloudEnterpriseOutdatedError) {
      output.warn({
        title: e.message,
        bodyLines: ['Nx Cloud will not be used for this command.', ...body],
      });
    }
    const results = await defaultTasksRunner(tasks, options, context);
    output.warn({
      title: e.message,
      bodyLines: ['Nx Cloud was not used for this command.', ...body],
    });
    return results;
  }
};
