import dotenv from 'dotenv';

dotenv.config();

export interface AppConfig {
  port: number;
  appPassword: string;
  openaiApiKey: string;
  vectorStoreId: string | null;
  dbHost: string;
  dbPort: number;
  dbUser: string;
  dbPassword: string;
  dbName: string;
}

const port = Number(process.env.PORT) || 4000;
const appPassword = process.env.APP_PASSWORD || '';
const openaiApiKey = process.env.OPENAI_API_KEY || '';
const vectorStoreId = process.env.ARGUS_VECTOR_STORE_ID || null;
const dbHost = process.env.DB_HOST || '127.0.0.1';
const dbPort = Number(process.env.DB_PORT || '3306');
const dbUser = process.env.DB_USER || '';
const dbPassword = process.env.DB_PASSWORD || '';
const dbName = process.env.DB_NAME || '';

if (!appPassword) {
  console.warn('APP_PASSWORD is not set. Protected routes will reject requests.');
}

if (!openaiApiKey) {
  console.warn('OPENAI_API_KEY is not set. OpenAI features will not work.');
}

if (!dbUser || !dbName) {
  console.warn('Database credentials (DB_USER/DB_NAME) are not fully set. DB features will not work.');
}

export const config: AppConfig = {
  port,
  appPassword,
  openaiApiKey,
  vectorStoreId,
  dbHost,
  dbPort,
  dbUser,
  dbPassword,
  dbName,
};
