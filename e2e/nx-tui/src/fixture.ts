import { workspaceRoot } from '@nx/devkit';
import type {
  Page,
  PageAssertionsToHaveScreenshotOptions,
} from '@playwright/test';
import { test as base } from '@playwright/test';
import { spawn } from 'node-pty';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Re-export expect so that we are consistently importing from this file as the source of truth
export { expect } from '@playwright/test';

interface CustomWindow {
  writeToTerminal: (data: string) => void;
  getTerminalState: () => string;
  resizeTerminal: (cols: number, rows: number) => void;
  fitTerminal: () => { cols: number; rows: number };
}

// Define the browser context function type
type BrowserFunction<T = void> = (
  this: Window & typeof globalThis & CustomWindow,
  ...args: any[]
) => T;

interface TerminalFixture {
  pty: any;
  dimensions: { cols: number; rows: number };
  sendInput: (input: string) => Promise<void>;
  waitForText: (
    text: string | RegExp,
    timeout?: number,
    pollInterval?: number
  ) => Promise<boolean>;
  captureStableSnapshotWithMasking: (
    name: string,
    textPatternsToMask: (string | RegExp)[],
    maskChar?: string,
    toHaveScreenshotOptions?: PageAssertionsToHaveScreenshotOptions,
    stabilityTimeout?: number,
    stabilityThreshold?: number
  ) => Promise<void>;
}

const HTML_DIR = join(workspaceRoot, 'dist/e2e/nx-tui');
const HTML_PATH = join(HTML_DIR, 'terminal-renderer.html');

