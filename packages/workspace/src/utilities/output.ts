import * as chalk from 'chalk';
import { EOL } from 'os';
import { isCI } from './is_ci';

export interface CLIErrorMessageConfig {
  title: string;
  bodyLines?: string[];
  slug?: string;
}

export interface CLIWarnMessageConfig {
  title: string;
  bodyLines?: string[];
  slug?: string;
}

export interface CLINoteMessageConfig {
  title: string;
  bodyLines?: string[];
}

export interface CLISuccessMessageConfig {
  title: string;
  bodyLines?: string[];
}

export enum TaskCacheStatus {
  NoCache = '[no cache]',
  MatchedExistingOutput = '[existing outputs match the cache, left as is]',
  RetrievedFromCache = '[retrieved from cache]',
}

/**
 * Automatically disable styling applied by chalk if CI=true
 */
if (isCI()) {
  (chalk as any).level = 0;
}

class CLIOutput {
  private readonly NX_PREFIX = `${chalk.cyan(
    '>'
  )} ${chalk.reset.inverse.bold.cyan(' NX ')}`;
  /**
   * Longer dash character which forms more of a continuous line when place side to side
   * with itself, unlike the standard dash character
   */
  private readonly VERTICAL_SEPARATOR =
    '———————————————————————————————————————————————';

  /**
   * Expose some color and other utility functions so that other parts of the codebase that need
   * more fine-grained control of message bodies are still using a centralized
   * implementation.
   */
  colors = {
    gray: chalk.gray,
  };
  bold = chalk.bold;
  underline = chalk.underline;

  private writeToStdOut(str: string) {
    process.stdout.write(str);
  }

  private writeOutputTitle({
    label,
    title,
  }: {
    label?: string;
    title: string;
  }): void {
    let outputTitle: string;
    if (label) {
      outputTitle = `${this.NX_PREFIX} ${label} ${title}\n`;
    } else {
      outputTitle = `${this.NX_PREFIX} ${title}\n`;
    }
    this.writeToStdOut(outputTitle);
  }

  private writeOptionalOutputBody(bodyLines?: string[]): void {
    if (!bodyLines) {
      return;
    }
    this.addNewline();
    bodyLines.forEach((bodyLine) => this.writeToStdOut(`  ${bodyLine}\n`));
  }

  addNewline() {
    this.writeToStdOut('\n');
  }

  addVerticalSeparator() {
    this.writeToStdOut(`\n${chalk.gray(this.VERTICAL_SEPARATOR)}\n\n`);
  }

  addVerticalSeparatorWithoutNewLines() {
    this.writeToStdOut(`${chalk.gray(this.VERTICAL_SEPARATOR)}\n`);
  }

  error({ title, slug, bodyLines }: CLIErrorMessageConfig) {
    this.addNewline();

    this.writeOutputTitle({
      label: chalk.reset.inverse.bold.red(' ERROR '),
      title: chalk.bold.red(title),
    });

    this.writeOptionalOutputBody(bodyLines);

    /**
     * Optional slug to be used in an Nx error message redirect URL
     */
    if (slug && typeof slug === 'string') {
      this.addNewline();
      this.writeToStdOut(
        `${chalk.grey(
          '  Learn more about this error: '
        )}https://errors.nx.dev/${slug}\n`
      );
    }

    this.addNewline();
  }

  warn({ title, slug, bodyLines }: CLIWarnMessageConfig) {
    this.addNewline();

    this.writeOutputTitle({
      label: chalk.reset.inverse.bold.yellow(' WARNING '),
      title: chalk.bold.yellow(title),
    });

    this.writeOptionalOutputBody(bodyLines);

    /**
     * Optional slug to be used in an Nx warning message redirect URL
     */
    if (slug && typeof slug === 'string') {
      this.addNewline();
      this.writeToStdOut(
        `${chalk.grey(
          '  Learn more about this warning: '
        )}https://errors.nx.dev/${slug}\n`
      );
    }

    this.addNewline();
  }

  note({ title, bodyLines }: CLINoteMessageConfig) {
    this.addNewline();

    this.writeOutputTitle({
      label: chalk.reset.inverse.bold.keyword('orange')(' NOTE '),
      title: chalk.bold.keyword('orange')(title),
    });

    this.writeOptionalOutputBody(bodyLines);

    this.addNewline();
  }

  success({ title, bodyLines }: CLISuccessMessageConfig) {
    this.addNewline();

    this.writeOutputTitle({
      label: chalk.reset.inverse.bold.green(' SUCCESS '),
      title: chalk.bold.green(title),
    });

    this.writeOptionalOutputBody(bodyLines);

    this.addNewline();
  }

  logSingleLine(message: string) {
    this.addNewline();

    this.writeOutputTitle({
      title: message,
    });

    this.addNewline();
  }

  logCommand(
    message: string,
    cacheStatus: TaskCacheStatus = TaskCacheStatus.NoCache
  ) {
    this.addNewline();

    this.writeToStdOut(chalk.bold(`> ${message} `));

    if (cacheStatus !== TaskCacheStatus.NoCache) {
      this.writeToStdOut(chalk.bold.grey(cacheStatus));
    }

    this.addNewline();
  }

  log({ title, bodyLines }: CLIWarnMessageConfig) {
    this.addNewline();

    this.writeOutputTitle({
      title: chalk.white(title),
    });

    this.writeOptionalOutputBody(bodyLines);

    this.addNewline();
  }
}

export const output = new CLIOutput();

const X_PADDING = ' ';

