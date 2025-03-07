const {
  PseudoTerminal,
} = require('./build/packages/nx/src/tasks-runner/pseudo-terminal');
const {
  RustPseudoTerminal,
  showInfoAboutParser,
} = require('./packages/nx/src/native/native-bindings');

const run = async () => {
  const terminal = new PseudoTerminal(new RustPseudoTerminal());
  await terminal.init();

  let a = terminal.runCommand('ls', {
    cwd: '/home/jason/projects/nx',
    env: {},
    execArgv: [],
    quiet: true,
    tty: true,
  });
  // a.onOutput(msg => {
  //   process.stdout.write(msg);
  // })

  await new Promise((resolve) => {
    a.onExit((code) => {
      const pseudoTerminal = terminal.getPseudoTerminal();
      showInfoAboutParser(pseudoTerminal);
      resolve();
    });
  });
  process.exit(0);
};

(async () => {
  for (let i = 0; i < 10; i++) {
    console.log(i);
    await run();
  }
})();