export const test = base.extend<{
  terminal: TerminalFixture;
}>({
  terminal: async ({ page }, use) => {
    // Create and set up the HTML file
    createHtmlFile();
    await page.goto(`file://${HTML_PATH}`);

    // Wait for terminal to initialize
    const checkFitTerminal: BrowserFunction<boolean> = function () {
      return !!this.fitTerminal?.();
    };
    await page.waitForFunction(checkFitTerminal);

    // Get terminal dimensions
    const getFitDimensions: BrowserFunction<{ cols: number; rows: number }> =
      function () {
        return this.fitTerminal();
      };
    const dimensions = await page.evaluate(getFitDimensions);

    // Create the terminal fixture
    const terminal: TerminalFixture = {
      dimensions,
      pty: null, // Will be set when spawning the process

      // Helper function to send input to the terminal
      sendInput: async (input: string): Promise<void> => {
        console.log(`Sending input: ${JSON.stringify(input)}`);
        terminal.pty.write(input);
        await page.waitForTimeout(500);
      },

      // Helper function to wait for text in the terminal
      waitForText: async (
        text: string | RegExp,
        timeout = 10000,
        pollInterval = 100
      ): Promise<boolean> => {
        console.log(
          `Waiting for text: ${
            text instanceof RegExp ? text.toString() : `"${text}"`
          }`
        );

        const checkText: BrowserFunction = function ({ searchText, isRegex }) {
          const content = this.getTerminalState();
          if (!isRegex) {
            return content.includes(searchText);
          } else {
            const regexParts = /\/(.*)\/([gimuy]*)/.exec(searchText);
            if (regexParts) {
              const [, pattern, flags] = regexParts;
              const regex = new RegExp(pattern, flags);
              return regex.test(content);
            }
            return false;
          }
        };

        await page.waitForFunction(
          checkText,
          {
            searchText: text instanceof RegExp ? text.toString() : text,
            isRegex: text instanceof RegExp,
          },
          { timeout, polling: pollInterval }
        );

        return true;
      },

      captureStableSnapshotWithMasking: async (
        name: string,
        textPatternsToMask: (string | RegExp)[],
        maskChar = '█',
        toHaveScreenshotOptions: PageAssertionsToHaveScreenshotOptions = {},
        stabilityTimeout = 5000,
        stabilityThreshold = 5
      ): Promise<void> => {
        console.log(`Capturing masked snapshot: ${name}`);

        // Wait for visual stability first
        const startTime = Date.now();
        let stableCount = 0;
        let lastContent = '';

        while (
          stableCount < stabilityThreshold &&
          Date.now() - startTime < stabilityTimeout
        ) {
          const getTerminalState: BrowserFunction<string> = function () {
            return this.getTerminalState();
          };
          const currentContent = await page.evaluate(getTerminalState);

          if (currentContent === lastContent) {
            stableCount++;
          } else {
            stableCount = 0;
            lastContent = currentContent;
          }

          await page.waitForTimeout(100);
        }

        // Convert patterns to the format needed for the browser function
        const patterns = textPatternsToMask.map((pattern) => ({
          pattern: pattern instanceof RegExp ? pattern.toString() : pattern,
          isRegex: pattern instanceof RegExp,
        }));

        // Use row-based analysis to handle cross-span patterns
        await page.evaluate(
          ({ patternsList, maskCharacter }) => {
            // Create a canvas overlay
            const terminal = document.querySelector('#terminal');
            if (!terminal) return false;

            const overlay = document.createElement('canvas');
            overlay.id = 'masking-canvas-overlay';
            overlay.style.position = 'absolute';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.width = '100%';
            overlay.style.height = '100%';
            overlay.style.pointerEvents = 'none';
            overlay.style.zIndex = '1000';

            // Set canvas dimensions to match the terminal
            const terminalRect = terminal.getBoundingClientRect();
            overlay.width = terminalRect.width;
            overlay.height = terminalRect.height;

            // Get the context for drawing
            const ctx = overlay.getContext('2d');
            if (!ctx) return false;

            // Set fill style for masking
            ctx.fillStyle = '#000'; // Terminal background color

            // Function to convert regex string to RegExp object
            function stringToRegex(pattern) {
              const regexParts = /\/(.*)\/([gimuy]*)/.exec(pattern);
              if (regexParts) {
                const [, regexPattern, flags] = regexParts;
                return new RegExp(regexPattern, flags);
              }
              return null;
            }

            // Get terminal rows
            const rows = document.querySelectorAll('.xterm-rows > div');

            // Process each row to find cross-span matches
            rows.forEach((row) => {
              // Get all spans in this row
              const spans = Array.from(row.querySelectorAll('span'));
              if (spans.length === 0) return;

              // Build row data with text and position information
              const rowData = {
                text: '', // Concatenated text of all spans
                spanMap: [], // Maps each character position to its span and offset
                spans: [], // Information about each span
              };

              // Collect data about each span
              spans.forEach((span) => {
                const text = span.textContent || '';
                if (!text) return;

                const spanRect = span.getBoundingClientRect();
                const startIndex = rowData.text.length;

                // Store span information
                rowData.spans.push({
                  element: span,
                  text: text,
                  startIndex: startIndex,
                  endIndex: startIndex + text.length - 1,
                  rect: spanRect,
                  charWidth: spanRect.width / text.length,
                });

                // Map each character position to its span
                for (let i = 0; i < text.length; i++) {
                  rowData.spanMap.push({
                    spanIndex: rowData.spans.length - 1,
                    charIndex: i,
                  });
                }

                // Add this span's text to the row text
                rowData.text += text;
              });

              // Check for matches in the full row text
              patternsList.forEach(({ pattern, isRegex }) => {
                let regex;

                if (isRegex) {
                  regex = stringToRegex(pattern);
                } else {
                  // Escape special characters for literal string search
                  const escaped = pattern.replace(
                    /[.*+?^${}()|[\]\\]/g,
                    '\\$&'
                  );
                  regex = new RegExp(escaped, 'g');
                }

                if (!regex) return;

                // Find all matches in the full row text
                let match;
                while ((match = regex.exec(rowData.text)) !== null) {
                  const matchStart = match.index;
                  const matchEnd = matchStart + match[0].length - 1;

                  // Draw mask for each character in the match, using the span mapping
                  for (let pos = matchStart; pos <= matchEnd; pos++) {
                    const mapping = rowData.spanMap[pos];
                    if (!mapping) continue;

                    const span = rowData.spans[mapping.spanIndex];
                    const charX =
                      span.rect.left + mapping.charIndex * span.charWidth;

                    // Draw mask for this character
                    ctx.fillRect(
                      charX - terminalRect.left,
                      span.rect.top - terminalRect.top,
                      span.charWidth,
                      span.rect.height
                    );

                    // Draw mask character
                    ctx.fillStyle = '#FFF'; // Text color
                    ctx.font = '14px monospace'; // Adjust to match terminal font
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(
                      maskCharacter,
                      charX - terminalRect.left + span.charWidth / 2,
                      span.rect.top - terminalRect.top + span.rect.height / 2
                    );
                    ctx.fillStyle = '#000'; // Reset for next rectangle
                  }
                }
              });
            });

            // Add the canvas overlay to the terminal
            terminal.appendChild(overlay);

            return true;
          },
          { patternsList: patterns, maskCharacter: maskChar }
        );

        // Take the screenshot with masking applied
        await test
          .expect(page)
          .toHaveScreenshot(`${name}.png`, toHaveScreenshotOptions);

        // Remove the canvas overlay
        await page.evaluate(() => {
          const overlay = document.getElementById('masking-canvas-overlay');
          if (overlay) {
            overlay.remove();
          }
          return true;
        });
      },
    };

    // Use the fixture
    await use(terminal);

    // Cleanup
    if (terminal.pty) {
      terminal.pty.kill();
    }
  },
});

