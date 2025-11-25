import dotenv from 'dotenv';

dotenv.config();

export interface AppConfig {
  port: number;
  appPassword: string;
  openaiApiKey: string;
  vectorStoreId: string | null;
  debugRequests: boolean;
  metadataRetryMaxAttempts: number;
  metadataRetryBaseDelaySeconds: number;
  classifyConfidenceThreshold: number;
  autoMetadataAfterClassify: boolean;
  awsRegion: string;
  s3Bucket: string | null;
  s3Prefix: string;
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
const debugRequestsEnv = process.env.DEBUG_REQUESTS || '0';
const debugRequests =
  debugRequestsEnv === '1' ||
  debugRequestsEnv.toLowerCase() === 'true';
const metadataRetryMaxAttempts = Number(
  process.env.METADATA_RETRY_MAX_ATTEMPTS || '3',
);
const metadataRetryBaseDelaySeconds = Number(
  process.env.METADATA_RETRY_BASE_DELAY_SECONDS || '4',
);
const classifyConfidenceThreshold = Number(
  process.env.CLASSIFY_CONFIDENCE_THRESHOLD || '0.85',
);
const autoMetadataAfterClassifyEnv =
  process.env.AUTO_METADATA_AFTER_CLASSIFY || '0';
const autoMetadataAfterClassify =
  autoMetadataAfterClassifyEnv === '1' ||
  autoMetadataAfterClassifyEnv.toLowerCase() === 'true';
const awsRegion = process.env.AWS_REGION || 'us-west-1';
const s3Bucket = process.env.ARGUS_S3_BUCKET || null;
const s3Prefix = process.env.ARGUS_S3_PREFIX || '';
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

if (!s3Bucket) {
  console.warn('ARGUS_S3_BUCKET is not set. S3 file storage will not work.');
}

if (!dbUser || !dbName) {
  console.warn('Database credentials (DB_USER/DB_NAME) are not fully set. DB features will not work.');
}

export const config: AppConfig = {
  port,
  appPassword,
  openaiApiKey,
  vectorStoreId,
  debugRequests,
  metadataRetryMaxAttempts,
  metadataRetryBaseDelaySeconds,
  classifyConfidenceThreshold,
  autoMetadataAfterClassify,
  awsRegion,
  s3Bucket,
  s3Prefix,
  dbHost,
  dbPort,
  dbUser,
  dbPassword,
  dbName,
};
