import { newProject, runCLI, tmpProjPath, updateJson } from '@nx/e2e/utils';
import { spawnCommand, test } from './fixture';

const KEY_SEQUENCES = {
  DOWN_ARROW: '\x1B[B',
  UP_ARROW: '\x1B[A',
};

test.describe('Nx TUI', () => {
  test.beforeAll(async () => {
    test.setTimeout(120_000);

    // Create an Nx workspace with two npm packages (that will have simple test scripts already)
    newProject({
      packages: ['@nx/js'],
    });
    runCLI(`generate @nx/workspace:npm-package my-pkg-1`);
    runCLI(`generate @nx/workspace:npm-package my-pkg-2`);

    // Make pkg2 depend on pkg1 so that we have a deterministic order of task completions when combined with --parallel=1
    updateJson(`my-pkg-2/package.json`, (json) => {
      json.dependencies ??= {};
      json.dependencies['@proj/my-pkg-1'] = 'file:../my-pkg-1';
      return json;
    });
  });

  test('each task should be navigable with both the arrow keys and home row', async ({
    terminal,
    page,
  }) => {
    // Spawn the Nx TUI process
    await spawnCommand(
      terminal,
      page,
      'npx nx run-many --target=test --parallel=1',
      tmpProjPath()
    );

    // Wait for the tasks to have completed
    await terminal.waitForText('Completed 2 tasks in', 15000);

    /**
     * Hide non-deterministic timing values from the screenshots.
     * Using exact coordinates which are slightly larger than we expect the largest value to be
     * is the most robust way to avoid to do this in order to avoid issues with the difference
     * in length between task results in different environments e.g. 10ms locally and 125ms in CI.
     */
    const regionsToMask = [
      { left: 249, top: 57, width: 50, height: 19 },
      { left: 1223, top: 95, width: 50, height: 19 },
      { left: 1223, top: 114, width: 50, height: 19 },
    ];

    // Navigate down with arrow key
    await terminal.captureSnapshotWithMasking('1-before-down-arrow-nav', {
      regions: regionsToMask,
    });
    await terminal.sendInput(KEY_SEQUENCES.DOWN_ARROW);
    await terminal.captureSnapshotWithMasking(
      '2-after-down-arrow-before-up-arrow-nav',
      {
        regions: regionsToMask,
      }
    );

    // Navigate up with arrow key
    await terminal.sendInput(KEY_SEQUENCES.UP_ARROW);
    await terminal.captureSnapshotWithMasking(
      '3-after-up-arrow-nav-before-down-j-nav',
      {
        regions: regionsToMask,
      }
    );

    // Navigate down with j key
    await terminal.sendInput('j');
    await terminal.captureSnapshotWithMasking(
      '4-after-down-j-nav-before-up-k-nav',
      {
        regions: regionsToMask,
      }
    );

    // Navigate up with k key
    await terminal.sendInput('k');
    await terminal.captureSnapshotWithMasking(
      '5-after-up-k-nav-before-down-j-nav',
      {
        regions: regionsToMask,
      }
    );
  });
});
