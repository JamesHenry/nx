import type { ProjectGraph, ProjectGraphNode } from '@nrwl/devkit';
import { render } from 'ink';
import * as React from 'react';
import { NxArgs } from '../../command-line/utils';
import { Environment } from '../../core/shared-interfaces';
import { Reporter } from '../reporter';
import { RunCommand } from './components/run-command';

export { createTask, createTasksForProjectToRun } from './utils';

export async function runCommand(
  projectsToRun: ProjectGraphNode[],
  projectGraph: ProjectGraph,
  { nxJson, workspaceResults }: Environment,
  nxArgs: NxArgs,
  overrides: any,
  reporter: Reporter,
  initiatingProject: string | null
) {
  render(
    React.createElement(RunCommand, {
      projectsToRun,
      projectGraph,
      nxJson,
      workspaceResults,
      nxArgs,
      overrides,
      reporter,
      initiatingProject,
    })
  );
}
