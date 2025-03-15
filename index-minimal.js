// @ts-check
const {
  PseudoTerminal,
} = require('./build/packages/nx/src/tasks-runner/pseudo-terminal');
const {
  RustPseudoTerminal,
} = require('./packages/nx/src/native/native-bindings');

(async () => {
  const pseudoTerminal = new PseudoTerminal(new RustPseudoTerminal());
  await pseudoTerminal.init();

  const activePseudoTtyProcess = pseudoTerminal.runCommand(
    'echo hi && sleep 5 && echo bye',
    {
      cwd: __dirname,
      jsEnv: {},
      execArgv: [],
      quiet: true, // handle output in onOutput
      tty: true,
    }
  );
  
  process.on("SIGINT", () => {
    activePseudoTtyProcess.kill();
  });

  activePseudoTtyProcess.onOutput((msg) => {
    process.stdout.write(msg);
  });
  

  const exitCode = await new Promise((resolve) => {
    activePseudoTtyProcess.onExit((code) => {
      resolve(code);
    });
  });

  process.exit(exitCode);
})();
