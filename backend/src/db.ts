import mysql from 'mysql2/promise';
import { config } from './config';

let pool: mysql.Pool | null = null;

export async function getDb(): Promise<mysql.Pool> {
  if (!pool) {
    if (!config.dbUser || !config.dbName) {
      throw new Error('Database configuration is incomplete (DB_USER/DB_NAME).');
    }

    pool = mysql.createPool({
      host: config.dbHost,
      port: config.dbPort,
      user: config.dbUser,
      password: config.dbPassword,
      database: config.dbName,
      connectionLimit: 10,
    });
  }

  return pool;
}

export async function initDb(): Promise<void> {
  const db = await getDb();

  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS documents (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      vector_store_file_id VARCHAR(128) NOT NULL,
      openai_file_id       VARCHAR(128) NOT NULL,
      s3_key               VARCHAR(512) NULL,
      filename             VARCHAR(255) NOT NULL,
      document_type        VARCHAR(64)  NOT NULL,
      date                 DATE         NULL,
      provider_name        VARCHAR(255) NULL,
      clinic_or_facility   VARCHAR(255) NULL,
      is_active            TINYINT(1)   NOT NULL DEFAULT 1,
      needs_metadata       TINYINT(1)   NOT NULL DEFAULT 0,
      metadata_json        JSON         NOT NULL,
      created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_vs_file (vector_store_file_id),
      KEY idx_doc_type (document_type),
      KEY idx_date (date),
      KEY idx_provider (provider_name),
      KEY idx_needs_metadata (needs_metadata),
      KEY idx_s3_key (s3_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  await db.query(createTableSQL);

  // Backfill for existing installations: ensure s3_key column exists.
  const [rows] = (await db.query(
    "SHOW COLUMNS FROM documents LIKE 's3_key'",
  )) as any[];
  if (!Array.isArray(rows) || rows.length === 0) {
    await db.query(
      'ALTER TABLE documents ADD COLUMN s3_key VARCHAR(512) NULL AFTER openai_file_id, ADD KEY idx_s3_key (s3_key)',
    );
  }

  // Backfill for existing installations: ensure needs_metadata column exists.
  const [needsMetadataRows] = (await db.query(
    "SHOW COLUMNS FROM documents LIKE 'needs_metadata'",
  )) as any[];
  if (!Array.isArray(needsMetadataRows) || needsMetadataRows.length === 0) {
    await db.query(
      `
        ALTER TABLE documents
        ADD COLUMN needs_metadata TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active,
        ADD KEY idx_needs_metadata (needs_metadata)
      `,
    );

    // Initialize needs_metadata based on existing metadata_json.
    await db.query(
      `
        UPDATE documents
        SET needs_metadata = CASE
          WHEN JSON_TYPE(metadata_json) = 'OBJECT' AND JSON_LENGTH(metadata_json) > 0 THEN 0
          ELSE 1
        END
      `,
    );
  }
}
