import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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

export async function deleteObjectFromS3(key: string): Promise<void> {
  if (!config.s3Bucket) {
    return;
  }

  try {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: config.s3Bucket,
        Key: key,
      }),
    );
  } catch (err) {
    console.warn('Failed to delete object from S3', key, err);
  }
}

export async function getPresignedUrlForS3Key(
  key: string,
  expiresSeconds = 900,
): Promise<string> {
  if (!config.s3Bucket) {
    throw new Error('ARGUS_S3_BUCKET is not configured');
  }

  const command = new GetObjectCommand({
    Bucket: config.s3Bucket,
    Key: key,
  });

  const url = await getSignedUrl(s3, command, {
    expiresIn: expiresSeconds,
  });

  return url;
}
