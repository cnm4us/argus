import express from 'express';
import multer from 'multer';
import type { Request, Response } from 'express';
import { toFile } from 'openai';
import { requireAuth } from '../middleware/auth';
import { config } from '../config';
import { openai } from '../openaiClient';
import {
  DOCUMENT_TYPES,
  type DocumentType,
  type DocumentMetadata,
} from '../documentTypes';
import {
  loadTemplateForDocumentType,
  loadClassificationTemplate,
  loadHighLevelClassificationTemplate,
  loadModuleSelectionTemplate,
  loadModuleTemplate,
} from '../templates';
import { getDb } from '../db';
import { uploadPdfToS3, deleteObjectFromS3 } from '../s3Client';
import { logOpenAI } from '../logger';
import { updateDocumentProjectionsForVectorStoreFile } from '../metadataProjections';
import {
  loadTaxonomy,
  insertKeyword,
  insertSubkeyword,
  insertDocumentTerm,
  insertDocumentTermEvidence,
} from '../taxonomy';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB
  },
});

function isValidDocumentType(value: string): value is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(value);
}

async function extractMetadataFromMarkdown(
  documentType: DocumentType,
  markdown: string,
  fileName: string,
): Promise<DocumentMetadata | null> {
  const maxAttempts =
    config.metadataRetryMaxAttempts > 0 ? config.metadataRetryMaxAttempts : 3;
  const baseDelaySeconds =
    config.metadataRetryBaseDelaySeconds > 0
      ? config.metadataRetryBaseDelaySeconds
      : 4;
  const baseDelayMs = baseDelaySeconds * 1000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      logOpenAI('extractMetadata:markdown:start', {
        documentType,
        fileName,
        attempt,
      });

      const template = await loadTemplateForDocumentType(documentType);

      const response = await openai.responses.create({
        model: 'gpt-4.1',
        instructions: template,
        input: [
          {
            role: 'user',
            type: 'message',
            content: [
              {
                type: 'input_text',
                text:
                  'Use the provided instructions and this document (in Markdown) to produce the requested JSON metadata.\n\n' +
                  markdown,
              },
            ],
          },
        ],
        text: {
          format: { type: 'json_object' },
        },
      });

      const rawText =
        ((response as any).output?.[0]?.content?.[0]?.text as string | undefined) ??
        ((response as any).output_text as string | undefined);

      if (!rawText) {
        console.warn('Metadata extraction (markdown): no text output from model');
        return null;
      }

      const parsed = JSON.parse(rawText) as DocumentMetadata;

      if (!parsed.document_type) {
        parsed.document_type = documentType;
      }
      if (!parsed.file_name) {
        parsed.file_name = fileName;
      }

      logOpenAI('extractMetadata:markdown:success', {
        documentType,
        fileName,
        attempt,
      });

      return parsed;
    } catch (error) {
      const status = (error as any)?.status;
      logOpenAI('extractMetadata:markdown:error', {
        documentType,
        fileName,
        attempt,
        status,
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : error,
      });

      if (status === 429) {
        console.error(
          '[OpenAI rate limit] extractMetadataFromMarkdown received 429 for',
          fileName,
          'documentType=',
          documentType,
        );
      }

      if (status === 429 && attempt < maxAttempts) {
        const delay = baseDelayMs * attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      console.error('Metadata extraction from markdown failed:', error);
      return null;
    }
  }

  return null;
}
async function extractMarkdown(
  fileId: string,
  fileName: string,
): Promise<string | null> {
  try {
    logOpenAI('extractMarkdown:start', {
      fileId,
      fileName,
    });

    const instructions =
      'You are a medical document transcription assistant. ' +
      'Convert the attached document into clean, readable Markdown. ' +
      'Preserve headings, lists, and tables where possible. ' +
      'Do NOT summarize or omit sections; include all legible text content. ' +
      'Output ONLY the Markdown, with no extra commentary.';

    const response = await openai.responses.create({
      model: 'gpt-4.1',
      instructions,
      input: [
        {
          role: 'user',
          type: 'message',
          content: [
            {
              type: 'input_text',
              text:
                'Transcribe this document into Markdown as described. ' +
                'If any portions are illegible, mark them as [[illegible]] rather than guessing.',
            },
            {
              type: 'input_file',
              file_id: fileId,
            },
          ],
        },
      ],
    });

    const rawText =
      ((response as any).output?.[0]?.content?.[0]?.text as
        string | undefined) ??
      ((response as any).output_text as string | undefined);

    if (!rawText) {
      logOpenAI('extractMarkdown:error', {
        fileId,
        fileName,
        error: { message: 'No text output from markdown extraction model' },
      });
      return null;
    }

    // Normalize common model behavior of wrapping Markdown in ``` fences.
    let text = rawText.trim();
    if (text.startsWith('```')) {
      // Strip leading fence with optional language (e.g., ```markdown).
      const firstNewline = text.indexOf('\n');
      if (firstNewline !== -1) {
        const fenceLine = text.slice(0, firstNewline).trim();
        if (fenceLine === '```' || fenceLine.toLowerCase() === '```markdown') {
          const lastFence = text.lastIndexOf('```');
          if (lastFence > firstNewline) {
            text = text.slice(firstNewline + 1, lastFence).trim();
          }
        }
      }
    }

    logOpenAI('extractMarkdown:success', {
      fileId,
      fileName,
      length: text.length,
    });

    return text;
  } catch (error) {
    const status = (error as any)?.status;
    logOpenAI('extractMarkdown:error', {
      status,
      fileId,
      fileName,
      error:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : error,
    });

    if (status === 429) {
      console.error(
        '[OpenAI rate limit] extractMarkdown received 429 for',
        fileName,
      );
    }

    return null;
  }
}

interface ClassificationResult {
  predictedType: DocumentType | 'unclassified' | null;
  confidence: number | null;
  rawLabel?: string;
}

type HighLevelType =
  | 'clinical_encounter'
  | 'communication'
  | 'result'
  | 'referral'
  | 'administrative'
  | 'external_record';

interface HighLevelClassificationResult {
  type: HighLevelType;
  confidence: number | null;
}

type ModuleName =
  | 'provider'
  | 'patient'
  | 'reason_for_encounter'
  | 'vitals'
  | 'smoking'
  | 'sexual_health'
  | 'mental_health'
  | 'referral'
  | 'results'
  | 'communication';

interface ModuleSelectionResult {
  modules: ModuleName[];
}

interface TaxonomySubkeywordMatch {
  subkeyword_id?: string | null;
  new_subkeyword?: {
    label?: string | null;
    synonyms?: string[] | null;
  } | null;
  subkeyword_evidence?: string | null;
}

interface TaxonomyKeywordMatch {
  keyword_id?: string | null;
  new_keyword?: {
    label?: string | null;
    synonyms?: string[] | null;
  } | null;
  keyword_evidence?: string | null;
  subkeyword_matches?: TaxonomySubkeywordMatch[] | null;
}

interface TaxonomyExtractionResult {
  category_id?: string;
  keyword_matches?: TaxonomyKeywordMatch[] | null;
}

let activeMetadataJobs = 0;
const metadataJobQueue: Array<() => void> = [];

function slugifyLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export async function runTaxonomyExtractionForDocument(
  documentId: number,
  markdown: string | null,
  fileName: string,
  categoryFilterId?: string,
): Promise<void> {
  try {
    if (!markdown || markdown.trim().length === 0) {
      return;
    }

    const taxonomy = await loadTaxonomy({ includeReview: true });
    if (!taxonomy.categories || taxonomy.categories.length === 0) {
      return;
    }

    const categoriesOverview = taxonomy.categories.map((c) => c.label);

    for (const category of taxonomy.categories) {
      if (categoryFilterId && category.id !== categoryFilterId) {
        continue;
      }
      try {
        const systemPrompt =
          'You are a medical-legal taxonomy assistant. ' +
          'You are given a fixed list of high-level categories, and for ONE selected category you see its existing keywords and subkeywords. ' +
          'Your job is to decide which existing keywords/subkeywords apply to the document and to optionally propose NEW keywords/subkeywords with synonyms. ' +
          'You MUST NOT modify or delete existing taxonomy entries; only add. ' +
          "Be conservative and avoid creating redundant concepts. Respond ONLY with valid JSON that matches the expected shape.";

        const userPrompt =
          'CATEGORIES (fixed list, for reference only):\n' +
          JSON.stringify(categoriesOverview) +
          '\n\n' +
          'SELECTED CATEGORY CONTEXT (JSON):\n' +
          JSON.stringify({
            id: category.id,
            label: category.label,
            keywords: category.keywords.map((kw) => ({
              id: kw.id,
              label: kw.label,
              synonyms: kw.synonyms,
              subkeywords: kw.subkeywords.map((sk) => ({
                id: sk.id,
                label: sk.label,
                synonyms: sk.synonyms,
              })),
            })),
          }) +
          '\n\n' +
          'TASK:\n' +
          `1) Identify concepts in the attached document that belong under the "${category.label}" category.\n` +
          '2) For each concept, decide:\n' +
          '   - Does it match an existing keyword (or its synonyms)? If yes, reference it by keyword_id.\n' +
          '   - If not, should a NEW keyword be created? If yes, provide new_keyword.label and new_keyword.synonyms.\n' +
          '3) For each keyword (existing or new) that applies:\n' +
          '   - Choose any applicable existing subkeywords.\n' +
          '   - Optionally define new subkeywords with label and synonyms.\n' +
          '4) For each keyword and subkeyword you include, provide a short evidence string quoting or closely paraphrasing the specific text that supports this classification. Use the fields keyword_evidence and subkeyword_evidence.\n\n' +
          'IMPORTANT CONSTRAINTS:\n' +
          '- Do NOT invent new categories.\n' +
          '- A given synonym string should belong to at most one keyword across the taxonomy.\n' +
          '- Subkeywords under the same keyword should not share synonyms.\n' +
          '- Be conservative; avoid unnecessary new items.\n\n' +
          'OUTPUT JSON SHAPE:\n' +
          '{\n' +
          '  "category_id": string,\n' +
          '  "keyword_matches": [\n' +
          '    {\n' +
          '      "keyword_id": string | null,\n' +
          '      "new_keyword": { "label": string | null, "synonyms": string[] } | null,\n' +
          '      "keyword_evidence": string | null,\n' +
          '      "subkeyword_matches": [\n' +
          '        {\n' +
          '          "subkeyword_id": string | null,\n' +
          '          "new_subkeyword": { "label": string | null, "synonyms": string[] } | null,\n' +
          '          "subkeyword_evidence": string | null\n' +
          '        }\n' +
          '      ]\n' +
          '    }\n' +
          '  ]\n' +
          '}\n';

        logOpenAI('taxonomy:extract:start', {
          categoryId: category.id,
          fileName,
          documentId,
        });

        const response = await openai.responses.create({
          model: 'gpt-4.1-mini',
          instructions: systemPrompt,
          input: [
            {
              role: 'user',
              type: 'message',
              content: [
                {
                  type: 'input_text',
                  text:
                    userPrompt +
                    '\n\nDOCUMENT (Markdown):\n\n' +
                    markdown,
                },
              ],
            },
          ],
          text: {
            format: { type: 'json_object' },
          },
        });

        const rawText =
          ((response as any).output?.[0]?.content?.[0]?.text as
            string | undefined) ??
          ((response as any).output_text as string | undefined);

        if (!rawText) {
          logOpenAI('taxonomy:extract:error', {
            categoryId: category.id,
            fileName,
            documentId,
            error: { message: 'No text output from taxonomy model' },
          });
          continue;
        }

        let parsed: TaxonomyExtractionResult;
        try {
          parsed = JSON.parse(rawText) as TaxonomyExtractionResult;
        } catch (err) {
          logOpenAI('taxonomy:extract:error', {
            categoryId: category.id,
            fileName,
            documentId,
            error: {
              message: 'Failed to parse taxonomy JSON',
              rawText: rawText.slice(0, 500),
            },
          });
          continue;
        }

        if (parsed.category_id && parsed.category_id !== category.id) {
          // Ignore mismatched category responses.
          continue;
        }

        const matches = parsed.keyword_matches ?? [];
        if (!Array.isArray(matches) || matches.length === 0) {
          continue;
        }

        const db = await getDb();

        for (const match of matches) {
          let keywordId = (match.keyword_id ?? '').trim() || null;
          const keywordEvidenceRaw = (match as any).keyword_evidence;
          const keywordEvidence =
            typeof keywordEvidenceRaw === 'string'
              ? keywordEvidenceRaw.trim()
              : '';

          if (!keywordId && match.new_keyword) {
            const label = (match.new_keyword.label ?? '').trim();
            if (label) {
              const slug = slugifyLabel(label);
              keywordId = `${category.id}.${slug}`;

              const synonyms =
                Array.isArray(match.new_keyword.synonyms) &&
                match.new_keyword.synonyms.length > 0
                  ? match.new_keyword.synonyms
                  : [label];

              await insertKeyword({
                categoryId: category.id,
                id: keywordId,
                label,
                synonyms,
                status: 'review',
                connection: db,
              });
            }
          }

          // If the model referenced a keyword_id that does not yet exist and did not
          // provide new_keyword metadata, create a placeholder keyword so that any
          // new subkeywords can attach without violating foreign key constraints.
          if (keywordId && !match.new_keyword) {
            const existing = category.keywords.find((kw) => kw.id === keywordId);
            if (!existing) {
              const derivedLabelPart = keywordId.includes('.')
                ? keywordId.split('.').slice(1).join('.')
                : keywordId;
              const derivedLabel = derivedLabelPart.replace(/_/g, ' ');

              await insertKeyword({
                categoryId: category.id,
                id: keywordId,
                label: derivedLabel,
                synonyms: [derivedLabel],
                status: 'review',
                connection: db,
              });
            }
          }

          if (!keywordId) {
            continue;
          }

          // Link the document to the keyword.
          await insertDocumentTerm({
            documentId,
            keywordId,
            subkeywordId: null,
            connection: db,
          });

          if (keywordEvidence) {
            await insertDocumentTermEvidence({
              connection: db,
              documentId,
              keywordId,
              subkeywordId: null,
              evidenceType: 'snippet',
              evidenceText: keywordEvidence,
            });
          }

          const subMatches = match.subkeyword_matches ?? [];
          if (!Array.isArray(subMatches) || subMatches.length === 0) {
            continue;
          }

          for (const sm of subMatches) {
            let subkeywordId = (sm.subkeyword_id ?? '').trim() || null;
            const subEvidenceRaw = (sm as any).subkeyword_evidence;
            const subEvidence =
              typeof subEvidenceRaw === 'string' ? subEvidenceRaw.trim() : '';

            if (!subkeywordId && sm.new_subkeyword) {
              const skLabel = (sm.new_subkeyword.label ?? '').trim();
              if (skLabel) {
                const skSlug = slugifyLabel(skLabel);
                subkeywordId = `${keywordId}.${skSlug}`;

                const skSynonyms =
                  Array.isArray(sm.new_subkeyword.synonyms) &&
                  sm.new_subkeyword.synonyms.length > 0
                    ? sm.new_subkeyword.synonyms
                    : [skLabel];

                await insertSubkeyword({
                  keywordId,
                  id: subkeywordId,
                  label: skLabel,
                  synonyms: skSynonyms,
                  status: 'review',
                  connection: db,
                });
              }
            }

            if (!subkeywordId) {
              continue;
            }

            await insertDocumentTerm({
              documentId,
              keywordId,
              subkeywordId,
              connection: db,
            });

            if (subEvidence) {
              await insertDocumentTermEvidence({
                connection: db,
                documentId,
                keywordId,
                subkeywordId,
                evidenceType: 'snippet',
                evidenceText: subEvidence,
              });
            }
          }
        }

        logOpenAI('taxonomy:extract:success', {
          categoryId: category.id,
          fileName,
          documentId,
        });
      } catch (err) {
        logOpenAI('taxonomy:extract:error', {
          categoryId: category.id,
          fileName,
          documentId,
          error:
            err instanceof Error
              ? { message: err.message, stack: err.stack }
              : err,
        });
      }
    }
  } catch (error) {
    logOpenAI('taxonomy:extract:error', {
      fileName,
      documentId,
      error:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : error,
    });
  }
}

async function runWithMetadataConcurrency<T>(fn: () => Promise<T>): Promise<T> {
  const limit =
    config.metadataMaxConcurrency && config.metadataMaxConcurrency > 0
      ? config.metadataMaxConcurrency
      : 1;

  if (limit <= 1) {
    return fn();
  }

  return new Promise<T>((resolve, reject) => {
    const run = async () => {
      activeMetadataJobs += 1;
      try {
        const result = await fn();
        resolve(result);
      } catch (err) {
        reject(err);
      } finally {
        activeMetadataJobs -= 1;
        const next = metadataJobQueue.shift();
        if (next) {
          next();
        }
      }
    };

    if (activeMetadataJobs < limit) {
      void run();
    } else {
      metadataJobQueue.push(run);
    }
  });
}

