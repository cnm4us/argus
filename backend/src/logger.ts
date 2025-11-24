import fs from 'fs';
import path from 'path';

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

export function logOpenAI(message: string, details?: unknown): void {
  const timestamp = new Date().toISOString();
  const line =
    details === undefined
      ? `[${timestamp}] ${message}\n`
      : `[${timestamp}] ${message} ${JSON.stringify(details)}\n`;

  ensureLogsDir();

  try {
    fs.appendFile(openaiLogPath, line, (err) => {
      if (err) {
        console.error('Failed to write to openai.log', err);
      }
    });
  } catch (err) {
    console.error('Failed to schedule write to openai.log', err);
  }
}

