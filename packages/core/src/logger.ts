/** The little logging the core does; adapters pass their framework's logger. */
export interface Logger {
  warn(message: string): void;
}

export const consoleLogger: Logger = { warn: (message) => console.warn(message) };
