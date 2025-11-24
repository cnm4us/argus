export const DOCUMENT_TYPES = [
  'office_visit',
  'telehealth_visit',
  'telephone_visit',
  'telephone_encounter',
  'medication_refill',
  'imaging_report',
  'lab_result',
  'procedure_note',
  'referral',
  'patient_message',
  'provider_message',
  'triage_note',
  'emergency_room_note',
  'hospitalization_note',
  'discharge_summary',
  'care_plan',
  'external_specialist_note',
  'legal_document',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

// Core metadata schema we will populate via OpenAI extraction.
export interface UniversalMetadata {
  document_id: string;
  document_type: DocumentType;
  file_id: string;
  file_name: string;
  page_range: string;
  date: string;
  provider_name: string;
  provider_role: string;
  clinic_or_facility: string;
  patient_name: string;
  patient_mrn: string;
  patient_dob: string;
  summary: string;
}

export interface EncounterMetadata {
  encounter_type: string;
  encounter_mode: string;
  chief_complaint: string;
  subjective_text: string;
  objective_text: string;
  assessment_text: string;
  plan_text: string;
  instructions: string;
  referrals: string[];
  follow_up_recommended: string;
  follow_up_timeframe: string;
}

export interface DiagnosisEntry {
  code: string;
  description: string;
  primary: boolean;
}

export interface DiagnosesMetadata {
  diagnoses: DiagnosisEntry[];
  conditions_discussed: string[];
}

export interface VitalsMetadata {
  vitals: {
    spo2: number | null;
    blood_pressure: string | null;
    heart_rate: number | null;
    resp_rate: number | null;
    temperature: number | null;
    weight: number | null;
    bmi: number | null;
  };
}

export interface MedicationsChanged {
  started: string[];
  stopped: string[];
  modified: string[];
}

export interface MedicationsMetadata {
  medications_listed: string[];
  medications_changed: MedicationsChanged;
  pharmacy_notes: string;
}

export interface ImagingMetadata {
  imaging: {
    modality: string;
    body_part: string;
    findings: string;
    impression: string;
  };
}

export interface ProcedureEntry {
  procedure_name: string;
  date_performed: string;
  notes: string;
}

export interface ProceduresMetadata {
  procedures: ProcedureEntry[];
}

export interface CommunicationMetadata {
  communication: {
    initiated_by: string;
    message_direction: string;
    reason: string;
    advice_given: string;
    patient_response: string;
  };
}

export interface RiskFlags {
  worsening_symptoms: boolean;
  missed_follow_up: boolean;
  noncompliance_documented: boolean;
  urgent_recommendation: boolean;
}

export interface DocumentQualityFlags {
  concise_assessment: boolean;
  clear_er_recommendation: boolean;
  explicit_follow_up_plan: boolean;
}

export interface LegalRiskMetadata {
  risk_flags: RiskFlags;
  document_quality_flags: DocumentQualityFlags;
}

export interface EntitiesExtracted {
  symptoms: string[];
  conditions: string[];
  body_systems: string[];
  procedures: string[];
  medications: string[];
}

export interface AdditionalMetadata {
  entities_extracted: EntitiesExtracted;
  keywords: string[];
  tags: string[];
}

export interface DocumentMetadata
  extends UniversalMetadata,
    EncounterMetadata,
    DiagnosesMetadata,
    VitalsMetadata,
    MedicationsMetadata,
    ImagingMetadata,
    ProceduresMetadata,
    CommunicationMetadata,
    LegalRiskMetadata,
    AdditionalMetadata {}
