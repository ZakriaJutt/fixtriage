// The one logger (TRD 8.4): JSON lines, correlation ID on every line, scrubbed fields.
import { currentCorrelationId } from './correlation';
import { scrub, scrubString } from './scrub';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogSink = (line: string) => void;

let sink: LogSink = (line) => process.stdout.write(line + '\n');
let minLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel | undefined) ?? (process.env.NODE_ENV === 'test' ? 'warn' : 'info');
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function setLogSink(s: LogSink, level: LogLevel = 'debug'): void {
  sink = s;
  minLevel = level;
}

function write(level: LogLevel, component: string, event: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] < ORDER[minLevel]) return;
  const line = { ts: new Date().toISOString(), level, component, event: scrubString(event), correlation_id: currentCorrelationId(), ...(fields ? (scrub(fields) as object) : {}) };
  sink(JSON.stringify(line));
}

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export function createLogger(component: string): Logger {
  return {
    debug: (e, f) => write('debug', component, e, f),
    info: (e, f) => write('info', component, e, f),
    warn: (e, f) => write('warn', component, e, f),
    error: (e, f) => write('error', component, e, f),
  };
}
