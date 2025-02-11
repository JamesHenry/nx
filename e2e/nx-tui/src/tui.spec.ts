import { newProject, runCLI, tmpProjPath, updateJson } from '@nx/e2e/utils';
import { spawnCommand, test } from './fixture';

const KEY_SEQUENCES = {
  DOWN_ARROW: '\x1B[B',
  UP_ARROW: '\x1B[A',
  SPACEBAR: ' ',
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

    const masks = [
      /\d+ms/g, // Mask millisecond timings
      /\d+s/g, // Mask second timings
    ];

    try {
      // Wait for the tasks to have completed (restored from cache in this case)
      await terminal.waitForText('Completed 2 tasks in', 15000);

      // Navigate down with arrow key
      await terminal.captureStableSnapshotWithMasking(
        '1-before-down-arrow-nav',
        masks
      );
      await terminal.sendInput(KEY_SEQUENCES.DOWN_ARROW);
      await terminal.captureStableSnapshotWithMasking(
        '2-after-down-arrow-nav',
        masks
      );

      // Navigate up with arrow key
      await terminal.captureStableSnapshotWithMasking(
        '3-before-up-arrow-nav',
        masks
      );
      await terminal.sendInput(KEY_SEQUENCES.UP_ARROW);
      await terminal.captureStableSnapshotWithMasking(
        '4-after-up-arrow-nav',
        masks
      );
    } catch (error) {
      throw error;
    }
  });
});
