export enum LogLevel {
  Error,
  Warning,
  Info,
  Debug,
}

export class Logger {
  private logLevel: LogLevel;
  private name: string;

  constructor(params: { name: string; logLevel?: LogLevel }) {
    this.logLevel = params.logLevel !== undefined ? params.logLevel : LogLevel.Error;
    this.name = params.name;
  }

  set level(logLevel: LogLevel) {
    this.logLevel = logLevel;
  }

  get time(): string {
    return Date.now().toString();
  }

  get moduleName(): string {
    return this.name;
  }

  private isLogLevel(level: LogLevel): boolean {
    return level <= this.logLevel;
  }

  public error(...props: unknown[]): Logger {
    if (!this.isLogLevel(LogLevel.Error)) return this;
    console.error(this.time, this.name, 'sdk logger error', ...props);
    return this;
  }

  public logWithError(...props: unknown[]): Logger {
    const msg = props
      .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : arg))
      .join(', ');
    throw new Error(msg);
  }

  public warning(...props: unknown[]): Logger {
    if (!this.isLogLevel(LogLevel.Warning)) return this;
    console.warn(this.time, this.name, 'sdk logger warning', ...props);
    return this;
  }

  public info(...props: unknown[]): Logger {
    if (!this.isLogLevel(LogLevel.Info)) return this;
    console.info(this.time, this.name, 'sdk logger info', ...props);
    return this;
  }

  public debug(...props: unknown[]): Logger {
    if (!this.isLogLevel(LogLevel.Debug)) return this;
    console.debug(this.time, this.name, 'sdk logger debug', ...props);
    return this;
  }
}

const moduleLoggers: { [key: string]: Logger } = {};
const moduleLevels: { [key: string]: LogLevel } = {};

export function createLogger(moduleName: string): Logger {
  let logger = moduleLoggers[moduleName];
  if (!logger) {
    const logLevel = moduleLevels[moduleName];
    logger = new Logger({ name: moduleName, logLevel });
    moduleLoggers[moduleName] = logger;
  }
  return logger;
}

export function setLoggerLevel(moduleName: string, level: LogLevel): void {
  moduleLevels[moduleName] = level;
  const logger = moduleLoggers[moduleName];
  if (logger) logger.level = level;
}
