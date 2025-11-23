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
      filename             VARCHAR(255) NOT NULL,
      document_type        VARCHAR(64)  NOT NULL,
      date                 DATE         NULL,
      provider_name        VARCHAR(255) NULL,
      clinic_or_facility   VARCHAR(255) NULL,
      is_active            TINYINT(1)   NOT NULL DEFAULT 1,
      metadata_json        JSON         NOT NULL,
      created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_vs_file (vector_store_file_id),
      KEY idx_doc_type (document_type),
      KEY idx_date (date),
      KEY idx_provider (provider_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  await db.query(createTableSQL);
}

