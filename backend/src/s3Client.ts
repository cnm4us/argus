import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import type { Readable } from 'stream';
import { config } from './config';

export const s3 = new S3Client({
  region: config.awsRegion,
});

export function buildS3Key(fileId: string, extension = '.pdf'): string {
  const prefix = config.s3Prefix || '';
  const normalizedPrefix =
    prefix === '' ? '' : prefix.endsWith('/') ? prefix : `${prefix}/`;
  return `${normalizedPrefix}${fileId}${extension}`;
}

export async function uploadPdfToS3(
  fileId: string,
  buffer: Buffer,
  filename: string,
): Promise<string> {
  if (!config.s3Bucket) {
    throw new Error('ARGUS_S3_BUCKET is not configured');
  }

  const key = buildS3Key(fileId, '.pdf');

  await s3.send(
    new PutObjectCommand({
      Bucket: config.s3Bucket,
      Key: key,
      Body: buffer,
      ContentType: 'application/pdf',
      Metadata: {
        original_filename: filename,
      },
    }),
  );

  return key;
}

export async function getPdfStreamFromS3(
  fileId: string,
): Promise<{ stream: Readable; filename: string }> {
  if (!config.s3Bucket) {
    throw new Error('ARGUS_S3_BUCKET is not configured');
  }

  const key = buildS3Key(fileId, '.pdf');

  const response = await s3.send(
    new GetObjectCommand({
      Bucket: config.s3Bucket,
      Key: key,
    }),
  );

  const stream = response.Body as Readable;
  const filename =
    (response.Metadata && response.Metadata['original_filename']) ||
    `${fileId}.pdf`;

  return { stream, filename };
}

