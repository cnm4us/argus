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

  const createDocumentsTableSQL = `
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
      markdown             LONGTEXT     NULL,
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

  await db.query(createDocumentsTableSQL);

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

  // Backfill for existing installations: ensure markdown column exists.
  const [markdownRows] = (await db.query(
    "SHOW COLUMNS FROM documents LIKE 'markdown'",
  )) as any[];
  if (!Array.isArray(markdownRows) || markdownRows.length === 0) {
    await db.query(
      `
        ALTER TABLE documents
        ADD COLUMN markdown LONGTEXT NULL AFTER metadata_json
      `,
    );
  }

  const createDocumentVitalsTableSQL = `
    CREATE TABLE IF NOT EXISTS document_vitals (
      document_id              INT UNSIGNED NOT NULL PRIMARY KEY,
      encounter_date           DATE         NULL,
      has_vitals               TINYINT(1)   NOT NULL DEFAULT 0,
      spo2                     TINYINT UNSIGNED NULL,
      spo2_is_low              TINYINT(1)   NOT NULL DEFAULT 0,
      blood_pressure_systolic  SMALLINT UNSIGNED NULL,
      blood_pressure_diastolic SMALLINT UNSIGNED NULL,
      heart_rate               SMALLINT UNSIGNED NULL,
      respiratory_rate         SMALLINT UNSIGNED NULL,
      temperature_f            DECIMAL(4,1) NULL,
      oxygen_device            ENUM('room_air','nasal_cannula','non_rebreather','other','not_documented') NULL,
      height_inches            SMALLINT UNSIGNED NULL,
      weight_pounds            SMALLINT UNSIGNED NULL,
      bmi                      DECIMAL(4,1) NULL,
      created_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_vitals_spo2 (spo2),
      KEY idx_vitals_has_vitals (has_vitals, spo2),
      KEY idx_vitals_date (encounter_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  const createDocumentSmokingTableSQL = `
    CREATE TABLE IF NOT EXISTS document_smoking (
      document_id                       INT UNSIGNED NOT NULL PRIMARY KEY,
      encounter_date                    DATE         NULL,
      patient_status                    ENUM('current','former','unknown') NULL,
      patient_years_smoked              SMALLINT UNSIGNED NULL,
      patient_pack_years                DECIMAL(5,1) NULL,
      provider_status                   ENUM('current','former','never','unknown') NULL,
      provider_years_smoked             SMALLINT UNSIGNED NULL,
      provider_pack_years               DECIMAL(5,1) NULL,
      has_smoking_history_documented    TINYINT(1)   NOT NULL DEFAULT 0,
      has_cessation_counseling          TINYINT(1)   NOT NULL DEFAULT 0,
      advised_to_quit                   TINYINT(1)   NOT NULL DEFAULT 0,
      pharm_nicotine_replacement        TINYINT(1)   NOT NULL DEFAULT 0,
      pharm_varenicline_chantix         TINYINT(1)   NOT NULL DEFAULT 0,
      pharm_bupropion                   TINYINT(1)   NOT NULL DEFAULT 0,
      behavioral_therapy_offered        TINYINT(1)   NOT NULL DEFAULT 0,
      quitline_offered                  TINYINT(1)   NOT NULL DEFAULT 0,
      support_group_offered             TINYINT(1)   NOT NULL DEFAULT 0,
      referral_smoking_program          TINYINT(1)   NOT NULL DEFAULT 0,
      referral_behavioral_health        TINYINT(1)   NOT NULL DEFAULT 0,
      follow_up_plans_documented        TINYINT(1)   NOT NULL DEFAULT 0,
      counseling_time_minutes           SMALLINT UNSIGNED NULL,
      created_at                        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at                        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_smoking_counseling (has_cessation_counseling, encounter_date),
      KEY idx_smoking_history (has_smoking_history_documented, encounter_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  const createDocumentMentalHealthTableSQL = `
    CREATE TABLE IF NOT EXISTS document_mental_health (
      document_id                    INT UNSIGNED NOT NULL PRIMARY KEY,
      encounter_date                 DATE         NULL,
      has_mental_health_content      TINYINT(1)   NOT NULL DEFAULT 0,
      affect_anxious                 TINYINT(1)   NOT NULL DEFAULT 0,
      affect_depressed               TINYINT(1)   NOT NULL DEFAULT 0,
      affect_tearful                 TINYINT(1)   NOT NULL DEFAULT 0,
      affect_labile                  TINYINT(1)   NOT NULL DEFAULT 0,
      affect_flat_or_blunted         TINYINT(1)   NOT NULL DEFAULT 0,
      behavior_emotionally_distressed TINYINT(1)  NOT NULL DEFAULT 0,
      behavior_non_compliant         TINYINT(1)   NOT NULL DEFAULT 0,
      behavior_guarded_or_hostile    TINYINT(1)   NOT NULL DEFAULT 0,
      pressured_speech               TINYINT(1)   NOT NULL DEFAULT 0,
      symptom_anxiety                TINYINT(1)   NOT NULL DEFAULT 0,
      symptom_depression             TINYINT(1)   NOT NULL DEFAULT 0,
      symptom_stress                 TINYINT(1)   NOT NULL DEFAULT 0,
      symptom_panic                  TINYINT(1)   NOT NULL DEFAULT 0,
      symptom_insomnia               TINYINT(1)   NOT NULL DEFAULT 0,
      dx_any_mental_health           TINYINT(1)   NOT NULL DEFAULT 0,
      dx_anxiety_disorder            TINYINT(1)   NOT NULL DEFAULT 0,
      dx_depressive_disorder         TINYINT(1)   NOT NULL DEFAULT 0,
      dx_adjustment_disorder         TINYINT(1)   NOT NULL DEFAULT 0,
      dx_ptsd                        TINYINT(1)   NOT NULL DEFAULT 0,
      dx_bipolar_disorder            TINYINT(1)   NOT NULL DEFAULT 0,
      dx_substance_use_disorder      TINYINT(1)   NOT NULL DEFAULT 0,
      created_at                     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at                     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_mh_any (has_mental_health_content, encounter_date),
      KEY idx_mh_anxiety (symptom_anxiety, encounter_date),
      KEY idx_mh_pressured (pressured_speech, encounter_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  const createDocumentReferralsTableSQL = `
    CREATE TABLE IF NOT EXISTS document_referrals (
      id                                         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      document_id                                INT UNSIGNED NOT NULL,
      encounter_date                             DATE         NULL,
      has_referral_request                       TINYINT(1)   NOT NULL DEFAULT 0,
      referral_specialty                         VARCHAR(64)  NULL,
      referral_reason_text                       TEXT         NULL,
      referral_patient_requested                 TINYINT(1)   NOT NULL DEFAULT 0,
      referral_provider_initiated                TINYINT(1)   NOT NULL DEFAULT 0,
      has_referral_denial                        TINYINT(1)   NOT NULL DEFAULT 0,
      referral_denial_type                       ENUM('insurance_denial','clinical_denial','administrative_denial','other_denial') NULL,
      referral_denial_reason_text                TEXT         NULL,
      reason_mentions_copd                       TINYINT(1)   NOT NULL DEFAULT 0,
      reason_mentions_emphysema_or_obstructive_lung TINYINT(1) NOT NULL DEFAULT 0,
      created_at                                 DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at                                 DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_ref_document_id (document_id, encounter_date),
      KEY idx_ref_specialty (referral_specialty, encounter_date),
      KEY idx_ref_copd (reason_mentions_copd, encounter_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  const createDocumentResultsTableSQL = `
    CREATE TABLE IF NOT EXISTS document_results (
      id                   INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      document_id          INT UNSIGNED NOT NULL,
      encounter_date       DATE         NULL,
      result_type          ENUM('lab','imaging') NULL,
      lab_category         VARCHAR(64)  NULL,
      lab_subtype          VARCHAR(128) NULL,
      lab_abnormal_flags   TEXT         NULL,
      lab_summary_text     TEXT         NULL,
      imaging_category     VARCHAR(64)  NULL,
      imaging_subtype      VARCHAR(128) NULL,
      impression_text      TEXT         NULL,
      findings_text        TEXT         NULL,
      reason_for_test      TEXT         NULL,
      created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_results_doc (document_id, encounter_date),
      KEY idx_results_type (result_type, lab_category, imaging_category)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  const createDocumentAppointmentsTableSQL = `
    CREATE TABLE IF NOT EXISTS document_appointments (
      id                   INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      document_id          INT UNSIGNED NOT NULL,
      appointment_date     DATETIME     NULL,
      status               ENUM('scheduled','completed','no_show','canceled','rescheduled','unknown') NULL,
      source               VARCHAR(64)  NULL,
      related_specialty    VARCHAR(64)  NULL,
      reason_text          TEXT         NULL,
      created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_appt_doc (document_id, appointment_date),
      KEY idx_appt_status (status, appointment_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  const createDocumentCommunicationsTableSQL = `
    CREATE TABLE IF NOT EXISTS document_communications (
      document_id          INT UNSIGNED NOT NULL PRIMARY KEY,
      encounter_date       DATE         NULL,
      initiated_by         ENUM('patient','provider','clinic','pharmacy','insurance','attorney','other','unknown','not_documented') NULL,
      message_direction    ENUM('inbound','outbound','bidirectional','unknown','not_documented') NULL,
      reason_text          TEXT         NULL,
      advice_given_text    TEXT         NULL,
      patient_response_text TEXT        NULL,
      created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_comm_initiated (initiated_by, encounter_date),
      KEY idx_comm_direction (message_direction, encounter_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  const createTaxonomyCategoriesTableSQL = `
    CREATE TABLE IF NOT EXISTS taxonomy_categories (
      id          VARCHAR(64) PRIMARY KEY,
      label       VARCHAR(255) NOT NULL,
      description TEXT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  const createTaxonomyKeywordsTableSQL = `
    CREATE TABLE IF NOT EXISTS taxonomy_keywords (
      id            VARCHAR(128) PRIMARY KEY,
      category_id   VARCHAR(64) NOT NULL,
      label         VARCHAR(255) NOT NULL,
      synonyms_json JSON NOT NULL,
      description   TEXT NULL,
      status        ENUM('approved','review') NOT NULL DEFAULT 'approved',
      created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_keywords_category
        FOREIGN KEY (category_id) REFERENCES taxonomy_categories(id)
          ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  const createTaxonomySubkeywordsTableSQL = `
    CREATE TABLE IF NOT EXISTS taxonomy_subkeywords (
      id             VARCHAR(160) PRIMARY KEY,
      keyword_id     VARCHAR(128) NOT NULL,
      label          VARCHAR(255) NOT NULL,
      synonyms_json  JSON NOT NULL,
      description    TEXT NULL,
      status         ENUM('approved','review') NOT NULL DEFAULT 'approved',
      created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_subkeywords_keyword
        FOREIGN KEY (keyword_id) REFERENCES taxonomy_keywords(id)
          ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  const createDocumentTermsTableSQL = `
    CREATE TABLE IF NOT EXISTS document_terms (
      id              INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      document_id     INT UNSIGNED NOT NULL,
      keyword_id      VARCHAR(128) NULL,
      subkeyword_id   VARCHAR(160) NULL,
      created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_doc_terms_doc (document_id),
      KEY idx_doc_terms_keyword (keyword_id),
      KEY idx_doc_terms_subkeyword (subkeyword_id),
      UNIQUE KEY uniq_doc_term (document_id, keyword_id, subkeyword_id),
      CONSTRAINT fk_doc_terms_keyword
        FOREIGN KEY (keyword_id) REFERENCES taxonomy_keywords(id)
          ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT fk_doc_terms_subkeyword
        FOREIGN KEY (subkeyword_id) REFERENCES taxonomy_subkeywords(id)
          ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  await db.query(createDocumentVitalsTableSQL);
  await db.query(createDocumentSmokingTableSQL);
  await db.query(createDocumentMentalHealthTableSQL);
  await db.query(createDocumentReferralsTableSQL);
  await db.query(createDocumentResultsTableSQL);
  await db.query(createDocumentAppointmentsTableSQL);
  await db.query(createDocumentCommunicationsTableSQL);
  await db.query(createTaxonomyCategoriesTableSQL);
  await db.query(createTaxonomyKeywordsTableSQL);
  await db.query(createTaxonomySubkeywordsTableSQL);
  await db.query(createDocumentTermsTableSQL);

  // Seed initial taxonomy categories (idempotent).
  await db.query(
    `
      INSERT IGNORE INTO taxonomy_categories (id, label, description)
      VALUES
        ('respiratory', 'Respiratory', 'Respiratory status, oxygenation, COPD/emphysema, and related concepts.'),
        ('results', 'Results', 'Lab and imaging results that impact follow-up and standard of care.'),
        ('referrals', 'Referrals', 'Specialty referrals, referral reasons, and denials.'),
        ('communication', 'Communication', 'Patient-provider communications, telephone encounters, and messaging.'),
        ('appointments', 'Appointments', 'Scheduling, missed visits, cancellations, and rescheduling.'),
        ('vitals', 'Vitals', 'Vital sign measurements and patterns (SpO2, BP, HR, RR, temperature, weight/BMI).'),
        ('smoking', 'Smoking', 'Tobacco history, pack-years, and cessation counseling.'),
        ('mental_health', 'Mental Health', 'Mental health symptoms, diagnoses, and observed behaviors.')
    `,
  );

  // Seed a small set of core taxonomy keywords for vitals, smoking, and mental health.
  await db.query(
    `
      INSERT IGNORE INTO taxonomy_keywords (id, category_id, label, synonyms_json, description, status)
      VALUES
        -- Vitals
        ('vitals.any_mention', 'vitals', 'Any vitals mention', JSON_ARRAY('vitals', 'vital signs', 'vital sign'), 'Document contains any vital sign measurements.', 'approved'),
        ('vitals.hypoxia', 'vitals', 'Hypoxia', JSON_ARRAY('hypoxia', 'low oxygen', 'low o2', 'desaturation'), 'Low oxygen saturation or hypoxia.', 'approved'),
        ('vitals.hypotension', 'vitals', 'Hypotension', JSON_ARRAY('hypotension', 'low blood pressure'), 'Low blood pressure (e.g., SBP < 90 or DBP < 60).', 'approved'),
        ('vitals.tachycardia', 'vitals', 'Tachycardia', JSON_ARRAY('tachycardia', 'fast heart rate'), 'High heart rate (e.g., HR >= 120).', 'approved'),
        ('vitals.fever', 'vitals', 'Fever', JSON_ARRAY('fever', 'febrile'), 'Fever (e.g., temperature >= 100.4°F).', 'approved'),
        -- Smoking
        ('smoking.any_mention', 'smoking', 'Any smoking mention', JSON_ARRAY('smoking', 'tobacco', 'smoker'), 'Document contains any smoking or tobacco history.', 'approved'),
        ('smoking.current_smoker', 'smoking', 'Current smoker', JSON_ARRAY('current smoker', 'smokes', 'active smoker'), 'Patient is documented as a current smoker.', 'approved'),
        ('smoking.former_smoker', 'smoking', 'Former smoker', JSON_ARRAY('former smoker', 'quit smoking', 'ex-smoker'), 'Patient is documented as a former smoker.', 'approved'),
        ('smoking.never_smoker', 'smoking', 'Never smoker', JSON_ARRAY('never smoker', 'denies smoking'), 'Patient is documented as a never smoker.', 'approved'),
        ('smoking.cessation_counseling', 'smoking', 'Smoking cessation counseling', JSON_ARRAY('smoking cessation counseling', 'tobacco counseling'), 'Smoking cessation counseling, support, or referrals documented.', 'approved'),
        -- Mental health
        ('mental_health.any_mention', 'mental_health', 'Any mental health mention', JSON_ARRAY('mental health', 'psychiatric', 'psych'), 'Document contains mental health content (symptoms, diagnoses, or behaviors).', 'approved'),
        ('mental_health.anxiety', 'mental_health', 'Anxiety', JSON_ARRAY('anxiety', 'anxious'), 'Symptoms or diagnosis related to anxiety.', 'approved'),
        ('mental_health.depression', 'mental_health', 'Depression', JSON_ARRAY('depression', 'depressed', 'major depressive disorder'), 'Symptoms or diagnosis related to depression.', 'approved'),
        ('mental_health.substance_use_disorder', 'mental_health', 'Substance use disorder', JSON_ARRAY('substance use disorder', 'alcohol use disorder', 'drug dependence'), 'Diagnosis related to substance or alcohol use disorder.', 'approved')
    `,
  );

  // Ensure document_communications enum columns include all expected values.
  try {
    await db.query(
      `
        ALTER TABLE document_communications
        MODIFY initiated_by ENUM(
          'patient',
          'provider',
          'clinic',
          'pharmacy',
          'insurance',
          'attorney',
          'other',
          'unknown',
          'not_documented'
        ) NULL
      `,
    );
    await db.query(
      `
        ALTER TABLE document_communications
        MODIFY message_direction ENUM(
          'inbound',
          'outbound',
          'bidirectional',
          'unknown',
          'not_documented'
        ) NULL
      `,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      'Warning: failed to normalize document_communications enum columns',
      err,
    );
  }

  // Backfill / migrate older single-row document_referrals schema (if present).
  const [refCols] = (await db.query(
    "SHOW COLUMNS FROM document_referrals LIKE 'id'",
  )) as any[];
  if (!Array.isArray(refCols) || refCols.length === 0) {
    // Old schema: document_id was PRIMARY KEY. Migrate to multi-row schema.
    try {
      await db.query('ALTER TABLE document_referrals DROP PRIMARY KEY');
      await db.query(
        'ALTER TABLE document_referrals MODIFY document_id INT UNSIGNED NOT NULL',
      );
      await db.query(
        'ALTER TABLE document_referrals ADD COLUMN id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST',
      );
      await db.query(
        'ALTER TABLE document_referrals ADD KEY idx_ref_document_id (document_id, encounter_date)',
      );
    } catch (err) {
      // Log and continue; in dev this is acceptable.
      // eslint-disable-next-line no-console
      console.warn('Warning: failed to migrate document_referrals schema', err);
    }
  }
}
