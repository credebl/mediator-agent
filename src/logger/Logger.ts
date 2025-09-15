// logger.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { LogLevel, BaseLogger } from '@credo-ts/core'
import { Logger as TSLogger } from 'tslog'

// OTEL logs (used only when enabled via tracer.ts)
import type { Logger as OtelLogger } from '@opentelemetry/api-logs'
import { otelLogger as globalOtelLogger } from '../tracer'

import { replaceError } from './replaceError'

type JsonObj = Record<string, unknown>

const OTEL_SEVERITY_TEXT: Record<Exclude<LogLevel, LogLevel.off>, string> = {
  [LogLevel.test]:  'TEST',
  [LogLevel.trace]: 'TRACE',
  [LogLevel.debug]: 'DEBUG',
  [LogLevel.info]:  'INFO',
  [LogLevel.warn]:  'WARN',
  [LogLevel.error]: 'ERROR',
  [LogLevel.fatal]: 'FATAL',
}

export class Logger extends BaseLogger {
  private tsLogger: TSLogger
  private otelLogger?: OtelLogger
  private readonly loggerName = 'Mediator Agent'

  private tsLogLevelMap = {
    [LogLevel.test]: 'silly',
    [LogLevel.trace]: 'trace',
    [LogLevel.debug]: 'debug',
    [LogLevel.info]: 'info',
    [LogLevel.warn]: 'warn',
    [LogLevel.error]: 'error',
    [LogLevel.fatal]: 'fatal',
  } as const

  public constructor(logLevel: LogLevel) {
    super(logLevel)
    if (globalOtelLogger) this.otelLogger = globalOtelLogger

    this.tsLogger = new TSLogger({
      name: this.loggerName,
      minLevel: this.logLevel === LogLevel.off ? 'fatal' : this.tsLogLevelMap[this.logLevel],
      ignoreStackLevels: 5,
    })
  }

  private emitOtel(level: Exclude<LogLevel, LogLevel.off>, message: string, data?: JsonObj) {
    console.log("message:::::::::", message);
    if (!this.otelLogger) return

    // Keep attributes super simple; cast to any to avoid typing noise.
    const attributes: Record<string, unknown> = {
      'logger.name': this.loggerName,
      'logger.level': LogLevel[level],
      ...(data ?? {}),
    }

    this.otelLogger.emit({
      body: message,
      severityText: OTEL_SEVERITY_TEXT[level],
      attributes: attributes as any, // minimal: allow any shape
    })
  }

  private log(level: Exclude<LogLevel, LogLevel.off>, message: string, data?: JsonObj): void {
    // Always emit to OTEL so everything shows up in SigNoz
    this.emitOtel(level, message, data)

    // Local console/tslog respects configured level
    if (this.logLevel === LogLevel.off) return
    const tsLogLevel = this.tsLogLevelMap[level]
    if (data) {
      this.tsLogger[tsLogLevel](message, JSON.parse(JSON.stringify(data, replaceError, 2)))
    } else {
      this.tsLogger[tsLogLevel](message)
    }
  }

  public test(message: string, data?: JsonObj): void  { this.log(LogLevel.test, message, data) }
  public trace(message: string, data?: JsonObj): void { this.log(LogLevel.trace, message, data) }
  public debug(message: string, data?: JsonObj): void { this.log(LogLevel.debug, message, data) }
  public info(message: string, data?: JsonObj): void  { this.log(LogLevel.info, message, data) }
  public warn(message: string, data?: JsonObj): void  { this.log(LogLevel.warn, message, data) }
  public error(message: string, data?: JsonObj): void { this.log(LogLevel.error, message, data) }
  public fatal(message: string, data?: JsonObj): void { this.log(LogLevel.fatal, message, data) }
}