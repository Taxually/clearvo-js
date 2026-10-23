import { defineConfig } from 'vitest/config';

// The CLI prints a failure as JSON on stderr when stdout is not a terminal (see wantJsonErrors in src/program.ts). Tests run with a
// piped stdout, so they start from the terminal behaviour (readable text) and the JSON tests switch it on explicitly.
export default defineConfig({
  test: { setupFiles: ['./test/setup-tty.ts'] },
});
