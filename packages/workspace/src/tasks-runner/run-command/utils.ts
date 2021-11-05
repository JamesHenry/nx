import type {
  NxJsonConfiguration,
  ProjectGraph,
  ProjectGraphNode,
  TargetDependencyConfig,
  Task,
} from '@nrwl/devkit';
import { logger } from '@nrwl/devkit';
import { stripIndent } from '@nrwl/tao/src/shared/logger';
import { appRootPath } from '@nrwl/tao/src/utils/app-root';
import { Box, measureElement, Static, Text } from 'ink';
import { join } from 'path';
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { of } from 'rxjs';
import { concatMap, delay } from 'rxjs/operators';
import { NxArgs } from '../../command-line/utils';
import { Hasher } from '../../core/hasher/hasher';
import { isRelativePath } from '../../utilities/fileutils';
import { output } from '../../utilities/output';
import {
  projectHasTarget,
  projectHasTargetAndConfiguration,
} from '../../utilities/project-graph-utils';
import { AffectedEventType, TasksRunner } from '../tasks-runner';
import { getDependencyConfigs } from '../utils';

export function createTask({
  project,
  target,
  configuration,
  overrides,
  errorIfCannotFindConfiguration,
}: TaskParams): Task {
  if (!projectHasTarget(project, target)) {
    output.error({
      title: `Cannot find target '${target}' for project '${project.name}'`,
    });
    process.exit(1);
  }

  configuration ??= project.data.targets?.[target]?.defaultConfiguration;

  const config = projectHasTargetAndConfiguration(
    project,
    target,
    configuration
  )
    ? configuration
    : undefined;

  if (errorIfCannotFindConfiguration && configuration && !config) {
    output.error({
      title: `Cannot find configuration '${configuration}' for project '${project.name}:${target}'`,
    });
    process.exit(1);
  }

  const qualifiedTarget = {
    project: project.name,
    target,
    configuration: config,
  };
  return {
    id: getId(qualifiedTarget),
    target: qualifiedTarget,
    projectRoot: project.data.root,
    overrides: interpolateOverrides(overrides, project.name, project.data),
  };
}

interface TaskParams {
  project: ProjectGraphNode;
  target: string;
  configuration: string;
  overrides: Object;
  errorIfCannotFindConfiguration: boolean;
}

export function createTasksForProjectToRun(
  projectsToRun: ProjectGraphNode[],
  params: Omit<TaskParams, 'project' | 'errorIfCannotFindConfiguration'>,
  projectGraph: ProjectGraph,
  initiatingProject: string | null,
  defaultDependencyConfigs: Record<string, TargetDependencyConfig[]> = {}
) {
  const tasksMap: Map<string, Task> = new Map<string, Task>();
  const seenSet = new Set<string>();

  for (const project of projectsToRun) {
    addTasksForProjectTarget(
      {
        project,
        ...params,
        errorIfCannotFindConfiguration: project.name === initiatingProject,
      },
      defaultDependencyConfigs,
      projectGraph,
      tasksMap,
      [],
      seenSet
    );
  }
  return Array.from(tasksMap.values());
}

function addTasksForProjectTarget(
  {
    project,
    target,
    configuration,
    overrides,
    errorIfCannotFindConfiguration,
  }: TaskParams,
  defaultDependencyConfigs: Record<string, TargetDependencyConfig[]> = {},
  projectGraph: ProjectGraph,
  tasksMap: Map<string, Task>,
  path: string[],
  seenSet: Set<string>
) {
  const task = createTask({
    project,
    target,
    configuration,
    overrides,
    errorIfCannotFindConfiguration,
  });

  const dependencyConfigs = getDependencyConfigs(
    { project: project.name, target },
    defaultDependencyConfigs,
    projectGraph
  );

  if (dependencyConfigs) {
    for (const dependencyConfig of dependencyConfigs) {
      addTasksForProjectDependencyConfig(
        project,
        {
          target,
          configuration,
        },
        dependencyConfig,
        defaultDependencyConfigs,
        projectGraph,
        tasksMap,
        path,
        seenSet
      );
    }
  }
  tasksMap.set(task.id, task);
}

function addTasksForProjectDependencyConfig(
  project: ProjectGraphNode,
  { target, configuration }: Pick<TaskParams, 'target' | 'configuration'>,
  dependencyConfig: TargetDependencyConfig,
  defaultDependencyConfigs: Record<string, TargetDependencyConfig[]>,
  projectGraph: ProjectGraph,
  tasksMap: Map<string, Task>,
  path: string[],
  seenSet: Set<string>
) {
  const targetIdentifier = getId({
    project: project.name,
    target,
    configuration,
  });
  seenSet.add(project.name);

  if (path.includes(targetIdentifier)) {
    output.error({
      title: `Could not execute ${path[0]} because it has a circular dependency`,
      bodyLines: [`${[...path, targetIdentifier].join(' --> ')}`],
    });
    process.exit(1);
  }

  if (tasksMap.has(targetIdentifier)) {
    return;
  }

  if (dependencyConfig.projects === 'dependencies') {
    const dependencies = projectGraph.dependencies[project.name];
    if (dependencies) {
      for (const dep of dependencies) {
        const depProject =
          projectGraph.nodes[dep.target] ||
          projectGraph.externalNodes[dep.target];
        if (projectHasTarget(depProject, dependencyConfig.target)) {
          addTasksForProjectTarget(
            {
              project: depProject,
              target: dependencyConfig.target,
              configuration,
              overrides: {},
              errorIfCannotFindConfiguration: false,
            },
            defaultDependencyConfigs,
            projectGraph,
            tasksMap,
            [...path, targetIdentifier],
            seenSet
          );
        } else {
          if (seenSet.has(dep.target)) {
            continue;
          }

          addTasksForProjectDependencyConfig(
            depProject,
            { target, configuration },
            dependencyConfig,
            defaultDependencyConfigs,
            projectGraph,
            tasksMap,
            path,
            seenSet
          );
        }
      }
    }
  } else {
    addTasksForProjectTarget(
      {
        project,
        target: dependencyConfig.target,
        configuration,
        overrides: {},
        errorIfCannotFindConfiguration: true,
      },
      defaultDependencyConfigs,
      projectGraph,
      tasksMap,
      [...path, targetIdentifier],
      seenSet
    );
  }
}

function getId({
  project,
  target,
  configuration,
}: {
  project: string;
  target: string;
  configuration?: string;
}): string {
  let id = `${project}:${target}`;
  if (configuration) {
    id += `:${configuration}`;
  }
  return id;
}

function interpolateOverrides<T = any>(
  args: T,
  projectName: string,
  projectMetadata: any
): T {
  const interpolatedArgs: T = { ...args };
  Object.entries(interpolatedArgs).forEach(([name, value]) => {
    if (typeof value === 'string') {
      const regex = /{project\.([^}]+)}/g;
      interpolatedArgs[name] = value.replace(regex, (_, group: string) => {
        if (group.includes('.')) {
          throw new Error('Only top-level properties can be interpolated');
        }

        if (group === 'name') {
          return projectName;
        }
        return projectMetadata[group];
      });
    }
  });
  return interpolatedArgs;
}
