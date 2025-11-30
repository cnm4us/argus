Below is a Codex-oriented package with:

Final JSON schema (conceptual + example)

Suggested MariaDB schema (tables + JSON columns)

LLM prompt template for taxonomy updates

A Node.js “taxonomy integrity checker” to enforce your rules

You can drop this straight into your repo as e.g. docs/taxonomy_spec.md + a scripts/ folder.

1. Final JSON Schema
1.1. Conceptual structure

We’ll treat the taxonomy as a tree:

Category (fixed, curated)

Keyword (dynamic)

Synonyms (equivalent labels to the keyword)

Subkeywords (child concepts)

Synonyms (equivalent labels to the subkeyword)

Key rules we’re enforcing:

A keyword’s synonyms:

Are unique to that keyword (no synonym string appears under two different keywords).

Subkeywords under the same keyword:

Cannot share synonyms with each other.

Subkeywords under different keywords are allowed to share synonyms.

1.2. TypeScript-style types for Codex
export type Taxonomy = {
  categories: Category[];
};

export type Category = {
  id: string;            // e.g. "respiratory"
  label: string;         // human-readable, e.g. "Respiratory"
  description?: string;
  keywords: Keyword[];
};

export type Keyword = {
  id: string;            // unique, e.g. "respiratory.oxygen_saturation"
  label: string;         // canonical label, e.g. "oxygen saturation"
  synonyms: string[];    // synonyms (exclusive to this keyword)
  description?: string;
  subkeywords: Subkeyword[];
};

export type Subkeyword = {
  id: string;            // unique, e.g. "respiratory.oxygen_saturation.hypoxia"
  label: string;         // canonical label, e.g. "hypoxia"
  synonyms: string[];    // synonyms (can overlap across keywords, but not within same keyword)
  description?: string;
};

1.3. Example JSON instance
{
  "categories": [
    {
      "id": "respiratory",
      "label": "Respiratory",
      "description": "Respiratory status, oxygenation, and pulmonary conditions.",
      "keywords": [
        {
          "id": "respiratory.oxygen_saturation",
          "label": "oxygen saturation",
          "synonyms": ["SpO2", "oxygen sat", "O2 saturation"],
          "description": "Concepts related to measurement of oxygen saturation.",
          "subkeywords": [
            {
              "id": "respiratory.oxygen_saturation.hypoxia",
              "label": "hypoxia",
              "synonyms": ["low oxygen", "low O2", "poor oxygenation"],
              "description": "States of below-normal oxygen levels in blood or tissues."
            },
            {
              "id": "respiratory.oxygen_saturation.desaturation_episode",
              "label": "desaturation episode",
              "synonyms": ["desat", "oxygen drop", "O2 drop"],
              "description": "Discrete events where saturation falls below baseline."
            }
          ]
        },
        {
          "id": "respiratory.emphysema",
          "label": "emphysema",
          "synonyms": ["pulmonary emphysema"],
          "subkeywords": [
            {
              "id": "respiratory.emphysema.hyperinflation",
              "label": "hyperinflation",
              "synonyms": ["lung hyperinflation"],
              "description": "Lung overexpansion associated with emphysema."
            }
          ]
        }
      ]
    }
  ]
}

2. MariaDB Schema (for Codex + you)

You said you’ll implement with MariaDB, so here’s a minimal, pragmatic schema.

2.1. Table layout

taxonomy_categories

