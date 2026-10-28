// Pretend stdout is a terminal unless a test says otherwise.
Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true, writable: true });