// Helper function to spawn a PTY process for the terminal fixture
export const spawnCommand = async (
  terminal: TerminalFixture,
  page: Page,
  fullCommand: string,
  cwd?: string
): Promise<void> => {
  const [cmd, ...args] = fullCommand.split(' ');

  terminal.pty = spawn(cmd, args, {
    name: 'xterm-color',
    cols: terminal.dimensions.cols || 80,
    rows: terminal.dimensions.rows || 24,
    cwd: cwd || process.cwd(),
    env: {
      ...process.env,
      // Enable the TUI via the environment variable
      // TODO: Re-evaluate this post release so that we run it in the tests exactly how users will
      NX_TUI: 'true',
      /**
       * Force color with a value of `2` means 256 colors which is a sane assumption for most terminals.
       * `3` would mean "true color" (~16 million colors) which is not supported by all terminals.
       */
      FORCE_COLOR: '2',
    },
  });

  terminal.pty.onData(async (data: string) => {
    // Send data to browser for rendering
    const writeToTerminal: BrowserFunction = function (text: string) {
      this.writeToTerminal(text);
    };
    await page.evaluate(writeToTerminal, data);
  });

  return terminal.pty;
};

// Create a simple HTML file with xterm.js for rendering the terminal
function createHtmlFile(): void {
  // Use absolute paths for node_modules dependencies and ensure they exist
  const nodeModulesPath = join(workspaceRoot, 'node_modules');
  const requiredFiles = [
    join(nodeModulesPath, 'xterm/css/xterm.css'),
    join(nodeModulesPath, 'xterm/lib/xterm.js'),
    join(nodeModulesPath, 'xterm-addon-fit/lib/xterm-addon-fit.js'),
    join(nodeModulesPath, 'xterm-addon-serialize/lib/xterm-addon-serialize.js'),
  ];
  for (const file of requiredFiles) {
    if (!existsSync(file)) {
      throw new Error(`Required file not found: ${file}`);
    }
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="file://${join(
    nodeModulesPath,
    'xterm/css/xterm.css'
  )}" />
  <script src="file://${join(nodeModulesPath, 'xterm/lib/xterm.js')}"></script>
  <script src="file://${join(
    nodeModulesPath,
    'xterm-addon-fit/lib/xterm-addon-fit.js'
  )}"></script>
  <script src="file://${join(
    nodeModulesPath,
    'xterm-addon-serialize/lib/xterm-addon-serialize.js'
  )}"></script>
  <style>
    html, body { margin: 0; padding: 0; height: 100%; width: 100%; background: #000; overflow: hidden; }
    #terminal { width: 100%; height: 100%; position: absolute; top: 0; left: 0; right: 0; bottom: 0; }
    .xterm-viewport { overflow-y: hidden !important; }
  </style>
</head>
<body>
  <div id="terminal"></div>
  <script>
    const term = new Terminal({
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: false,
      allowTransparency: true,
      theme: { background: '#000000', foreground: '#ffffff' },
      scrollback: 0,
      disableStdin: true
    });

    term.open(document.getElementById('terminal'));

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);

    const serializeAddon = new SerializeAddon.SerializeAddon();
    term.loadAddon(serializeAddon);

    window.writeToTerminal = (data) => {
      term.write(data);
    };

    window.getTerminalState = () => {
      return serializeAddon.serialize();
    };

    window.resizeTerminal = (cols, rows) => {
      term.resize(cols, rows);
      fitAddon.fit();
    };

    window.fitTerminal = () => {
      fitAddon.fit();
      return { cols: term.cols, rows: term.rows };
    };

    setTimeout(() => {
      fitAddon.fit();
      console.log('Terminal fitted to', term.cols, 'x', term.rows);
    }, 100);

    window.addEventListener('resize', () => {
      fitAddon.fit();
    });
  </script>
</body>
</html>`;

  if (!existsSync(HTML_DIR)) {
    mkdirSync(HTML_DIR, { recursive: true });
  }
  writeFileSync(HTML_PATH, html);
}
