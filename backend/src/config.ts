import dotenv from 'dotenv';

dotenv.config();

export interface AppConfig {
  port: number;
  appPassword: string;
  openaiApiKey: string;
  vectorStoreId: string | null;
}

const port = Number(process.env.PORT) || 4000;
const appPassword = process.env.APP_PASSWORD || '';
const openaiApiKey = process.env.OPENAI_API_KEY || '';
const vectorStoreId = process.env.ARGUS_VECTOR_STORE_ID || null;

if (!appPassword) {
  console.warn('APP_PASSWORD is not set. Protected routes will reject requests.');
}

if (!openaiApiKey) {
  console.warn('OPENAI_API_KEY is not set. OpenAI features will not work.');
}

export const config: AppConfig = {
  port,
  appPassword,
  openaiApiKey,
  vectorStoreId,
};
