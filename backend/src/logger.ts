import fs from 'fs';
import path from 'path';
import { config } from './config';

const logsDir = path.join(__dirname, '..', 'logs');
const openaiLogPath = path.join(logsDir, 'openai.log');

function ensureLogsDir(): void {
  try {
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
  } catch (err) {
    console.error('Failed to create logs directory', err);
  }
}

export function logOpenAI(event: string, details?: unknown): void {
  const timestamp = new Date().toISOString();

  const payload: Record<string, unknown> = {
    ts: timestamp,
    event,
  };

  if (details && typeof details === 'object') {
    Object.assign(payload, details as Record<string, unknown>);
  } else if (details !== undefined) {
    payload.details = details;
  }

  const isErrorEvent = event.includes(':error');

  // When debugRequests is false, only log error events to avoid noisy logs.
  if (!config.debugRequests && !isErrorEvent) {
    return;
  }

  ensureLogsDir();

  try {
    const line = JSON.stringify(payload) + '\n';
    fs.appendFile(openaiLogPath, line, (err) => {
      if (err) {
        console.error('Failed to write to openai.log', err);
      }
    });
  } catch (err) {
    console.error('Failed to schedule write to openai.log', err);
  }
}
