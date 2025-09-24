import type { Logger } from './common/logger';
import { createLogger } from './common/logger';
import type { Zeta } from './zeta';

export interface ModuleBaseProps {
  scope: Zeta;
  moduleName: string;
}

const joinMsg = (...args: unknown[]): string =>
  args
    .map((arg) => {
      if (arg instanceof Error) {
        const base = arg.message ?? arg.name;
        return arg.stack ? `${base}\n${arg.stack}` : base;
      }

      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }

      return String(arg);
    })
    .join(', ');

export default class ModuleBase {
  public scope: Zeta;
  private disabled = false;
  protected logger: Logger;

  constructor({ scope, moduleName }: ModuleBaseProps) {
    this.scope = scope;
    this.logger = createLogger(moduleName);
  }

  public logDebug(...args: unknown[]): void {
    this.logger.debug(joinMsg(...args));
  }

  public logInfo(...args: unknown[]): void {
    this.logger.info(joinMsg(...args));
  }

  public logWarning(...args: unknown[]): void {
    this.logger.warning(joinMsg(...args));
  }

  public logError(...args: unknown[]): void {
    this.logger.error(joinMsg(...args));
  }

  public logAndThrowError(...args: unknown[]): never {
    const message = joinMsg(...args);
    throw new Error(message);
  }

  public checkDisabled(): void {
    if (this.disabled || !this.scope) this.logAndThrowError('module not working');
  }
}
