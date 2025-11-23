import OpenAI from 'openai';
import { config } from './config';

if (!config.openaiApiKey) {
  console.warn('OPENAI_API_KEY is not set; OpenAI client will not function.');
}

export const openai = new OpenAI({
  apiKey: config.openaiApiKey || 'missing',
});