CREATE TABLE taxonomy_categories (
  id          VARCHAR(64) PRIMARY KEY,
  label       VARCHAR(255) NOT NULL,
  description TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


taxonomy_keywords

CREATE TABLE taxonomy_keywords (
  id            VARCHAR(128) PRIMARY KEY,
  category_id   VARCHAR(64) NOT NULL,
  label         VARCHAR(255) NOT NULL,
  synonyms_json JSON NOT NULL,  -- array of strings
  description   TEXT NULL,
  CONSTRAINT fk_keywords_category
    FOREIGN KEY (category_id) REFERENCES taxonomy_categories(id)
      ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


taxonomy_subkeywords

CREATE TABLE taxonomy_subkeywords (
  id             VARCHAR(160) PRIMARY KEY,
  keyword_id     VARCHAR(128) NOT NULL,
  label          VARCHAR(255) NOT NULL,
  synonyms_json  JSON NOT NULL,  -- array of strings
  description    TEXT NULL,
  CONSTRAINT fk_subkeywords_keyword
    FOREIGN KEY (keyword_id) REFERENCES taxonomy_keywords(id)
      ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


Later, you can add:

documents table

document_terms many-to-many mapping between documents and (keyword_id, subkeyword_id) to support filtering.

3. LLM Prompt Template for Taxonomy Updates

This is the heart of your pipeline.
You want a prompt Codex / your API can use when:

You have:

a document snippet / encounter section

the current taxonomy (or the relevant category slice)

You want the model to:

choose an existing keyword where possible

create a new keyword only when necessary

pick subkeywords / create new subkeywords

add synonyms in a controlled way

Below is a prompt template you can embed as a string in your Node.js code.

3.1. System prompt (taxonomy logic)
You are a medical-legal taxonomy assistant.

You are given:
- A fixed list of high-level categories (Level 1).
- For one selected category, a list of existing keywords (Level 2) and their synonyms.
- For each keyword, a list of subkeywords (Level 3) and their synonyms.
- A text passage from a medical or legal document (e.g., visit note, imaging report, lab, referral, communication).

Your job is to update the taxonomy for THIS ONE CATEGORY based on the text.

Core rules:

1. Categories (Level 1)
   - Categories are fixed and must NOT be changed, renamed, or extended in this task.

2. Keywords (Level 2)
   - A keyword represents a distinct concept under the category.
   - Each keyword has:
       - a canonical label (label)
       - a list of synonyms (synonyms[])
   - Synonyms are interchangeable names for that keyword.
   - A given synonym string MUST belong to exactly ONE keyword within the entire taxonomy.
   - If the text expresses a concept that matches an existing keyword or any of its synonyms, REUSE that keyword.
   - Only create a new keyword when:
       - No existing keyword is semantically close enough, AND
       - The concept is distinct enough to be useful as a new search facet.

3. Subkeywords (Level 3)
   - Subkeywords are child concepts of a keyword (e.g. specific situations, patterns, or variants).
   - Each subkeyword has:
       - a canonical label (label)
       - a list of synonyms (synonyms[])
   - Subkeywords under the SAME keyword MUST NOT share synonyms.
       - If two subkeywords would share a synonym, they should be merged or treated as one concept.
   - Subkeywords under DIFFERENT keywords CAN share synonyms.
   - Use subkeywords to capture more specific ideas, related but subordinate to the keyword.

4. Synonyms
   - Synonyms are alternate phrasings, abbreviations, or common variants that mean the same concept.
   - A synonym never introduces a new concept; it only points to an existing concept.
   - Do NOT create synonyms that overlap with an existing keyword label or synonym belonging to a different keyword.

5. Behaviors
   - Prefer reusing existing keywords and subkeywords where possible.
   - Only create new keywords and subkeywords when there is clear evidence of a distinct, recurring concept.
   - Output must not modify or delete existing taxonomy data; only ADD new items (keywords, subkeywords, or synonyms).
   - Be conservative: fewer, well-defined concepts are better than many overlapping ones.

You must respond with a strict JSON object describing ONLY the additions or matches for this single document.
Do NOT include the full taxonomy; only your decisions for this passage.

3.2. User prompt template (runtime)

In Node, you’d fill in placeholders:

CATEGORIES (fixed list, for reference only):
{{categories_overview}}   # e.g. ["Respiratory", "Labs", "Imaging", "Referrals", "Communication", ...]

SELECTED CATEGORY CONTEXT:
{{category_context_json}} 

This JSON contains the category, its existing keywords, and their subkeywords and synonyms. Example structure:

{
  "id": "respiratory",
  "label": "Respiratory",
  "keywords": [
    {
      "id": "respiratory.oxygen_saturation",
      "label": "oxygen saturation",
      "synonyms": ["SpO2", "oxygen sat", "O2 saturation"],
      "subkeywords": [
        {
          "id": "respiratory.oxygen_saturation.hypoxia",
          "label": "hypoxia",
          "synonyms": ["low oxygen", "low O2", "poor oxygenation"]
        }
      ]
    }
  ]
}

TEXT PASSAGE TO ANALYZE:
"""
{{document_snippet}}
"""

TASK:

1. Identify concepts in the passage that belong under this category.
2. For each concept, decide:
   - Does it match an existing keyword? If yes, reference it.
   - If not, should a NEW keyword be created? If yes, define it and its synonyms.
3. For each keyword (existing or new) that applies:
   - Choose any applicable existing subkeywords.
   - Optionally define new subkeywords and their synonyms.

IMPORTANT:
- Do NOT create or refer to new categories.
- Respect the constraints about synonyms (no overlap across keywords; no overlap among subkeywords under the same keyword).
- Be conservative; do not create unnecessary new entities.

OUTPUT JSON SHAPE:

{
  "category_id": "respiratory",
  "keyword_matches": [
    {
      "keyword_id": "respiratory.oxygen_saturation",      // existing keyword, OR null if new
      "new_keyword": {
        "label": "optional new keyword label or null",
        "synonyms": ["optional", "new", "keyword", "synonyms"]
      },
      "selected_existing_synonyms": [
        "SpO2"   // which existing synonyms in this keyword appeared in the text, if any
      ],
      "added_synonyms": [
        "new synonym 1",
        "new synonym 2"
      ],
      "subkeyword_matches": [
        {
          "subkeyword_id": "respiratory.oxygen_saturation.hypoxia",  // existing or null
          "new_subkeyword": {
            "label": "optional new subkeyword label or null",
            "synonyms": ["optional", "new", "subkeyword", "synonyms"]
          },
          "selected_existing_synonyms": [
            "low oxygen"
          ],
          "added_synonyms": [
            "oxygen deprivation"
          ]
        }
      ]
    }
  ]
}


You can adjust fields, but this gives Codex a precise target.

4. Taxonomy Integrity Checker (Node.js + MariaDB)

Here’s a Node-ish script Codex can refine that:

Loads taxonomy from MariaDB

Validates:

No keyword synonyms are shared across keywords

No subkeyword synonyms are shared among subkeywords under the same keyword

Prints a report (or throws)

4.1. Example script scripts/checkTaxonomyIntegrity.ts
import mysql from "mysql2/promise";

type KeywordRow = {
  id: string;
  category_id: string;
  label: string;
  synonyms_json: string; // JSON string
};

type SubkeywordRow = {
  id: string;
  keyword_id: string;
  label: string;
  synonyms_json: string; // JSON string
};

async function getConnection() {
  return mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });
}

async function loadKeywords(conn: mysql.Connection): Promise<KeywordRow[]> {
  const [rows] = await conn.query("SELECT id, category_id, label, synonyms_json FROM taxonomy_keywords");
  return rows as KeywordRow[];
}

async function loadSubkeywords(conn: mysql.Connection): Promise<SubkeywordRow[]> {
  const [rows] = await conn.query("SELECT id, keyword_id, label, synonyms_json FROM taxonomy_subkeywords");
  return rows as SubkeywordRow[];
}

function normalizeSynonym(s: string): string {
  return s.trim().toLowerCase();
}

function checkKeywordSynonymUniqueness(keywords: KeywordRow[]) {
  const synonymMap = new Map<string, string>(); // synonym -> keyword_id
  const errors: string[] = [];

  for (const kw of keywords) {
    let synonyms: string[] = [];
    try {
      synonyms = JSON.parse(kw.synonyms_json) ?? [];
    } catch (e) {
      errors.push(`Keyword ${kw.id} has invalid synonyms_json`);
      continue;
    }

    for (const syn of synonyms) {
      const norm = normalizeSynonym(syn);
      if (!norm) continue;

      const existing = synonymMap.get(norm);
      if (existing && existing !== kw.id) {
        errors.push(
          `Keyword synonym conflict: "${syn}" used by both keyword ${existing} and ${kw.id}`
        );
      } else if (!existing) {
        synonymMap.set(norm, kw.id);
      }
    }
  }

  return errors;
}

function checkSubkeywordSynonymUniqueness(subkeywords: SubkeywordRow[]) {
  const errors: string[] = [];

  // Group subkeywords by keyword_id
  const byKeyword = new Map<string, SubkeywordRow[]>();
  for (const sk of subkeywords) {
    if (!byKeyword.has(sk.keyword_id)) {
      byKeyword.set(sk.keyword_id, []);
    }
    byKeyword.get(sk.keyword_id)!.push(sk);
  }

  // For each keyword, ensure no synonym collision among its subkeywords
  for (const [keywordId, subs] of byKeyword.entries()) {
    const localSynonymMap = new Map<string, string>(); // synonym -> subkeyword_id

    for (const sk of subs) {
      let synonyms: string[] = [];
      try {
        synonyms = JSON.parse(sk.synonyms_json) ?? [];
      } catch (e) {
        errors.push(`Subkeyword ${sk.id} under keyword ${keywordId} has invalid synonyms_json`);
        continue;
      }

      for (const syn of synonyms) {
        const norm = normalizeSynonym(syn);
        if (!norm) continue;

        const existing = localSynonymMap.get(norm);
        if (existing && existing !== sk.id) {
          errors.push(
            `Subkeyword synonym conflict under keyword ${keywordId}: "${syn}" used by both subkeyword ${existing} and ${sk.id}`
          );
        } else if (!existing) {
          localSynonymMap.set(norm, sk.id);
        }
      }
    }
  }

  return errors;
}

async function main() {
  const conn = await getConnection();
  try {
    const keywords = await loadKeywords(conn);
    const subkeywords = await loadSubkeywords(conn);

    const keywordErrors = checkKeywordSynonymUniqueness(keywords);
    const subkeywordErrors = checkSubkeywordSynonymUniqueness(subkeywords);

    const allErrors = [...keywordErrors, ...subkeywordErrors];

    if (allErrors.length === 0) {
      console.log("✅ Taxonomy integrity check passed. No synonym conflicts found.");
    } else {
      console.error("❌ Taxonomy integrity check found issues:");
      for (const e of allErrors) {
        console.error(" - " + e);
      }
      process.exitCode = 1;
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("Fatal error during taxonomy integrity check:", err);
  process.exit(1);
});