function applyNxPrefix(color = 'cyan', text: string) {
  let nxPrefix = '';
  if (chalk[color]) {
    nxPrefix = `${chalk[color]('>')} ${chalk.reset.inverse.bold[color](
      ' NX '
    )}`;
  } else {
    nxPrefix = `${chalk.keyword(color)('>')} ${chalk.reset.inverse.bold.keyword(
      color
    )(' NX ')}`;
  }
  return `${nxPrefix}  ${text}`;
}

class NeoCLIOutput {
  /**
   * Longer dash character which forms more of a continuous line when place side to side
   * with itself, unlike the standard dash character
   */
  private get VERTICAL_SEPARATOR() {
    let divider = '';
    for (let i = 0; i < process.stdout.columns - X_PADDING.length * 2; i++) {
      divider += '\u2014';
    }
    return divider;
  }

  /**
   * Expose some color and other utility functions so that other parts of the codebase that need
   * more fine-grained control of message bodies are still using a centralized
   * implementation.
   */
  colors = {
    gray: chalk.gray,
    cyan: chalk.cyan,
  };
  bold = chalk.bold;
  underline = chalk.underline;

  private writeToStdOut(str: string) {
    process.stdout.write(str);
  }

  private writeOutputTitle({
    color,
    title,
  }: {
    color: string;
    title: string;
  }): void {
    this.writeToStdOut(` ${applyNxPrefix(color, title)}\n`);
  }

  private writeOptionalOutputBody(bodyLines?: string[]): void {
    if (!bodyLines) {
      return;
    }
    this.addNewline();
    bodyLines.forEach((bodyLine) => this.writeToStdOut(`   ${bodyLine}\n`));
  }

  writeCommandOutputBlock(output: string): void {
    const additionalXPadding = '     ';
    const lines = output.split(EOL);
    /**
     * There's not much we can do in order to "neaten up" the outputs of
     * commands we do not control, but at the very least we can trim excess
     * newlines so that there isn't unncecessary vertical whitespace.
     */
    let totalTrailingEmptyLines = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i] !== '') {
        break;
      }
      totalTrailingEmptyLines++;
    }
    if (totalTrailingEmptyLines > 1) {
      const linesToRemove = totalTrailingEmptyLines - 1;
      lines.splice(lines.length - linesToRemove, linesToRemove);
    }
    process.stdout.write(
      lines.map((l) => `${X_PADDING}${additionalXPadding}${l}`).join(EOL) + EOL
    );
  }

  addNewline() {
    this.writeToStdOut('\n');
  }

  addVerticalSeparator(color = 'gray') {
    this.writeToStdOut(`\n ${chalk.dim[color](this.VERTICAL_SEPARATOR)}\n\n`);
  }

  addVerticalSeparatorWithoutNewLines(color = 'gray') {
    this.writeToStdOut(` ${chalk.dim[color](this.VERTICAL_SEPARATOR)}\n`);
  }

  error({ title, slug, bodyLines }: CLIErrorMessageConfig) {
    this.addNewline();

    this.writeOutputTitle({
      color: 'red',
      title: chalk.red(title),
    });

    this.writeOptionalOutputBody(bodyLines);

    /**
     * Optional slug to be used in an Nx error message redirect URL
     */
    if (slug && typeof slug === 'string') {
      this.addNewline();
      this.writeToStdOut(
        `${chalk.grey(
          '  Learn more about this error: '
        )}https://errors.nx.dev/${slug}\n`
      );
    }

    this.addNewline();
  }

  warn({ title, slug, bodyLines }: CLIWarnMessageConfig) {
    this.addNewline();

    this.writeOutputTitle({
      color: 'yellow',
      title: chalk.yellow(title),
    });

    this.writeOptionalOutputBody(bodyLines);

    /**
     * Optional slug to be used in an Nx warning message redirect URL
     */
    if (slug && typeof slug === 'string') {
      this.addNewline();
      this.writeToStdOut(
        `${chalk.grey(
          '  Learn more about this warning: '
        )}https://errors.nx.dev/${slug}\n`
      );
    }

    this.addNewline();
  }

  note({ title, bodyLines }: CLINoteMessageConfig) {
    this.addNewline();

    this.writeOutputTitle({
      color: 'orange',
      title: chalk.bold.keyword('orange')(title),
    });

    this.writeOptionalOutputBody(bodyLines);

    this.addNewline();
  }

  success({ title, bodyLines }: CLISuccessMessageConfig) {
    this.addNewline();

    this.writeOutputTitle({
      color: 'green',
      title: chalk.green(title),
    });

    this.writeOptionalOutputBody(bodyLines);

    this.addNewline();
  }

  logSingleLine(message: string) {
    this.addNewline();

    this.writeOutputTitle({
      color: 'gray',
      title: message,
    });

    this.addNewline();
  }

  logCommand(
    message: string,
    cacheStatus: TaskCacheStatus = TaskCacheStatus.NoCache
  ) {
    this.addNewline();

    let commandOutput = `    ${chalk.dim('> nx run')} ${message}`;
    if (cacheStatus !== TaskCacheStatus.NoCache) {
      commandOutput += `  ${chalk.grey(cacheStatus)}`;
    }
    this.writeToStdOut(commandOutput);

    this.addNewline();
    this.addNewline();
  }

  log({ title, bodyLines, color }: CLIWarnMessageConfig & { color: string }) {
    this.addNewline();

    color = color || 'white';

    this.writeOutputTitle({
      color: 'cyan',
      title: chalk[color](title),
    });

    this.writeOptionalOutputBody(bodyLines);

    this.addNewline();
  }
}

export const neoOutput = new NeoCLIOutput();
