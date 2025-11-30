import type mysql from 'mysql2/promise';
import { getDb } from './db';

export type Taxonomy = {
  categories: Category[];
};

export type Category = {
  id: string;
  label: string;
  description?: string | null;
  keywords: Keyword[];
};

export type Keyword = {
  id: string;
  categoryId: string;
  label: string;
  synonyms: string[];
  description?: string | null;
  status: 'approved' | 'review';
  subkeywords: Subkeyword[];
};

export type Subkeyword = {
  id: string;
  keywordId: string;
  label: string;
  synonyms: string[];
  description?: string | null;
  status: 'approved' | 'review';
};

type KeywordRow = {
  id: string;
  category_id: string;
  label: string;
  synonyms_json: string;
  description: string | null;
  status: 'approved' | 'review';
};

type SubkeywordRow = {
  id: string;
  keyword_id: string;
  label: string;
  synonyms_json: string;
  description: string | null;
  status: 'approved' | 'review';
};

export async function loadTaxonomy(
  opts?: { includeReview?: boolean },
): Promise<Taxonomy> {
  const db = await getDb();
  const includeReview = opts?.includeReview === true;

  const [categoryRows] = (await db.query(
    'SELECT id, label, description FROM taxonomy_categories ORDER BY id ASC',
  )) as any[];

  const statusClause = includeReview ? '' : "WHERE status = 'approved'";

  const [keywordRows] = (await db.query(
    `
      SELECT id, category_id, label, synonyms_json, description, status
      FROM taxonomy_keywords
      ${statusClause}
      ORDER BY category_id ASC, label ASC
    `,
  )) as any[];

  const [subkeywordRows] = (await db.query(
    `
      SELECT id, keyword_id, label, synonyms_json, description, status
      FROM taxonomy_subkeywords
      ${statusClause}
      ORDER BY keyword_id ASC, label ASC
    `,
  )) as any[];

  const keywordsByCategory = new Map<string, Keyword[]>();
  const subkeywordsByKeyword = new Map<string, Subkeyword[]>();

  for (const row of subkeywordRows as SubkeywordRow[]) {
    let synonyms: string[] = [];
    try {
      const parsed = JSON.parse(row.synonyms_json);
      if (Array.isArray(parsed)) {
        synonyms = parsed.filter((x) => typeof x === 'string');
      }
    } catch {
      // Ignore invalid JSON; treat as empty synonyms.
    }

    const list = subkeywordsByKeyword.get(row.keyword_id) ?? [];
    list.push({
      id: row.id,
      keywordId: row.keyword_id,
      label: row.label,
      synonyms,
      description: row.description,
      status: row.status,
    });
    subkeywordsByKeyword.set(row.keyword_id, list);
  }

  for (const row of keywordRows as KeywordRow[]) {
    let synonyms: string[] = [];
    try {
      const parsed = JSON.parse(row.synonyms_json);
      if (Array.isArray(parsed)) {
        synonyms = parsed.filter((x) => typeof x === 'string');
      }
    } catch {
      // Ignore invalid JSON; treat as empty synonyms.
    }

    const list = keywordsByCategory.get(row.category_id) ?? [];
    list.push({
      id: row.id,
      categoryId: row.category_id,
      label: row.label,
      synonyms,
      description: row.description,
      status: row.status,
      subkeywords: subkeywordsByKeyword.get(row.id) ?? [],
    });
    keywordsByCategory.set(row.category_id, list);
  }

  const categories: Category[] = (Array.isArray(categoryRows)
    ? categoryRows
    : []
  ).map((row: any) => ({
    id: row.id as string,
    label: row.label as string,
    description: (row.description as string | null) ?? null,
    keywords: keywordsByCategory.get(row.id as string) ?? [],
  }));

  return { categories };
}

export async function insertKeyword(opts: {
  categoryId: string;
  id: string;
  label: string;
  synonyms?: string[];
  description?: string;
  status?: 'approved' | 'review';
  connection?: mysql.Pool | mysql.Connection;
}): Promise<void> {
  const db = opts.connection ?? (await getDb());
  const synonyms = (opts.synonyms ?? []).filter(
    (s) => typeof s === 'string' && s.trim().length > 0,
  );
  const synonymsJson = JSON.stringify(synonyms);
  const status = opts.status ?? 'review';

  await db.query(
    `
      INSERT INTO taxonomy_keywords (id, category_id, label, synonyms_json, description, status)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        label = VALUES(label),
        synonyms_json = VALUES(synonyms_json),
        description = VALUES(description),
        status = VALUES(status)
    `,
    [
      opts.id,
      opts.categoryId,
      opts.label,
      synonymsJson,
      opts.description ?? null,
      status,
    ],
  );
}

export async function insertSubkeyword(opts: {
  keywordId: string;
  id: string;
  label: string;
  synonyms?: string[];
  description?: string;
  status?: 'approved' | 'review';
  connection?: mysql.Pool | mysql.Connection;
}): Promise<void> {
  const db = opts.connection ?? (await getDb());
  const synonyms = (opts.synonyms ?? []).filter(
    (s) => typeof s === 'string' && s.trim().length > 0,
  );
  const synonymsJson = JSON.stringify(synonyms);
  const status = opts.status ?? 'review';

  await db.query(
    `
      INSERT INTO taxonomy_subkeywords (id, keyword_id, label, synonyms_json, description, status)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        label = VALUES(label),
        synonyms_json = VALUES(synonyms_json),
        description = VALUES(description),
        status = VALUES(status)
    `,
    [
      opts.id,
      opts.keywordId,
      opts.label,
      synonymsJson,
      opts.description ?? null,
      status,
    ],
  );
}

export async function insertDocumentTerm(opts: {
  documentId: number;
  keywordId?: string | null;
  subkeywordId?: string | null;
  connection?: mysql.Pool | mysql.Connection;
}): Promise<void> {
  const db = opts.connection ?? (await getDb());
  const keywordId = opts.keywordId ?? null;
  const subkeywordId = opts.subkeywordId ?? null;

  if (!keywordId && !subkeywordId) {
    return;
  }

  await db.query(
    `
      INSERT IGNORE INTO document_terms (document_id, keyword_id, subkeyword_id)
      VALUES (?, ?, ?)
    `,
    [opts.documentId, keywordId, subkeywordId],
  );
}