async function classifyDocumentFromMarkdown(
  markdown: string,
  fileName: string,
): Promise<ClassificationResult | null> {
  try {
    logOpenAI('classify:markdown:start', {
      fileName,
    });

    const template = await loadClassificationTemplate();

    const response = await openai.responses.create({
      model: 'gpt-4.1-mini',
      instructions: template,
      input: [
        {
          role: 'user',
          type: 'message',
          content: [
            {
              type: 'input_text',
              text:
                'Classify this document according to the provided schema and respond only with JSON that matches the specified JSON output format.\n\n' +
                markdown,
            },
          ],
        },
      ],
      text: {
        format: { type: 'json_object' },
      },
    });

    const rawText =
      ((response as any).output?.[0]?.content?.[0]?.text as string | undefined) ??
      ((response as any).output_text as string | undefined);

    if (!rawText) {
      logOpenAI('classify:markdown:error', {
        fileName,
        error: { message: 'No text output from classification model' },
      });
      return null;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch (err) {
      logOpenAI('classify:markdown:error', {
        fileName,
        error: {
          message: 'Failed to parse classification JSON',
          rawText: rawText.slice(0, 500),
        },
      });
      return null;
    }

    const predictedTypeRaw =
      typeof parsed.predicted_type === 'string' ? parsed.predicted_type : '';
    const confidenceRaw = parsed.confidence;
    const rawLabel =
      typeof parsed.raw_label === 'string' ? parsed.raw_label : undefined;

    let confidence: number | null = null;
    if (typeof confidenceRaw === 'number') {
      confidence = confidenceRaw;
    } else if (typeof confidenceRaw === 'string') {
      const num = Number(confidenceRaw);
      confidence = Number.isFinite(num) ? num : null;
    }

    let predictedType: DocumentType | 'unclassified' | null = null;
    if (predictedTypeRaw === 'unclassified') {
      predictedType = 'unclassified';
    } else if (isValidDocumentType(predictedTypeRaw)) {
      predictedType = predictedTypeRaw;
    } else {
      predictedType = null;
    }

    logOpenAI('classify:markdown:success', {
      fileName,
      predictedType,
      confidence,
      rawLabel,
    });

    return {
      predictedType,
      confidence,
      rawLabel,
    };
  } catch (error) {
    logOpenAI('classify:markdown:error', {
      fileName,
      error:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : error,
    });

    const status = (error as any)?.status;
    if (status === 429) {
      console.error(
        '[OpenAI rate limit] classifyDocumentFromMarkdown received 429 for',
        fileName,
      );
    }
    return null;
  }
}

async function runSelectedModulesForMarkdown(
  markdown: string,
  fileName: string,
  selection: ModuleSelectionResult | null,
): Promise<Record<string, any>> {
  const results: Record<string, any> = {};

  if (!selection || !Array.isArray(selection.modules) || selection.modules.length === 0) {
    return results;
  }

  for (const moduleName of selection.modules) {
    try {
      logOpenAI('moduleExtract:markdown:start', {
        fileName,
        module: moduleName,
      });

      const template = await loadModuleTemplate(moduleName);

      const response = await openai.responses.create({
        model: 'gpt-4.1',
        instructions: template,
        input: [
          {
            role: 'user',
            type: 'message',
            content: [
              {
                type: 'input_text',
                text:
                  'Extract this module according to the instructions from the following document (in Markdown) and output strict JSON only.\n\n' +
                  markdown,
              },
            ],
          },
        ],
        text: {
          format: { type: 'json_object' },
        },
      });

      const rawText =
        ((response as any).output?.[0]?.content?.[0]?.text as string | undefined) ??
        ((response as any).output_text as string | undefined);

      if (!rawText) {
        logOpenAI('moduleExtract:markdown:error', {
          fileName,
          module: moduleName,
          error: { message: 'No text output from module extraction model' },
        });
        continue;
      }

      let parsed: any;
      try {
        parsed = JSON.parse(rawText);
      } catch (err) {
        logOpenAI('moduleExtract:markdown:error', {
          fileName,
          module: moduleName,
          error: {
            message: 'Failed to parse module extraction JSON',
            rawText: rawText.slice(0, 500),
          },
        });
        continue;
      }

      results[moduleName] = parsed;

      logOpenAI('moduleExtract:markdown:success', {
        fileName,
        module: moduleName,
      });
    } catch (error) {
      logOpenAI('moduleExtract:markdown:error', {
        status: (error as any)?.status,
        fileName,
        module: moduleName,
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : error,
      });
      const status = (error as any)?.status;
      if (status === 429) {
        console.error(
          '[OpenAI rate limit] moduleExtractFromMarkdown received 429 for',
          fileName,
          'module=',
          moduleName,
        );
      }
    }
  }

  return results;
}

async function classifyHighLevelDocumentFromMarkdown(
  markdown: string,
  fileName: string,
): Promise<HighLevelClassificationResult | null> {
  try {
    logOpenAI('highLevelClassify:markdown:start', {
      fileName,
    });

    const template = await loadHighLevelClassificationTemplate();

    const response = await openai.responses.create({
      model: 'gpt-4.1-mini',
      instructions: template,
      input: [
        {
          role: 'user',
          type: 'message',
          content: [
            {
              type: 'input_text',
              text:
                'Classify this document at a high level according to the provided schema and respond only with JSON that matches the specified JSON output format.\n\n' +
                markdown,
            },
          ],
        },
      ],
      text: {
        format: { type: 'json_object' },
      },
    });

    const rawText =
      ((response as any).output?.[0]?.content?.[0]?.text as string | undefined) ??
      ((response as any).output_text as string | undefined);

    if (!rawText) {
      logOpenAI('highLevelClassify:markdown:error', {
        fileName,
        error: {
          message: 'No text output from high-level classification model',
        },
      });
      return null;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch (err) {
      logOpenAI('highLevelClassify:markdown:error', {
        fileName,
        error: {
          message: 'Failed to parse high-level classification JSON',
          rawText: rawText.slice(0, 500),
        },
      });
      return null;
    }

    const typeRaw = typeof parsed.type === 'string' ? parsed.type : '';
    const allowedTypes: HighLevelType[] = [
      'clinical_encounter',
      'communication',
      'result',
      'referral',
      'administrative',
      'external_record',
    ];

    const type = allowedTypes.includes(typeRaw as HighLevelType)
      ? (typeRaw as HighLevelType)
      : null;

    if (!type) {
      logOpenAI('highLevelClassify:markdown:error', {
        fileName,
        error: {
          message: 'High-level classification returned invalid type',
          rawType: typeRaw,
        },
      });
      return null;
    }

    const confidenceRaw = parsed.confidence;
    let confidence: number | null = null;
    if (typeof confidenceRaw === 'number') {
      confidence = confidenceRaw;
    } else if (typeof confidenceRaw === 'string') {
      const num = Number(confidenceRaw);
      confidence = Number.isFinite(num) ? num : null;
    }

    logOpenAI('highLevelClassify:markdown:success', {
      fileName,
      type,
      confidence,
    });

    return { type, confidence };
  } catch (error) {
    logOpenAI('highLevelClassify:markdown:error', {
      fileName,
      error:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : error,
    });
    const status = (error as any)?.status;
    if (status === 429) {
      console.error(
        '[OpenAI rate limit] highLevelClassifyFromMarkdown received 429 for',
        fileName,
      );
    }
    return null;
  }
}

async function selectModulesForMarkdown(
  markdown: string,
  fileName: string,
  highLevelType: HighLevelType | null,
): Promise<ModuleSelectionResult | null> {
  try {
    logOpenAI('moduleSelection:markdown:start', {
      fileName,
      highLevelType,
    });

    const template = await loadModuleSelectionTemplate();

    const documentTypeHint =
      highLevelType && typeof highLevelType === 'string'
        ? highLevelType
        : 'unknown';

    const response = await openai.responses.create({
      model: 'gpt-4.1-mini',
      instructions: template,
      input: [
        {
          role: 'user',
          type: 'message',
          content: [
            {
              type: 'input_text',
              text:
                `The high-level document.type from a previous step is "${documentTypeHint}". ` +
                'Use it only as a hint; it may be incorrect. Based on this and the document text (in Markdown) below, select all applicable modules and respond ONLY with valid JSON matching the specified JSON output format.\n\n' +
                markdown,
            },
          ],
        },
      ],
      text: {
        format: { type: 'json_object' },
      },
    });

    const rawText =
      ((response as any).output?.[0]?.content?.[0]?.text as string | undefined) ??
      ((response as any).output_text as string | undefined);

    if (!rawText) {
      logOpenAI('moduleSelection:markdown:error', {
        fileName,
        error: { message: 'No text output from module selection model' },
      });
      return null;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch (err) {
      logOpenAI('moduleSelection:markdown:error', {
        fileName,
        error: {
          message: 'Failed to parse module selection JSON',
          rawText: rawText.slice(0, 500),
        },
      });
      return null;
    }

    const rawModules = Array.isArray(parsed.modules) ? parsed.modules : [];
    const allowed: ModuleName[] = [
      'provider',
      'patient',
      'reason_for_encounter',
      'vitals',
      'smoking',
      'sexual_health',
      'mental_health',
      'referral',
      'results',
      'communication',
    ];

    const modules: ModuleName[] = rawModules
      .map((m: any) => (typeof m === 'string' ? m.trim() : ''))
      .filter((m: string) => allowed.includes(m as ModuleName)) as ModuleName[];

    logOpenAI('moduleSelection:markdown:success', {
      fileName,
      highLevelType,
      modules,
    });

    return { modules };
  } catch (error) {
    logOpenAI('moduleSelection:markdown:error', {
      status: (error as any)?.status,
      fileName,
      highLevelType,
      error:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : error,
    });
    const status = (error as any)?.status;
    if (status === 429) {
      console.error(
        '[OpenAI rate limit] moduleSelectionFromMarkdown received 429 for',
        fileName,
      );
    }
    return null;
  }
}

async function waitForVectorStoreFileReady(
  vectorStoreFileId: string,
  maxAttempts = 5,
  delayMs = 1000,
): Promise<boolean> {
  let lastFileName: string | undefined;

  if (!config.vectorStoreId) {
    return false;
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const file = await openai.vectorStores.files.retrieve(vectorStoreFileId, {
        vector_store_id: config.vectorStoreId,
      });

      const attributes = (file.attributes ?? {}) as {
        [key: string]: string | number | boolean;
      };
      if (typeof attributes.file_name === 'string') {
        lastFileName = attributes.file_name;
      }

      if (file.status === 'completed') {
        return true;
      }

      if (file.status === 'failed' || file.status === 'cancelled') {
        logOpenAI('vectorStoreFile:not_ready', {
          vectorStoreFileId,
          status: file.status,
          fileName: lastFileName,
        });
        return false;
      }
    } catch (error) {
      logOpenAI('vectorStoreFile:poll_error', {
        vectorStoreFileId,
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : error,
      });
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  logOpenAI('vectorStoreFile:not_ready_timeout', {
    vectorStoreFileId,
    fileName: lastFileName,
    attempts: maxAttempts,
  });

  return false;
}

// POST /api/documents
// - Accepts a single PDF file and a document_type field.
// - Uploads the file to OpenAI Files.
// - Adds it to the configured vector store with minimal metadata.
router.post(
  '/',
  requireAuth,
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      if (!config.vectorStoreId) {
        res.status(500).json({ error: 'ARGUS_VECTOR_STORE_ID not configured' });
        return;
      }

      if (!req.file) {
        res.status(400).json({ error: 'Missing file field "file"' });
        return;
      }

      const asyncFlag = String((req.query as any).async ?? '').toLowerCase();
      const asyncMode = asyncFlag === '1' || asyncFlag === 'true';

      const { originalname, buffer } = req.file;
      const { document_type } = req.body as { document_type?: string };

      let effectiveDocumentType: DocumentType;
      if (!document_type || document_type.trim() === '') {
        effectiveDocumentType = 'unclassified';
      } else if (!isValidDocumentType(document_type)) {
        res.status(400).json({
          error: 'Invalid document_type',
          allowed: DOCUMENT_TYPES,
        });
        return;
      } else {
        effectiveDocumentType = document_type as DocumentType;
      }

      // 1) Upload raw file to OpenAI Files
      const file = await openai.files.create({
        file: await toFile(buffer, originalname),
        purpose: 'assistants',
      });

      const attributes: { [key: string]: string | number | boolean } = {
        document_type: effectiveDocumentType,
        file_name: originalname,
        file_id: file.id,
        is_active: true,
      };
      let s3Key: string | null = null;

      // Best-effort upload of a PDF copy to S3 for browser viewing.
      try {
        s3Key = await uploadPdfToS3(file.id, buffer, originalname);
        attributes.s3_key = s3Key;
      } catch (err) {
        console.warn('Failed to upload PDF to S3', err);
      }

      let metadata: DocumentMetadata | null = null;
      let highLevelClassification: HighLevelClassificationResult | null = null;
      let moduleSelection: ModuleSelectionResult | null = null;
      let moduleOutputs: Record<string, any> = {};
      let markdown: string | null = null;

      // 1b) Extract a full-text Markdown transcription of the document.
      try {
        markdown = await extractMarkdown(file.id, originalname);
      } catch (err) {
        console.error('Markdown extraction failed:', err);
      }

      if (!asyncMode && markdown && markdown.trim().length > 0) {
        // 2) Extract structured metadata using the templates and Markdown (synchronous path).
        metadata = await extractMetadataFromMarkdown(
          effectiveDocumentType,
          markdown,
          originalname,
        );

        if (metadata) {
          if (metadata.date) attributes.date = metadata.date;
          if (metadata.provider_name) {
            attributes.provider_name = metadata.provider_name;
          }
          if (metadata.clinic_or_facility) {
            attributes.clinic_or_facility = metadata.clinic_or_facility;
          }
          attributes.has_metadata = true;

          highLevelClassification = await classifyHighLevelDocumentFromMarkdown(
            markdown,
            originalname,
          );
          moduleSelection = await selectModulesForMarkdown(
            markdown,
            originalname,
            highLevelClassification ? highLevelClassification.type : null,
          );

          if (moduleSelection) {
            moduleOutputs = await runSelectedModulesForMarkdown(
              markdown,
              originalname,
              moduleSelection,
            );
          }
        }
      }

      // 3) Attach to vector store with attributes (including underlying file_id)
      const vectorStoreFile = await openai.vectorStores.files.create(
        config.vectorStoreId,
        {
          file_id: file.id,
          attributes,
        },
      );

      // 4) Persist metadata snapshot into MariaDB (including Markdown, when available).
      let documentDbId: number | null = null;
      try {
        const db = await getDb();
        const dateValue =
          metadata && metadata.date ? metadata.date.slice(0, 10) : null;

        const metadataPayload: any = metadata ?? {};
        if (highLevelClassification) {
          metadataPayload.high_level_classification = highLevelClassification;
        }
        if (moduleSelection) {
          metadataPayload.modules_selected = moduleSelection;
        }
        if (moduleOutputs && Object.keys(moduleOutputs).length > 0) {
          metadataPayload.modules = moduleOutputs;
        }

        const [result] = (await db.query(
          `
          INSERT INTO documents (
            vector_store_file_id,
            openai_file_id,
            s3_key,
            filename,
            document_type,
            date,
            provider_name,
            clinic_or_facility,
            is_active,
            needs_metadata,
            metadata_json,
            markdown
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          [
            vectorStoreFile.id,
            file.id,
            s3Key,
            originalname,
            effectiveDocumentType,
            dateValue,
            metadata ? metadata.provider_name : null,
            metadata ? metadata.clinic_or_facility : null,
            1,
            metadata ? 0 : 1,
            JSON.stringify(metadataPayload),
            markdown,
          ],
        )) as any[];

        if (result && typeof result.insertId === 'number') {
          documentDbId = result.insertId as number;
        }
      } catch (err) {
        console.error('Failed to persist document metadata to DB:', err);
      }

      if (documentDbId !== null) {
        await runTaxonomyExtractionForDocument(
          documentDbId,
          markdown,
          originalname,
        );
      }

      // For async uploads, kick off background classification / metadata work.
      if (asyncMode) {
        (async () => {
          try {
            await runWithMetadataConcurrency(async () => {
              const markdownText = (markdown ?? '').trim();

              if (!markdownText) {
                logOpenAI('backgroundMetadata:skip', {
                  reason: 'no_markdown_available',
                  fileId: file.id,
                  fileName: originalname,
                  vectorStoreFileId: vectorStoreFile.id,
                });
                return;
              }

            // If a specific document type was provided, skip classification and
            // run background metadata extraction as before.
            if (effectiveDocumentType !== 'unclassified') {
              logOpenAI('backgroundMetadata:start', {
                documentType: effectiveDocumentType,
                fileId: file.id,
                fileName: originalname,
                vectorStoreFileId: vectorStoreFile.id,
              });

              const bgMetadata = await extractMetadataFromMarkdown(
                effectiveDocumentType,
                markdownText,
                originalname,
              );

              if (!bgMetadata) {
                logOpenAI('backgroundMetadata:skip', {
                  reason: 'extractMetadata returned null',
                  documentType: effectiveDocumentType,
                  fileId: file.id,
                  fileName: originalname,
                  vectorStoreFileId: vectorStoreFile.id,
                });
                return;
              }

              const highLevelClassification =
                await classifyHighLevelDocumentFromMarkdown(
                  markdownText,
                  originalname,
                );
              const moduleSelection = await selectModulesForMarkdown(
                markdownText,
                originalname,
                highLevelClassification ? highLevelClassification.type : null,
              );

              let moduleOutputs: Record<string, any> = {};
              if (moduleSelection) {
                moduleOutputs = await runSelectedModulesForMarkdown(
                  markdownText,
                  originalname,
                  moduleSelection,
                );
              }

              const updatedAttributes: {
                [key: string]: string | number | boolean;
              } = {
                ...attributes,
              };

              if (bgMetadata.date) {
                updatedAttributes.date = bgMetadata.date;
              }
              if (bgMetadata.provider_name) {
                updatedAttributes.provider_name = bgMetadata.provider_name;
              }
              if (bgMetadata.clinic_or_facility) {
                updatedAttributes.clinic_or_facility =
                  bgMetadata.clinic_or_facility;
              }
              updatedAttributes.has_metadata = true;

              if (config.vectorStoreId) {
                try {
                  const ready = await waitForVectorStoreFileReady(
                    vectorStoreFile.id,
                  );
                  if (ready) {
                    await openai.vectorStores.files.update(vectorStoreFile.id, {
                      vector_store_id: config.vectorStoreId,
                      attributes: updatedAttributes,
                    });
                  } else {
                    logOpenAI('backgroundMetadata:vs_not_ready', {
                      fileName: originalname,
                      vectorStoreFileId: vectorStoreFile.id,
                    });
                  }
                } catch (err) {
                  logOpenAI('backgroundMetadata:attributes_error', {
                    error:
                      err instanceof Error
                        ? { message: err.message, stack: err.stack }
                        : err,
                    fileName: originalname,
                    vectorStoreFileId: vectorStoreFile.id,
                  });
                }
              }

              try {
                const db = await getDb();
                const dateValue = bgMetadata.date
                  ? bgMetadata.date.slice(0, 10)
                  : null;

                const metadataPayload: any = bgMetadata;
                if (highLevelClassification) {
                  metadataPayload.high_level_classification =
                    highLevelClassification;
                }
                if (moduleSelection) {
                  metadataPayload.modules_selected = moduleSelection;
                }
                if (moduleOutputs && Object.keys(moduleOutputs).length > 0) {
                  metadataPayload.modules = moduleOutputs;
                }

                await db.query(
                  `
                  UPDATE documents
                  SET
                    date = ?,
                    provider_name = ?,
                    clinic_or_facility = ?,
                    metadata_json = ?,
                    needs_metadata = 0
                  WHERE vector_store_file_id = ?
                `,
                  [
                    dateValue,
                    bgMetadata.provider_name ?? null,
                    bgMetadata.clinic_or_facility ?? null,
                    JSON.stringify(metadataPayload),
                    vectorStoreFile.id,
                  ],
                );
                await updateDocumentProjectionsForVectorStoreFile(
                  vectorStoreFile.id,
                  bgMetadata,
                );
              } catch (err) {
                console.error(
                  'Failed to persist background metadata to DB:',
                  err,
                );
                logOpenAI('backgroundMetadata:db_error', {
                  error:
                    err instanceof Error
                      ? { message: err.message, stack: err.stack }
                      : err,
                  fileName: originalname,
                  vectorStoreFileId: vectorStoreFile.id,
                });
              }

              logOpenAI('backgroundMetadata:success', {
                documentType: effectiveDocumentType,
                fileId: file.id,
                fileName: originalname,
                vectorStoreFileId: vectorStoreFile.id,
              });

              return;
            }

            // For unclassified uploads, run classification only (no automatic metadata).
            logOpenAI('classify:background:start', {
              fileId: file.id,
              fileName: originalname,
              vectorStoreFileId: vectorStoreFile.id,
            });

            const classification = await classifyDocumentFromMarkdown(
              markdownText,
              originalname,
            );
            if (!classification) {
              logOpenAI('classify:background:skip', {
                reason: 'classification returned null',
                fileId: file.id,
                fileName: originalname,
                vectorStoreFileId: vectorStoreFile.id,
              });
              return;
            }

            const { predictedType, confidence } = classification;
            const threshold = config.classifyConfidenceThreshold || 0.85;

            if (
              !predictedType ||
              predictedType === 'unclassified' ||
              confidence === null ||
              confidence < threshold
            ) {
              logOpenAI('classify:background:low_confidence', {
                predictedType,
                confidence,
                threshold,
                fileId: file.id,
                fileName: originalname,
                vectorStoreFileId: vectorStoreFile.id,
              });
              return;
            }

            const updatedAttributes: {
              [key: string]: string | number | boolean;
            } = {
              ...attributes,
              document_type: predictedType,
            };

            if (config.vectorStoreId) {
              try {
                const ready = await waitForVectorStoreFileReady(
                  vectorStoreFile.id,
                );
                if (ready) {
                  await openai.vectorStores.files.update(vectorStoreFile.id, {
                    vector_store_id: config.vectorStoreId,
                    attributes: updatedAttributes,
                  });
                } else {
                  logOpenAI('classify:background:vs_not_ready', {
                    fileName: originalname,
                    vectorStoreFileId: vectorStoreFile.id,
                  });
                }
              } catch (err) {
                logOpenAI('classify:background:attributes_error', {
                  error:
                    err instanceof Error
                      ? { message: err.message, stack: err.stack }
                      : err,
                  fileName: originalname,
                  vectorStoreFileId: vectorStoreFile.id,
                });
              }
            }

              try {
                const db = await getDb();
              await db.query(
                `
                UPDATE documents
                SET document_type = ?
                WHERE vector_store_file_id = ?
              `,
                [predictedType, vectorStoreFile.id],
              );
            } catch (err) {
              console.error('Failed to update classified document_type in DB:', err);
              logOpenAI('classify:background:db_error', {
                error:
                  err instanceof Error
                    ? { message: err.message, stack: err.stack }
                    : err,
                fileName: originalname,
                vectorStoreFileId: vectorStoreFile.id,
              });
            }

            logOpenAI('classify:background:success', {
              predictedType,
              confidence,
              fileId: file.id,
              fileName: originalname,
              vectorStoreFileId: vectorStoreFile.id,
            });

            // Optionally run automatic metadata extraction after successful classification.
            if (!config.autoMetadataAfterClassify) {
              return;
            }

            const classifiedType = predictedType as DocumentType;

            logOpenAI('backgroundMetadata:after_classify:enter', {
              documentType: classifiedType,
              fileId: file.id,
              fileName: originalname,
              vectorStoreFileId: vectorStoreFile.id,
            });

            logOpenAI('backgroundMetadata:after_classify:start', {
              documentType: classifiedType,
              fileId: file.id,
              fileName: originalname,
              vectorStoreFileId: vectorStoreFile.id,
            });

            logOpenAI('backgroundMetadata:after_classify:before_extract', {
              documentType: classifiedType,
              fileId: file.id,
              fileName: originalname,
              vectorStoreFileId: vectorStoreFile.id,
            });

            const autoMetadata = await extractMetadataFromMarkdown(
              classifiedType,
              markdownText,
              originalname,
            );

            if (!autoMetadata) {
              logOpenAI('backgroundMetadata:after_classify:skip', {
                reason: 'extractMetadata returned null',
                documentType: classifiedType,
                fileId: file.id,
                fileName: originalname,
                vectorStoreFileId: vectorStoreFile.id,
              });
              return;
            }

            const highLevelClassification =
              await classifyHighLevelDocumentFromMarkdown(
                markdownText,
                originalname,
              );
            const moduleSelection = await selectModulesForMarkdown(
              markdownText,
              originalname,
              highLevelClassification ? highLevelClassification.type : null,
            );

            let moduleOutputs: Record<string, any> = {};
            if (moduleSelection) {
              moduleOutputs = await runSelectedModulesForMarkdown(
                markdownText,
                originalname,
                moduleSelection,
              );
            }

            logOpenAI('backgroundMetadata:after_classify:after_extract', {
              documentType: classifiedType,
              fileId: file.id,
              fileName: originalname,
              vectorStoreFileId: vectorStoreFile.id,
            });

            const metadataAttributes: {
              [key: string]: string | number | boolean;
            } = {
              ...updatedAttributes,
            };

            if (autoMetadata.date) {
              metadataAttributes.date = autoMetadata.date;
            }
            if (autoMetadata.provider_name) {
              metadataAttributes.provider_name = autoMetadata.provider_name;
            }
            if (autoMetadata.clinic_or_facility) {
              metadataAttributes.clinic_or_facility =
                autoMetadata.clinic_or_facility;
            }
            metadataAttributes.has_metadata = true;

            if (config.vectorStoreId) {
              try {
                const ready = await waitForVectorStoreFileReady(
                  vectorStoreFile.id,
                );
                if (ready) {
                  await openai.vectorStores.files.update(vectorStoreFile.id, {
                    vector_store_id: config.vectorStoreId,
                    attributes: metadataAttributes,
                  });
                } else {
                  logOpenAI('backgroundMetadata:after_classify:vs_not_ready', {
                    fileName: originalname,
                    vectorStoreFileId: vectorStoreFile.id,
                  });
                }
              } catch (err) {
                logOpenAI('backgroundMetadata:after_classify:attributes_error', {
                  error:
                    err instanceof Error
                      ? { message: err.message, stack: err.stack }
                      : err,
                  fileName: originalname,
                  vectorStoreFileId: vectorStoreFile.id,
                });
              }
            }

            try {
              const db = await getDb();
              const dateValue = autoMetadata.date
                ? autoMetadata.date.slice(0, 10)
                : null;

               const metadataPayload: any = autoMetadata;
               if (highLevelClassification) {
                 metadataPayload.high_level_classification =
                   highLevelClassification;
               }
               if (moduleSelection) {
                 metadataPayload.modules_selected = moduleSelection;
               }
               if (moduleOutputs && Object.keys(moduleOutputs).length > 0) {
                 metadataPayload.modules = moduleOutputs;
               }

              await db.query(
                `
                UPDATE documents
                SET
                  date = ?,
                  provider_name = ?,
                  clinic_or_facility = ?,
                  metadata_json = ?,
                  needs_metadata = 0
                WHERE vector_store_file_id = ?
              `,
                [
                  dateValue,
                  autoMetadata.provider_name ?? null,
                  autoMetadata.clinic_or_facility ?? null,
                  JSON.stringify(metadataPayload),
                  vectorStoreFile.id,
                ],
              );
              await updateDocumentProjectionsForVectorStoreFile(
                vectorStoreFile.id,
                autoMetadata,
              );
            } catch (err) {
              console.error(
                'Failed to persist auto metadata after classify to DB:',
                err,
              );
              logOpenAI('backgroundMetadata:after_classify:db_error', {
                error:
                  err instanceof Error
                    ? { message: err.message, stack: err.stack }
                    : err,
                fileName: originalname,
                vectorStoreFileId: vectorStoreFile.id,
              });
            }

            logOpenAI('backgroundMetadata:after_classify:success', {
              documentType: classifiedType,
              fileId: file.id,
              fileName: originalname,
              vectorStoreFileId: vectorStoreFile.id,
            });
            });
          } catch (err) {
            console.error('Background classification/metadata failed:', err);
            logOpenAI('classify:background:error', {
              error:
                err instanceof Error
                  ? { message: err.message, stack: err.stack }
                  : err,
              fileId: file.id,
              fileName: originalname,
              vectorStoreFileId: vectorStoreFile.id,
            });
          }
        })();
      }

      res.status(201).json({
        fileId: file.id,
        vectorStoreFileId: vectorStoreFile.id,
        documentType: document_type,
        filename: originalname,
        ingestionStatus: vectorStoreFile.status,
        metadata,
        async: asyncMode,
      });
    } catch (error) {
      console.error('Error in POST /api/documents:', error);
      res.status(500).json({ error: 'Failed to upload and ingest document' });
    }
  },
);

// GET /api/documents
// List vector store files with basic attributes.
router.get('/', requireAuth, async (_req: Request, res: Response) => {
  try {
    if (!config.vectorStoreId) {
      res.status(500).json({ error: 'ARGUS_VECTOR_STORE_ID not configured' });
      return;
    }

    const page = await openai.vectorStores.files.list(config.vectorStoreId, {
      order: 'desc',
    });

    const items = page.data.map((file) => ({
      id: file.id,
      vectorStoreId: file.vector_store_id,
      status: file.status,
      usageBytes: file.usage_bytes,
      attributes: file.attributes ?? null,
    }));

    res.json({ items });
  } catch (error) {
    console.error('Error in GET /api/documents:', error);
    res.status(500).json({ error: 'Failed to list documents' });
  }
});

// GET /api/documents/db
// List documents from the local MariaDB snapshot (fast path for the UI).
router.get('/db', requireAuth, async (_req: Request, res: Response) => {
  try {
    const db = await getDb();
    const [rows] = (await db.query(
      `
        SELECT
          vector_store_file_id,
          openai_file_id,
          filename,
          document_type,
          date,
          provider_name,
          clinic_or_facility,
          is_active,
          needs_metadata,
          metadata_json,
          s3_key
        FROM documents
        ORDER BY created_at DESC
      `,
    )) as any[];

    if (!Array.isArray(rows)) {
      res.json({ items: [] });
      return;
    }

    const items = (rows as any[]).map((row) => {
      const vectorStoreFileId = row.vector_store_file_id as string;
      const openaiFileId = row.openai_file_id as string;
      const filename = row.filename as string;
      const documentType = row.document_type as string;
      const dateValue = row.date as Date | string | null;
      const providerName = (row.provider_name as string | null) ?? '';
      const clinicOrFacility = (row.clinic_or_facility as string | null) ?? '';
      const isActiveRaw = row.is_active as number | boolean | null;
      const needsMetadataRaw = row.needs_metadata as number | boolean | null;
      const s3Key = (row.s3_key as string | null) ?? undefined;

      let metadataRaw = row.metadata_json;
      if (typeof metadataRaw === 'string') {
        try {
          metadataRaw = JSON.parse(metadataRaw);
        } catch {
          metadataRaw = null;
        }
      }

      const hasMetadataObject =
        metadataRaw && typeof metadataRaw === 'object'
          ? Object.keys(metadataRaw).length > 0
          : false;

      const needsMetadata =
        needsMetadataRaw === 1 || needsMetadataRaw === true;

      const hasMetadata = hasMetadataObject && !needsMetadata;

      const attributes: { [key: string]: string | number | boolean } = {
        file_id: openaiFileId,
        file_name: filename,
        document_type: documentType,
        is_active: isActiveRaw === 1 || isActiveRaw === true,
      };

      if (dateValue) {
        const iso =
          typeof dateValue === 'string'
            ? dateValue
            : (dateValue as Date).toISOString().slice(0, 10);
        attributes.date = iso;
      }

      if (providerName) {
        attributes.provider_name = providerName;
      }

      if (clinicOrFacility) {
        attributes.clinic_or_facility = clinicOrFacility;
      }

      if (s3Key) {
        attributes.s3_key = s3Key;
      }

      if (hasMetadata) {
        attributes.has_metadata = true;
      }

      attributes.needs_metadata = needsMetadata;

      return {
        id: vectorStoreFileId,
        vectorStoreId: config.vectorStoreId ?? null,
        status: hasMetadata ? 'completed' : 'in_progress',
        usageBytes: 0,
        attributes,
      };
    });

    res.json({ items });
  } catch (error) {
    console.error('Error in GET /api/documents/db:', error);
    res.status(500).json({ error: 'Failed to list documents from DB' });
  }
});

// DELETE /api/documents/:id
// Remove a file from the vector store (and delete the underlying File when possible).
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!config.vectorStoreId) {
      res.status(500).json({ error: 'ARGUS_VECTOR_STORE_ID not configured' });
      return;
    }

    const { id } = req.params;

    // Retrieve to discover attributes (including original file_id when available).
    const file = await openai.vectorStores.files.retrieve(id, {
      vector_store_id: config.vectorStoreId,
    });

    const attributes = file.attributes ?? {};
    const underlyingFileId =
      typeof attributes.file_id === 'string'
        ? (attributes.file_id as string)
        : undefined;
    const s3Key =
      typeof (attributes as any).s3_key === 'string'
        ? ((attributes as any).s3_key as string)
        : undefined;

    // Detach from vector store.
    const deleted = await openai.vectorStores.files.delete(id, {
      vector_store_id: config.vectorStoreId,
    });

    // Best-effort delete of the underlying file; for older entries this may be missing.
    let fileDeleteResult: unknown = null;
    if (underlyingFileId) {
      try {
        fileDeleteResult = await openai.files.delete(underlyingFileId);
      } catch (err) {
        console.warn('Failed to delete underlying file', underlyingFileId, err);
      }
    }

    // Best-effort delete of the S3 object, if present.
    let s3DeleteAttempted = false;
    if (s3Key) {
      s3DeleteAttempted = true;
      await deleteObjectFromS3(s3Key);
    }

    // Best-effort delete of DB row.
    try {
      const db = await getDb();
      await db.query('DELETE FROM documents WHERE vector_store_file_id = ?', [
        id,
      ]);
    } catch (err) {
      console.error('Failed to delete document row from DB:', err);
    }

    res.json({
      ok: true,
      vectorStoreFileDeleted: deleted,
      underlyingFileDeleted: fileDeleteResult,
      s3DeleteAttempted,
    });
  } catch (error) {
    console.error('Error in DELETE /api/documents/:id:', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// POST /api/documents/:id/soft-delete
// Mark a document as inactive so it is excluded from search but retained in the store.
router.post('/:id/soft-delete', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!config.vectorStoreId) {
      res.status(500).json({ error: 'ARGUS_VECTOR_STORE_ID not configured' });
      return;
    }

    const { id } = req.params;

    const file = await openai.vectorStores.files.retrieve(id, {
      vector_store_id: config.vectorStoreId,
    });

    const attributes = file.attributes ?? {};
    const updated = await openai.vectorStores.files.update(id, {
      vector_store_id: config.vectorStoreId,
      attributes: {
        ...attributes,
        is_active: false,
      },
    });

    try {
      const db = await getDb();
      await db.query(
        'UPDATE documents SET is_active = 0 WHERE vector_store_file_id = ?',
        [id],
      );
    } catch (err) {
      console.error('Failed to update document is_active in DB:', err);
    }

    res.json({
      ok: true,
      file: updated,
    });
  } catch (error) {
    console.error('Error in POST /api/documents/:id/soft-delete:', error);
    res.status(500).json({ error: 'Failed to soft-delete document' });
  }
});

// GET /api/documents/:id
// Retrieve a single vector store file's metadata.
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!config.vectorStoreId) {
      res.status(500).json({ error: 'ARGUS_VECTOR_STORE_ID not configured' });
      return;
    }

    const { id } = req.params;

    const file = await openai.vectorStores.files.retrieve(id, {
      vector_store_id: config.vectorStoreId,
    });

    res.json({
      id: file.id,
      status: file.status,
      usageBytes: file.usage_bytes,
      vectorStoreId: file.vector_store_id,
      attributes: file.attributes ?? null,
      lastError: file.last_error,
    });
  } catch (error) {
    console.error('Error in GET /api/documents/:id:', error);
    res.status(500).json({ error: 'Failed to retrieve document' });
  }
});

// POST /api/documents/:id/type
// Update the document_type classification and mark metadata as needing refresh.
router.post('/:id/type', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!config.vectorStoreId) {
      res.status(500).json({ error: 'ARGUS_VECTOR_STORE_ID not configured' });
      return;
    }

    const { id } = req.params;
    const { document_type } = req.body as { document_type?: string };

    if (!document_type || !isValidDocumentType(document_type)) {
      res.status(400).json({
        error: 'Invalid or missing document_type',
        allowed: DOCUMENT_TYPES,
      });
      return;
    }

    const file = await openai.vectorStores.files.retrieve(id, {
      vector_store_id: config.vectorStoreId,
    });

    const attributes = (file.attributes ?? {}) as {
      [key: string]: string | number | boolean;
    };

    const previousType =
      typeof attributes.document_type === 'string'
        ? (attributes.document_type as string)
        : null;
    const underlyingFileId =
      typeof attributes.file_id === 'string'
        ? (attributes.file_id as string)
        : null;

    const updatedAttributes: { [key: string]: string | number | boolean } = {
      ...attributes,
      document_type,
    };

    // Clear has_metadata flag so UI shows it as needing regeneration.
    if (updatedAttributes.has_metadata) {
      delete updatedAttributes.has_metadata;
    }

    const updatedFile = await openai.vectorStores.files.update(id, {
      vector_store_id: config.vectorStoreId,
      attributes: updatedAttributes,
    });

    try {
      const db = await getDb();
      await db.query(
        `
          UPDATE documents
          SET document_type = ?, needs_metadata = 1
          WHERE vector_store_file_id = ?
        `,
        [document_type, id],
      );
    } catch (err) {
      console.error('Failed to update document_type in DB:', err);
    }

    logOpenAI('documentType:update', {
      vectorStoreFileId: id,
      fileId: underlyingFileId ?? undefined,
      from: previousType,
      to: document_type,
    });

    res.json({
      ok: true,
      documentType: document_type,
      attributes: updatedFile.attributes ?? null,
    });
  } catch (error) {
    console.error('Error in POST /api/documents/:id/type:', error);
    res.status(500).json({ error: 'Failed to update document_type' });
  }
});

// GET /api/documents/:id/logs
// Return OpenAI-related log events for a single document (debug only).
router.get('/:id/logs', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!config.debugRequests) {
      res.status(404).json({ error: 'Debug logging is disabled' });
      return;
    }

    const { id } = req.params;

    // Look up the DB row to get the OpenAI file ID.
    let openaiFileId: string | null = null;
    try {
      const db = await getDb();
      const [rows] = (await db.query(
        'SELECT openai_file_id FROM documents WHERE vector_store_file_id = ? LIMIT 1',
        [id],
      )) as any[];

      if (Array.isArray(rows) && rows.length > 0) {
        const row = rows[0] as any;
        if (row.openai_file_id && typeof row.openai_file_id === 'string') {
          openaiFileId = row.openai_file_id;
        }
      }
    } catch (err) {
      console.error('Failed to look up openai_file_id for logs:', err);
    }

    const fs = await import('fs');
    const path = await import('path');

    // Logs are written relative to the backend root (../logs from src).
    const logsDir = path.join(__dirname, '..', '..', 'logs');
    const openaiLogPath = path.join(logsDir, 'openai.log');

    if (!fs.existsSync(openaiLogPath)) {
      res.json({ items: [] });
      return;
    }

    const raw = fs.readFileSync(openaiLogPath, 'utf8');
    const lines = raw.split('\n').filter((line) => line.trim().length > 0);

    const events: any[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const entryVsId = entry.vectorStoreFileId as string | undefined;
        const entryFileId = entry.fileId as string | undefined;

        if (
          (entryVsId && entryVsId === id) ||
          (openaiFileId && entryFileId && entryFileId === openaiFileId)
        ) {
          events.push(entry);
        }
      } catch {
        // Ignore malformed lines.
      }
    }

    events.sort((a, b) => {
      const ta = typeof a.ts === 'string' ? a.ts : '';
      const tb = typeof b.ts === 'string' ? b.ts : '';
      if (ta === tb) return 0;
      return ta < tb ? -1 : 1;
    });

    res.json({ items: events });
  } catch (error) {
    console.error('Error in GET /api/documents/:id/logs:', error);
    res.status(500).json({ error: 'Failed to read logs for document' });
  }
});

async function getMetadataFromDb(
  vectorStoreFileId: string,
): Promise<DocumentMetadata | null> {
  try {
    const db = await getDb();
    const [rows] = (await db.query(
      'SELECT metadata_json FROM documents WHERE vector_store_file_id = ? LIMIT 1',
      [vectorStoreFileId],
    )) as any[];

    if (Array.isArray(rows) && rows.length > 0) {
      const row = rows[0] as any;
      let raw = row.metadata_json;

      // In MariaDB, JSON columns may come back as strings; parse if needed.
      if (typeof raw === 'string') {
        try {
          raw = JSON.parse(raw);
        } catch {
          raw = null;
        }
      }

      if (raw && typeof raw === 'object' && Object.keys(raw).length > 0) {
        return raw as DocumentMetadata;
      }
    }
  } catch (err) {
    console.error('Failed to read metadata from DB:', err);
  }

  return null;
}

// GET /api/documents/:id/metadata/db
// Return metadata only from the local DB snapshot, without calling OpenAI.
router.get(
  '/:id/metadata/db',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const metadata = await getMetadataFromDb(id);
      if (!metadata) {
        res.status(404).json({ error: 'No metadata stored for this document' });
        return;
      }

      res.json({ metadata });
    } catch (error) {
      console.error('Error in GET /api/documents/:id/metadata/db:', error);
      res.status(500).json({ error: 'Failed to read metadata from DB' });
    }
  },
);

// GET /api/documents/:id/taxonomy
// Return taxonomy terms (category/keyword/subkeyword) and any stored evidence for a given document.
router.get('/:id/taxonomy', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { category_id, keyword_id, subkeyword_id } = req.query as {
      category_id?: string;
      keyword_id?: string;
      subkeyword_id?: string;
    };

    const db = await getDb();
    const [docRows] = (await db.query(
      `
        SELECT id
        FROM documents
        WHERE vector_store_file_id = ?
        LIMIT 1
      `,
      [id],
    )) as any[];

    if (!Array.isArray(docRows) || docRows.length === 0) {
      res.status(404).json({ error: 'Document not found in DB' });
      return;
    }

    const documentId = (docRows[0] as any).id as number;

    const where: string[] = ['dt.document_id = ?'];
    const params: any[] = [documentId];

    if (category_id && category_id.trim() !== '') {
      where.push('tc.id = ?');
      params.push(category_id.trim());
    }
    if (keyword_id && keyword_id.trim() !== '') {
      where.push('dt.keyword_id = ?');
      params.push(keyword_id.trim());
    }
    if (subkeyword_id && subkeyword_id.trim() !== '') {
      where.push('dt.subkeyword_id = ?');
      params.push(subkeyword_id.trim());
    }

    const [termRows] = (await db.query(
      `
        SELECT
          dt.keyword_id,
          dt.subkeyword_id,
          tc.id AS category_id,
          tc.label AS category_label,
          tk.label AS keyword_label,
          ts.label AS subkeyword_label
        FROM document_terms dt
        LEFT JOIN taxonomy_keywords tk ON tk.id = dt.keyword_id
        LEFT JOIN taxonomy_categories tc ON tc.id = tk.category_id
        LEFT JOIN taxonomy_subkeywords ts ON ts.id = dt.subkeyword_id
        WHERE ${where.join(' AND ')}
      `,
      params,
    )) as any[];

    const [evidenceRows] = (await db.query(
      `
        SELECT
          keyword_id,
          subkeyword_id,
          evidence_type,
          evidence_text
        FROM document_term_evidence
        WHERE document_id = ?
      `,
      [documentId],
    )) as any[];

    const evidenceByKey = new Map<
      string,
      { evidenceType: string | null; evidenceText: string }[]
    >();

    if (Array.isArray(evidenceRows)) {
      for (const row of evidenceRows as any[]) {
        const kId = (row.keyword_id as string | null) ?? '';
        const skId = (row.subkeyword_id as string | null) ?? '';
        const key = `${kId}::${skId}`;
        const evidenceText =
          typeof row.evidence_text === 'string'
            ? (row.evidence_text as string)
            : '';
        if (!evidenceText) continue;
        const evidenceType =
          typeof row.evidence_type === 'string'
            ? (row.evidence_type as string)
            : null;
        const list =
          evidenceByKey.get(key) ??
          ([] as { evidenceType: string | null; evidenceText: string }[]);
        list.push({ evidenceType, evidenceText });
        evidenceByKey.set(key, list);
      }
    }

    const terms =
      Array.isArray(termRows) && termRows.length > 0
        ? (termRows as any[]).map((row) => {
            const keywordId = (row.keyword_id as string | null) ?? null;
            const subkeywordId = (row.subkeyword_id as string | null) ?? null;
            const key = `${keywordId ?? ''}::${subkeywordId ?? ''}`;
            const evidence = evidenceByKey.get(key) ?? [];

            return {
              categoryId: (row.category_id as string | null) ?? null,
              categoryLabel: (row.category_label as string | null) ?? null,
              keywordId,
              keywordLabel: (row.keyword_label as string | null) ?? null,
              subkeywordId,
              subkeywordLabel: (row.subkeyword_label as string | null) ?? null,
              evidence,
            };
          })
        : [];

    res.json({ terms });
  } catch (error) {
    console.error('Error in GET /api/documents/:id/taxonomy:', error);
    res.status(500).json({ error: 'Failed to load taxonomy details' });
  }
});

// GET /api/documents/:id/metadata
// Run metadata extraction on demand for a given vector store file using Markdown stored in the DB.
router.get('/:id/metadata', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const db = await getDb();
    const [rows] = (await db.query(
      `
        SELECT
          vector_store_file_id,
          openai_file_id,
          filename,
          document_type,
          markdown,
          s3_key
        FROM documents
        WHERE vector_store_file_id = ?
        LIMIT 1
      `,
      [id],
    )) as any[];

    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(404).json({ error: 'Document not found in DB' });
      return;
    }

    const row = rows[0] as {
      vector_store_file_id: string;
      openai_file_id: string | null;
      filename: string | null;
      document_type: string | null;
      markdown: string | null;
      s3_key: string | null;
    };

    const documentTypeRaw = row.document_type;
    const fileName = row.filename || 'document.pdf';
    const markdown = (row.markdown ?? '').trim();

    if (typeof documentTypeRaw !== 'string' || !isValidDocumentType(documentTypeRaw)) {
      res.status(400).json({ error: 'Missing or invalid document_type in DB for document' });
      return;
    }

    if (!markdown) {
      res.status(400).json({
        error:
          'Markdown content is not available for this document; please re-upload the PDF to regenerate metadata.',
      });
      return;
    }

    const metadata = await runWithMetadataConcurrency(async () =>
      extractMetadataFromMarkdown(documentTypeRaw as DocumentType, markdown, fileName),
    );

    if (!metadata) {
      res.status(500).json({ error: 'Metadata extraction failed' });
      return;
    }

    const highLevelClassification = await classifyHighLevelDocumentFromMarkdown(
      markdown,
      fileName,
    );
    const moduleSelection = await selectModulesForMarkdown(
      markdown,
      fileName,
      highLevelClassification ? highLevelClassification.type : null,
    );

    let moduleOutputs: Record<string, any> = {};
    if (moduleSelection) {
      moduleOutputs = await runSelectedModulesForMarkdown(markdown, fileName, moduleSelection);
    }

    try {
      const dateValue = metadata.date ? metadata.date.slice(0, 10) : null;

      const metadataPayload: any = metadata;
      if (highLevelClassification) {
        metadataPayload.high_level_classification = highLevelClassification;
      }
      if (moduleSelection) {
        metadataPayload.modules_selected = moduleSelection;
      }
      if (moduleOutputs && Object.keys(moduleOutputs).length > 0) {
        metadataPayload.modules = moduleOutputs;
      }

      await db.query(
        `
          UPDATE documents
          SET
            filename = ?,
            document_type = ?,
            date = ?,
            provider_name = ?,
            clinic_or_facility = ?,
            is_active = 1,
            needs_metadata = 0,
            metadata_json = ?
          WHERE vector_store_file_id = ?
        `,
        [
          fileName,
          documentTypeRaw,
          dateValue,
          metadata.provider_name ?? null,
          metadata.clinic_or_facility ?? null,
          JSON.stringify(metadataPayload),
          id,
        ],
      );

      await updateDocumentProjectionsForVectorStoreFile(id, metadata);
    } catch (err) {
      console.error('Failed to update document metadata in DB:', err);
    }

    res.json({ metadata });
  } catch (error) {
    console.error('Error in GET /api/documents/:id/metadata:', error);
    res.status(500).json({ error: 'Failed to extract metadata' });
  }
});

export default router;
