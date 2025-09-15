// tracer.ts
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck TODO: Facing issues with types, need to fix later
import * as dotenv from 'dotenv';

import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';

import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import type { Logger } from '@opentelemetry/api-logs';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { resourceFromAttributes } from '@opentelemetry/resources';

dotenv.config();

let otelSDK: NodeSDK | null = null;
let otelLogger: Logger | null = null;
let otelLoggerProviderInstance: LoggerProvider | null = null;

if ((process.env.IS_ENABLE_OTEL ?? '').trim().toLowerCase() === 'true') {
  // Turn on debug so exporter/processor issues are visible
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);

  const resource = resourceFromAttributes({
    [SemanticResourceAttributes.SERVICE_NAME]: 'CREDEBL-MEDIATOR-SERVICE',
    [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
    [SemanticResourceAttributes.SERVICE_INSTANCE_ID]: 'localhost',
  });

  const traceExporter = new OTLPTraceExporter({
    url: 'http://localhost:4318/v1/traces',
  });

  const logExporter = new OTLPLogExporter({
    url: 'http://localhost:4318/v1/logs',
  });

  const logProvider: any = new LoggerProvider({ resource });

  // ✅ Correct, version-safe processor registration
  const processor = new BatchLogRecordProcessor(logExporter);
  if (typeof logProvider.addProcessor === 'function') {
    logProvider.addProcessor(processor);
  } else if (typeof logProvider.addLogRecordProcessor === 'function') {
    logProvider.addLogRecordProcessor(processor); // <-- correct method name
  } else {
    // eslint-disable-next-line no-console
    console.warn('[OTEL] LoggerProvider has no addProcessor/addLogRecordProcessor; logs will not be exported.');
  }

  // Make this provider the global logs provider, so `emit()` actually exports
  logs.setGlobalLoggerProvider(logProvider);

  otelLogger = logProvider.getLogger('credebl-mediator-logger');
  otelLoggerProviderInstance = logProvider;

  // NodeSDK for traces & auto-instrumentations
  otelSDK = new NodeSDK({
    resource,
    traceExporter,
    instrumentations: [new HttpInstrumentation(), new ExpressInstrumentation(), new NestInstrumentation()],
  });

  process.on('SIGTERM', () => {
    Promise.all([
      otelSDK!.shutdown(),
      typeof logProvider.shutdown === 'function' ? logProvider.shutdown() : Promise.resolve(),
    ])
      .then(() => console.log('SDK and Logger shut down successfully'))
      .catch((err) => console.log('Error during shutdown', err))
      .finally(() => process.exit(0));
  });
}

export { otelSDK, otelLogger, otelLoggerProviderInstance };