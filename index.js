// @ts-check
const {
  PseudoTerminal,
} = require('./build/packages/nx/src/tasks-runner/pseudo-terminal');
const {
  RustPseudoTerminal,
} = require('./packages/nx/src/native/native-bindings');

(async () => {
  let overallExitCode = 0;

  const pseudoTerminals = [];
  for (let i = 0; i < 10; i++) {
    const pseudoTerminal = new PseudoTerminal(new RustPseudoTerminal());
    await pseudoTerminal.init();
    pseudoTerminals.push(pseudoTerminal);
  }

  function shutdownPseudoTerminals() {
    for (const pseudoTerminal of pseudoTerminals) {
      pseudoTerminal.shutdown();
    }
  }
  process.on('SIGHUP', () => {
    activePseudoTtyProcess.kill();
    shutdownPseudoTerminals();
  });
  process.on('SIGINT', async () => {
    console.log('\nInterrupted, shutting down...');
    
    // Force kill with a stronger signal
    activePseudoTtyProcess.kill('SIGKILL'); // Try using SIGKILL if available
    
    // Add a timeout to force exit if cleanup takes too long
    const forceExitTimeout = setTimeout(() => {
      console.error('Forced exit due to timeout');
      process.exit(130); // 128 + 2 (SIGINT)
    }, 1000); // Wait 1 second max
    
    try {
      shutdownPseudoTerminals();
      clearTimeout(forceExitTimeout);
      process.exit(130);
    } catch (e) {
      console.error('Error during shutdown:', e);
      process.exit(130);
    }
  });
  process.on('SIGTERM', () => {
    activePseudoTtyProcess.kill();
    shutdownPseudoTerminals();
  });
  process.on('exit', () => {
    shutdownPseudoTerminals();
  });

  let activePseudoTtyProcess;

  for (const pseudoTerminal of pseudoTerminals) {
    activePseudoTtyProcess = pseudoTerminal.runCommand(
      'echo hi && sleep 5 && echo bye',
      {
        cwd: __dirname,
        jsEnv: {},
        execArgv: [],
        quiet: true,
        tty: true,
      }
    );
    activePseudoTtyProcess.onOutput((msg) => {
      process.stdout.write(msg);
    });

    const exitCode = await new Promise((resolve) => {
      activePseudoTtyProcess.onExit((code) => {
        resolve(code);
      });
    });
    console.log(`\n`);
    overallExitCode = overallExitCode || exitCode;
  }
  process.exit(overallExitCode);
})();
