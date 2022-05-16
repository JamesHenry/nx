import { extname } from 'path';
import type * as ts from 'typescript';
import { ProjectFileMap, ProjectGraph } from '../../config/project-graph';
import { Workspace } from '../../config/workspace-json-project-json';
import { TargetProjectLocator } from '../../utils/target-project-locator';
import { defaultFileRead } from '../file-utils';
import type { ExplicitDependency } from './build-explicit-typescript-and-package-json-dependencies';
import { createPreProcessFile } from './pre-process-file';

let tsModule: typeof ts | undefined;

export function buildExplicitTypeScriptDependencies(
  _workspace: Workspace,
  graph: ProjectGraph,
  filesToProcess: ProjectFileMap
): ExplicitDependency[] {
  if (!tsModule) {
    tsModule = require('typescript');
  }
  const preProcessFile = createPreProcessFile(tsModule);
  const targetProjectLocator = new TargetProjectLocator(
    graph.nodes,
    graph.externalNodes
  );
  const explicitDependencies: ExplicitDependency[] = [];

  for (const [projectName, fileData] of Object.entries(filesToProcess)) {
    for (const { file } of Object.values(fileData)) {
      const extension = extname(file);
      if (
        extension !== '.ts' &&
        extension !== '.tsx' &&
        extension !== '.js' &&
        extension !== '.jsx'
      ) {
        continue;
      }

      const content = defaultFileRead(file);
      const { importedFiles } = preProcessFile(content, true, true, file);

      for (const importedFile of importedFiles) {
        const target = targetProjectLocator.findProjectWithImport(
          importedFile.fileName,
          file
        );
        if (!target) {
          continue;
        }
        explicitDependencies.push({
          sourceProjectName: projectName,
          targetProjectName: target,
          sourceProjectFile: file,
        });
      }
    }
  }

  return explicitDependencies;
}
