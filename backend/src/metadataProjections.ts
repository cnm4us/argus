import type mysql from 'mysql2/promise';
import { getDb } from './db';
import { insertDocumentTerm, insertDocumentTermEvidence } from './taxonomy';

function normalizeDate(value: Date | string | null): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    if (!value) return null;
    return value.slice(0, 10);
  }
  return null;
}

function toLowerStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'string' ? v.toLowerCase() : String(v).toLowerCase()))
    .filter((s) => s.length > 0);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v));
}

const NORMALIZED_REFERRAL_SPECIALTIES: string[] = [
  'pulmonology',
  'cardiology',
  'endocrinology',
  'gastroenterology',
  'nephrology',
  'rheumatology',
  'hematology',
  'oncology',
  'infectious_disease',
  'neurology',
  'general_surgery',
  'orthopedic_surgery',
  'vascular_surgery',
  'ent',
  'ophthalmology',
  'urology',
  'gynecology',
  'dermatology',
  'podiatry',
  'psychiatry',
  'psychology',
  'counseling',
  'physical_therapy',
  'occupational_therapy',
  'speech_therapy',
  'transplant_specialist',
  'palliative_care',
  'sleep_medicine',
  'pain_management',
  'allergy_immunology',
  'wound_care',
  'other_specialty',
];

const COMM_INITIATED_VALUES: string[] = [
  'patient',
  'provider',
  'clinic',
  'pharmacy',
  'insurance',
  'attorney',
  'other',
  'unknown',
  'not_documented',
];

const COMM_DIRECTION_VALUES: string[] = [
  'inbound',
  'outbound',
  'bidirectional',
  'unknown',
  'not_documented',
];

async function upsertDocumentVitals(
  db: mysql.Pool,
  documentId: number,
  encounterDate: Date | string | null,
  metadata: any,
): Promise<void> {
  const modules = metadata && typeof metadata === 'object' ? (metadata as any).modules : null;
  const vitalsModule =
    modules && typeof (modules as any).vitals === 'object' ? (modules as any).vitals : null;

  const vitalsFromModule =
    vitalsModule && typeof (vitalsModule as any).vitals === 'object'
      ? (vitalsModule as any).vitals
      : null;

  const universalVitals = (metadata as any).vitals ?? null;
  const vitals = vitalsFromModule ?? universalVitals ?? null;

  const spo2 =
    vitals && typeof (vitals as any).spo2 === 'number' && Number.isFinite((vitals as any).spo2)
      ? ((vitals as any).spo2 as number)
      : null;
  const heartRate =
    vitals &&
    typeof (vitals as any).heart_rate === 'number' &&
    Number.isFinite((vitals as any).heart_rate)
      ? ((vitals as any).heart_rate as number)
      : null;
  const respiratoryRate =
    vitals &&
    typeof (vitals as any).respiratory_rate === 'number' &&
    Number.isFinite((vitals as any).respiratory_rate)
      ? ((vitals as any).respiratory_rate as number)
      : null;
  const temperatureF =
    vitals &&
    typeof (vitals as any).temperature_f === 'number' &&
    Number.isFinite((vitals as any).temperature_f)
      ? ((vitals as any).temperature_f as number)
      : null;
  const weightPounds =
    vitals &&
    typeof (vitals as any).weight_pounds === 'number' &&
    Number.isFinite((vitals as any).weight_pounds)
      ? ((vitals as any).weight_pounds as number)
      : null;
  const bmi =
    vitals && typeof (vitals as any).bmi === 'number' && Number.isFinite((vitals as any).bmi)
      ? ((vitals as any).bmi as number)
      : null;

  let bloodPressureSystolic: number | null = null;
  let bloodPressureDiastolic: number | null = null;

  if (vitals && (vitals as any).blood_pressure && typeof (vitals as any).blood_pressure === 'object') {
    const bp = (vitals as any).blood_pressure as { systolic?: number; diastolic?: number };
    if (typeof bp.systolic === 'number' && Number.isFinite(bp.systolic)) {
      bloodPressureSystolic = bp.systolic;
    }
    if (typeof bp.diastolic === 'number' && Number.isFinite(bp.diastolic)) {
      bloodPressureDiastolic = bp.diastolic;
    }
  } else if (universalVitals && typeof (universalVitals as any).blood_pressure === 'string') {
    const bloodPressureStr = (universalVitals as any).blood_pressure as string;
    const match = bloodPressureStr.match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
    if (match) {
      const s = Number.parseInt(match[1] ?? '', 10);
      const d = Number.parseInt(match[2] ?? '', 10);
      if (Number.isFinite(s)) bloodPressureSystolic = s;
      if (Number.isFinite(d)) bloodPressureDiastolic = d;
    }
  }

  const oxygenDevice =
    vitals && typeof (vitals as any).oxygen_device === 'string'
      ? ((vitals as any).oxygen_device as string)
      : null;

  const heightInches =
    vitals &&
    typeof (vitals as any).height_inches === 'number' &&
    Number.isFinite((vitals as any).height_inches)
      ? ((vitals as any).height_inches as number)
      : null;

  const hasVitals =
    spo2 !== null ||
    heartRate !== null ||
    respiratoryRate !== null ||
    temperatureF !== null ||
    weightPounds !== null ||
    bmi !== null ||
    bloodPressureSystolic !== null ||
    bloodPressureDiastolic !== null;

  const spo2IsLow = spo2 !== null && spo2 < 90 ? 1 : 0;

  const encounterDateValue = normalizeDate(encounterDate);

  await db.query(
    `
      INSERT INTO document_vitals (
        document_id,
        encounter_date,
        has_vitals,
        spo2,
        spo2_is_low,
        blood_pressure_systolic,
        blood_pressure_diastolic,
        heart_rate,
        respiratory_rate,
        temperature_f,
        oxygen_device,
        height_inches,
        weight_pounds,
        bmi
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        encounter_date = VALUES(encounter_date),
        has_vitals = VALUES(has_vitals),
        spo2 = VALUES(spo2),
        spo2_is_low = VALUES(spo2_is_low),
        blood_pressure_systolic = VALUES(blood_pressure_systolic),
        blood_pressure_diastolic = VALUES(blood_pressure_diastolic),
        heart_rate = VALUES(heart_rate),
        respiratory_rate = VALUES(respiratory_rate),
        temperature_f = VALUES(temperature_f),
        oxygen_device = VALUES(oxygen_device),
        height_inches = VALUES(height_inches),
        weight_pounds = VALUES(weight_pounds),
        bmi = VALUES(bmi)
    `,
    [
      documentId,
      encounterDateValue,
      hasVitals ? 1 : 0,
      spo2,
      spo2IsLow,
      bloodPressureSystolic,
      bloodPressureDiastolic,
      heartRate,
      respiratoryRate,
      temperatureF,
      oxygenDevice,
      heightInches,
      weightPounds,
      bmi,
    ],
  );
}

async function upsertDocumentSmoking(
  db: mysql.Pool,
  documentId: number,
  encounterDate: Date | string | null,
  metadata: any,
): Promise<void> {
  const encounterDateValue = normalizeDate(encounterDate);

  const modules = metadata && typeof metadata === 'object' ? (metadata as any).modules : null;
  const smokingModule =
    modules && typeof (modules as any).smoking === 'object' ? (modules as any).smoking : null;

  let patientStatus: string | null = null;
  let patientYearsSmoked: number | null = null;
  let patientPackYears: number | null = null;
  let providerStatus: string | null = null;
  let providerYearsSmoked: number | null = null;
  let providerPackYears: number | null = null;

  let hasSmokingHistoryDocumented = 0;
  let hasCessationCounseling = 0;
  let advisedToQuit = 0;
  let pharmNicotineReplacement = 0;
  let pharmVareniclineChantix = 0;
  let pharmBupropion = 0;
  let behavioralTherapyOffered = 0;
  let quitlineOffered = 0;
  let supportGroupOffered = 0;
  let referralSmokingProgram = 0;
  let referralBehavioralHealth = 0;
  let followUpPlansDocumented = 0;
  let counselingTimeMinutes: number | null = null;

  if (smokingModule && typeof (smokingModule as any).smoking === 'object') {
    const smoking = (smokingModule as any).smoking;

    const patientHistory = smoking.patient_reported_history ?? {};
    const providerHistory = smoking.provider_documented_history ?? {};
    const cessation = smoking.cessation_counseling ?? {};

    if (typeof patientHistory.status === 'string') {
      patientStatus = patientHistory.status;
    }
    if (typeof patientHistory.years_smoked === 'number' && Number.isFinite(patientHistory.years_smoked)) {
      patientYearsSmoked = patientHistory.years_smoked;
    }
    if (typeof patientHistory.pack_years === 'number' && Number.isFinite(patientHistory.pack_years)) {
      patientPackYears = patientHistory.pack_years;
    }

    if (typeof providerHistory.status === 'string') {
      providerStatus = providerHistory.status;
    }
    if (
      typeof providerHistory.years_smoked === 'number' &&
      Number.isFinite(providerHistory.years_smoked)
    ) {
      providerYearsSmoked = providerHistory.years_smoked;
    }
    if (
      typeof providerHistory.pack_years === 'number' &&
      Number.isFinite(providerHistory.pack_years)
    ) {
      providerPackYears = providerHistory.pack_years;
    }

    if (providerHistory.documentation_present === true) {
      hasSmokingHistoryDocumented = 1;
    } else if (
      patientStatus ||
      providerStatus ||
      patientYearsSmoked !== null ||
      patientPackYears !== null ||
      providerYearsSmoked !== null ||
      providerPackYears !== null
    ) {
      hasSmokingHistoryDocumented = 1;
    }

    if (cessation && typeof cessation === 'object') {
      if (cessation.advised_to_quit === true) {
        advisedToQuit = 1;
      }

      const pharm = cessation.pharmacologic_offers ?? {};
      if (pharm.nicotine_replacement === true) {
        pharmNicotineReplacement = 1;
      }
      if (pharm.varenicline_chantix === true) {
        pharmVareniclineChantix = 1;
      }
      if (pharm.bupropion === true) {
        pharmBupropion = 1;
      }

      const behavioral = cessation.behavioral_support ?? {};
      if (behavioral.therapy_counseling_offered === true) {
        behavioralTherapyOffered = 1;
      }
      if (behavioral.quitline_offered === true) {
        quitlineOffered = 1;
      }
      if (behavioral.support_group_offered === true) {
        supportGroupOffered = 1;
      }

      const refs = cessation.referrals ?? {};
      if (refs.smoking_cessation_program === true) {
        referralSmokingProgram = 1;
      }
      if (refs.behavioral_health === true) {
        referralBehavioralHealth = 1;
      }

      if (cessation.follow_up_plans_documented === true) {
        followUpPlansDocumented = 1;
      }

      if (
        typeof cessation.counseling_time_minutes === 'number' &&
        Number.isFinite(cessation.counseling_time_minutes)
      ) {
        counselingTimeMinutes = cessation.counseling_time_minutes;
      }

      if (
        advisedToQuit ||
        pharmNicotineReplacement ||
        pharmVareniclineChantix ||
        pharmBupropion ||
        behavioralTherapyOffered ||
        quitlineOffered ||
        supportGroupOffered ||
        referralSmokingProgram ||
        referralBehavioralHealth ||
        followUpPlansDocumented
      ) {
        hasCessationCounseling = 1;
      }
    }
  } else {
    const entities = (metadata as any).entities_extracted ?? {};
    const conditions = toLowerStringArray(entities.conditions);
    const keywords = toLowerStringArray((metadata as any).keywords);

    const smokingKeywords = ['smoking', 'smoker', 'tobacco', 'cigarette', 'cigar', 'nicotine'];
    const hasSmokingHistory =
      conditions.some((c) => smokingKeywords.some((k) => c.includes(k))) ||
      keywords.some((k) => smokingKeywords.some((s) => k.includes(s)));
    hasSmokingHistoryDocumented = hasSmokingHistory ? 1 : 0;
  }

  await db.query(
    `
      INSERT INTO document_smoking (
        document_id,
        encounter_date,
        patient_status,
        patient_years_smoked,
        patient_pack_years,
        provider_status,
        provider_years_smoked,
        provider_pack_years,
        has_smoking_history_documented,
        has_cessation_counseling,
        advised_to_quit,
        pharm_nicotine_replacement,
        pharm_varenicline_chantix,
        pharm_bupropion,
        behavioral_therapy_offered,
        quitline_offered,
        support_group_offered,
        referral_smoking_program,
        referral_behavioral_health,
        follow_up_plans_documented,
        counseling_time_minutes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        encounter_date = VALUES(encounter_date),
        patient_status = VALUES(patient_status),
        patient_years_smoked = VALUES(patient_years_smoked),
        patient_pack_years = VALUES(patient_pack_years),
        provider_status = VALUES(provider_status),
        provider_years_smoked = VALUES(provider_years_smoked),
        provider_pack_years = VALUES(provider_pack_years),
        has_smoking_history_documented = VALUES(has_smoking_history_documented),
        has_cessation_counseling = VALUES(has_cessation_counseling),
        advised_to_quit = VALUES(advised_to_quit),
        pharm_nicotine_replacement = VALUES(pharm_nicotine_replacement),
        pharm_varenicline_chantix = VALUES(pharm_varenicline_chantix),
        pharm_bupropion = VALUES(pharm_bupropion),
        behavioral_therapy_offered = VALUES(behavioral_therapy_offered),
        quitline_offered = VALUES(quitline_offered),
        support_group_offered = VALUES(support_group_offered),
        referral_smoking_program = VALUES(referral_smoking_program),
        referral_behavioral_health = VALUES(referral_behavioral_health),
        follow_up_plans_documented = VALUES(follow_up_plans_documented),
        counseling_time_minutes = VALUES(counseling_time_minutes)
    `,
    [
      documentId,
      encounterDateValue,
      patientStatus,
      patientYearsSmoked,
      patientPackYears,
      providerStatus,
      providerYearsSmoked,
      providerPackYears,
      hasSmokingHistoryDocumented,
      hasCessationCounseling,
      advisedToQuit,
      pharmNicotineReplacement,
      pharmVareniclineChantix,
      pharmBupropion,
      behavioralTherapyOffered,
      quitlineOffered,
      supportGroupOffered,
      referralSmokingProgram,
      referralBehavioralHealth,
      followUpPlansDocumented,
      counselingTimeMinutes,
    ],
  );
}

async function upsertDocumentMentalHealth(
  db: mysql.Pool,
  documentId: number,
  encounterDate: Date | string | null,
  metadata: any,
): Promise<void> {
  const encounterDateValue = normalizeDate(encounterDate);

  const modules = metadata && typeof metadata === 'object' ? (metadata as any).modules : null;
  const mhModule =
    modules && typeof (modules as any).mental_health === 'object'
      ? (modules as any).mental_health
      : null;

  let affectAnxious = false;
  let affectDepressed = false;
  let affectTearful = false;
  let affectLabile = false;
  let affectFlatOrBlunted = false;
  let behaviorEmotionallyDistressed = false;
  let behaviorNonCompliant = false;
  let behaviorGuardedOrHostile = false;
  let pressuredSpeech = false;

  let symptomAnxiety = false;
  let symptomDepression = false;
  let symptomStress = false;
  let symptomPanic = false;
  let symptomInsomnia = false;

  let dxAnxietyDisorder = false;
  let dxDepressiveDisorder = false;
  let dxAdjustmentDisorder = false;
  let dxPtsd = false;
  let dxBipolarDisorder = false;
  let dxSubstanceUseDisorder = false;

  if (mhModule && typeof (mhModule as any).mental_health === 'object') {
    const mh = (mhModule as any).mental_health;

    const providerObserved = mh.provider_observed_state ?? {};
    const affectArray = toLowerStringArray(providerObserved.affect);
    const behaviorArray = toLowerStringArray(providerObserved.behavior);

    affectAnxious = affectArray.includes('anxious');
    affectDepressed = affectArray.includes('depressed');
    affectTearful = affectArray.includes('tearful');
    affectLabile = affectArray.includes('labile');
    affectFlatOrBlunted = affectArray.includes('flat') || affectArray.includes('blunted');
    behaviorEmotionallyDistressed = behaviorArray.includes('emotionally_distressed');
    behaviorNonCompliant = behaviorArray.includes('non_compliant');
    behaviorGuardedOrHostile =
      behaviorArray.includes('guarded') || behaviorArray.includes('hostile');
    pressuredSpeech = affectArray.includes('pressured_speech');

    const patientState = mh.patient_reported_state ?? {};
    const symptomArray = toLowerStringArray(patientState.symptoms);

    symptomAnxiety = symptomArray.includes('anxiety');
    symptomDepression = symptomArray.includes('depression');
    symptomStress = symptomArray.includes('stress');
    symptomPanic = symptomArray.includes('panic');
    symptomInsomnia = symptomArray.includes('insomnia');

    const diagnosesArray = Array.isArray(mh.diagnoses) ? (mh.diagnoses as string[]) : [];
    dxAnxietyDisorder = diagnosesArray.includes('anxiety_disorder');
    dxDepressiveDisorder = diagnosesArray.includes('depressive_disorder');
    dxAdjustmentDisorder = diagnosesArray.includes('adjustment_disorder');
    dxPtsd = diagnosesArray.includes('ptsd');
    dxBipolarDisorder = diagnosesArray.includes('bipolar_disorder');
    dxSubstanceUseDisorder = diagnosesArray.includes('substance_use_disorder');
  } else {
    const conditionsDiscussed = toLowerStringArray((metadata as any).conditions_discussed);
    const entities = (metadata as any).entities_extracted ?? {};
    const symptomEntities = toLowerStringArray(entities.symptoms);
    const conditionEntities = toLowerStringArray(entities.conditions);

    const allTexts = [...conditionsDiscussed, ...symptomEntities, ...conditionEntities];

    affectAnxious = allTexts.some((t) => t.includes('anxiety') || t.includes('anxious'));
    affectDepressed = allTexts.some((t) => t.includes('depression') || t.includes('depressed'));
    affectTearful = allTexts.some((t) => t.includes('tearful'));
    affectLabile = allTexts.some((t) => t.includes('labile'));
    affectFlatOrBlunted =
      allTexts.some((t) => t.includes('flat affect')) ||
      allTexts.some((t) => t.includes('blunted affect'));

    behaviorEmotionallyDistressed = allTexts.some((t) =>
      t.includes('emotionally distressed'),
    );
    behaviorNonCompliant = allTexts.some((t) => t.includes('noncompliant'));
    behaviorGuardedOrHostile =
      allTexts.some((t) => t.includes('guarded')) || allTexts.some((t) => t.includes('hostile'));
    pressuredSpeech = allTexts.some((t) => t.includes('pressured speech'));

    symptomAnxiety = affectAnxious;
    symptomDepression = affectDepressed;
    symptomStress = allTexts.some((t) => t.includes('stress') || t.includes('stressed'));
    symptomPanic = allTexts.some((t) => t.includes('panic'));
    symptomInsomnia = allTexts.some((t) => t.includes('insomnia') || t.includes("can't sleep"));

    const diagnosesRaw = Array.isArray((metadata as any).diagnoses)
      ? ((metadata as any).diagnoses as { description?: string }[])
      : [];
    const descriptions = diagnosesRaw
      .map((d) => (typeof d.description === 'string' ? d.description.toLowerCase() : ''))
      .filter((d) => d.length > 0);

    dxAnxietyDisorder = descriptions.some((d) => d.includes('anxiety'));
    dxDepressiveDisorder = descriptions.some((d) => d.includes('depression'));
    dxAdjustmentDisorder = descriptions.some((d) => d.includes('adjustment disorder'));
    dxPtsd = descriptions.some((d) => d.includes('ptsd'));
    dxBipolarDisorder = descriptions.some((d) => d.includes('bipolar'));
    dxSubstanceUseDisorder =
      descriptions.some((d) => d.includes('substance')) ||
      descriptions.some((d) => d.includes('alcohol use disorder'));
  }

  const dxAnyMentalHealth =
    dxAnxietyDisorder ||
    dxDepressiveDisorder ||
    dxAdjustmentDisorder ||
    dxPtsd ||
    dxBipolarDisorder ||
    dxSubstanceUseDisorder;

  const hasMentalHealthContent =
    affectAnxious ||
    affectDepressed ||
    affectTearful ||
    affectLabile ||
    affectFlatOrBlunted ||
    behaviorEmotionallyDistressed ||
    behaviorNonCompliant ||
    behaviorGuardedOrHostile ||
    pressuredSpeech ||
    symptomAnxiety ||
    symptomDepression ||
    symptomStress ||
    symptomPanic ||
    symptomInsomnia ||
    dxAnyMentalHealth;

  await db.query(
    `
      INSERT INTO document_mental_health (
        document_id,
        encounter_date,
        has_mental_health_content,
        affect_anxious,
        affect_depressed,
        affect_tearful,
        affect_labile,
        affect_flat_or_blunted,
        behavior_emotionally_distressed,
        behavior_non_compliant,
        behavior_guarded_or_hostile,
        pressured_speech,
        symptom_anxiety,
        symptom_depression,
        symptom_stress,
        symptom_panic,
        symptom_insomnia,
        dx_any_mental_health,
        dx_anxiety_disorder,
        dx_depressive_disorder,
        dx_adjustment_disorder,
        dx_ptsd,
        dx_bipolar_disorder,
        dx_substance_use_disorder
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        encounter_date = VALUES(encounter_date),
        has_mental_health_content = VALUES(has_mental_health_content),
        affect_anxious = VALUES(affect_anxious),
        affect_depressed = VALUES(affect_depressed),
        affect_tearful = VALUES(affect_tearful),
        affect_labile = VALUES(affect_labile),
        affect_flat_or_blunted = VALUES(affect_flat_or_blunted),
        behavior_emotionally_distressed = VALUES(behavior_emotionally_distressed),
        behavior_non_compliant = VALUES(behavior_non_compliant),
        behavior_guarded_or_hostile = VALUES(behavior_guarded_or_hostile),
        pressured_speech = VALUES(pressured_speech),
        symptom_anxiety = VALUES(symptom_anxiety),
        symptom_depression = VALUES(symptom_depression),
        symptom_stress = VALUES(symptom_stress),
        symptom_panic = VALUES(symptom_panic),
        symptom_insomnia = VALUES(symptom_insomnia),
        dx_any_mental_health = VALUES(dx_any_mental_health),
        dx_anxiety_disorder = VALUES(dx_anxiety_disorder),
        dx_depressive_disorder = VALUES(dx_depressive_disorder),
        dx_adjustment_disorder = VALUES(dx_adjustment_disorder),
        dx_ptsd = VALUES(dx_ptsd),
        dx_bipolar_disorder = VALUES(dx_bipolar_disorder),
        dx_substance_use_disorder = VALUES(dx_substance_use_disorder)
    `,
    [
      documentId,
      encounterDateValue,
      hasMentalHealthContent ? 1 : 0,
      affectAnxious ? 1 : 0,
      affectDepressed ? 1 : 0,
      affectTearful ? 1 : 0,
      affectLabile ? 1 : 0,
      affectFlatOrBlunted ? 1 : 0,
      behaviorEmotionallyDistressed ? 1 : 0,
      behaviorNonCompliant ? 1 : 0,
      behaviorGuardedOrHostile ? 1 : 0,
      pressuredSpeech ? 1 : 0,
      symptomAnxiety ? 1 : 0,
      symptomDepression ? 1 : 0,
      symptomStress ? 1 : 0,
      symptomPanic ? 1 : 0,
      symptomInsomnia ? 1 : 0,
      dxAnyMentalHealth ? 1 : 0,
      dxAnxietyDisorder ? 1 : 0,
      dxDepressiveDisorder ? 1 : 0,
      dxAdjustmentDisorder ? 1 : 0,
      dxPtsd ? 1 : 0,
      dxBipolarDisorder ? 1 : 0,
      dxSubstanceUseDisorder ? 1 : 0,
    ],
  );
}

async function upsertDocumentReferrals(
  db: mysql.Pool,
  documentId: number,
  encounterDate: Date | string | null,
  metadata: any,
): Promise<void> {
  const encounterDateValue = normalizeDate(encounterDate);

  const modules = metadata && typeof metadata === 'object' ? (metadata as any).modules : null;
  const referralModule =
    modules && typeof (modules as any).referral === 'object'
      ? (modules as any).referral
      : null;

  // Clear any existing rows for this document; we'll re-insert based on current metadata.
  await db.query('DELETE FROM document_referrals WHERE document_id = ?', [documentId]);

  const rowsToInsert: {
    referralSpecialty: string | null;
    referralReasonText: string | null;
    referralPatientRequested: number;
    referralProviderInitiated: number;
    hasReferralDenial: number;
    referralDenialType: string | null;
    referralDenialReasonText: string | null;
  }[] = [];

  // 1) Structured referral from module (if present).
  if (referralModule && typeof (referralModule as any).referral === 'object') {
    const ref = (referralModule as any).referral;
    const req = ref.referral_request ?? {};
    const denial = ref.referral_denial ?? {};

    const specialty =
      typeof req.specialty === 'string' && req.specialty.length > 0 ? req.specialty : null;
    const reason =
      typeof req.reason === 'string' && req.reason.length > 0 ? req.reason : null;

    const patientRequested = req.patient_requested === true ? 1 : 0;
    const providerInitiated = req.provider_initiated === true ? 1 : 0;

    const hasDenial =
      typeof denial.denial_type === 'string' && denial.denial_type.length > 0 ? 1 : 0;
    const denialType =
      typeof denial.denial_type === 'string' && denial.denial_type.length > 0
        ? (denial.denial_type as string)
        : null;
    const denialReason =
      typeof denial.denial_reason_text === 'string' && denial.denial_reason_text.length > 0
        ? (denial.denial_reason_text as string)
        : null;

    if (specialty || reason || patientRequested || providerInitiated || hasDenial) {
      rowsToInsert.push({
        referralSpecialty: specialty,
        referralReasonText: reason,
        referralPatientRequested: patientRequested,
        referralProviderInitiated: providerInitiated,
        hasReferralDenial: hasDenial,
        referralDenialType: denialType,
        referralDenialReasonText: denialReason,
      });
    }
  }

  // 2) Additional referrals from universal metadata.referrals[] (unstructured).
  const referralsRaw = toStringArray((metadata as any).referrals);
  for (const text of referralsRaw) {
    const trimmed = text.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();

    const matchedSpecialty =
      NORMALIZED_REFERRAL_SPECIALTIES.find((s) => s === lower) ?? null;

    if (matchedSpecialty) {
      // If this specialty is already represented, skip adding a duplicate row.
      const alreadyBySpecialty = rowsToInsert.some(
        (r) => (r.referralSpecialty ?? '').toLowerCase() === matchedSpecialty,
      );
      if (alreadyBySpecialty) {
        continue;
      }

      rowsToInsert.push({
        referralSpecialty: matchedSpecialty,
        referralReasonText: null,
        referralPatientRequested: 0,
        referralProviderInitiated: 0,
        hasReferralDenial: 0,
        referralDenialType: null,
        referralDenialReasonText: null,
      });
      continue;
    }

    // Avoid duplicating a row where this text is already used as a reason.
    const alreadyByReason = rowsToInsert.some(
      (r) => (r.referralReasonText ?? '').toLowerCase() === lower,
    );
    if (alreadyByReason) continue;

    rowsToInsert.push({
      referralSpecialty: null,
      referralReasonText: trimmed,
      referralPatientRequested: 0,
      referralProviderInitiated: 0,
      hasReferralDenial: 0,
      referralDenialType: null,
      referralDenialReasonText: null,
    });
  }

  if (rowsToInsert.length === 0) {
    return;
  }

  const conditionsDiscussed = toLowerStringArray((metadata as any).conditions_discussed);

  for (const row of rowsToInsert) {
    const allReasonText = `${row.referralReasonText ?? ''} ${conditionsDiscussed.join(' ')}`.toLowerCase();

    const reasonMentionsCopd =
      allReasonText.includes('copd') ||
      allReasonText.includes('chronic obstructive pulmonary');
    const reasonMentionsEmphysemaOrObstructive =
      allReasonText.includes('emphysema') || allReasonText.includes('obstructive lung');

    await db.query(
      `
        INSERT INTO document_referrals (
          document_id,
          encounter_date,
          has_referral_request,
          referral_specialty,
          referral_reason_text,
          referral_patient_requested,
          referral_provider_initiated,
          has_referral_denial,
          referral_denial_type,
          referral_denial_reason_text,
          reason_mentions_copd,
          reason_mentions_emphysema_or_obstructive_lung
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        documentId,
        encounterDateValue,
        1,
        row.referralSpecialty,
        row.referralReasonText,
        row.referralPatientRequested,
        row.referralProviderInitiated,
        row.hasReferralDenial,
        row.referralDenialType,
        row.referralDenialReasonText,
        reasonMentionsCopd ? 1 : 0,
        reasonMentionsEmphysemaOrObstructive ? 1 : 0,
      ],
    );
  }
}

async function upsertDocumentResults(
  db: mysql.Pool,
  documentId: number,
  encounterDate: Date | string | null,
  metadata: any,
): Promise<void> {
  const encounterDateValue = normalizeDate(encounterDate);

  const modules = metadata && typeof metadata === 'object' ? (metadata as any).modules : null;
  const resultsModule =
    modules && typeof (modules as any).results === 'object' ? (modules as any).results : null;

  // Clear existing rows for this document; insert fresh if module is present.
  await db.query('DELETE FROM document_results WHERE document_id = ?', [documentId]);

  if (!resultsModule || typeof (resultsModule as any).results !== 'object') {
    return;
  }

  const results = (resultsModule as any).results;
  const typeRaw = typeof results.type === 'string' ? results.type : null;
  const resultType =
    typeRaw === 'lab' || typeRaw === 'imaging' ? (typeRaw as 'lab' | 'imaging') : null;

  const lab = results.lab ?? {};
  const imaging = results.imaging ?? {};

  const labCategory =
    typeof lab.category === 'string' && lab.category.length > 0 ? (lab.category as string) : null;
  const labSubType =
    typeof lab.subtype === 'string' && lab.subtype.length > 0 ? (lab.subtype as string) : null;

  let labAbnormalFlags: string | null = null;
  if (Array.isArray(lab.abnormal_flags) && lab.abnormal_flags.length > 0) {
    labAbnormalFlags = lab.abnormal_flags.map((f: any) => String(f)).join(', ');
  }

  const labSummaryText =
    typeof lab.result_summary_text === 'string' && lab.result_summary_text.length > 0
      ? (lab.result_summary_text as string)
      : null;

  const imagingCategory =
    typeof imaging.category === 'string' && imaging.category.length > 0
      ? (imaging.category as string)
      : null;
  const imagingSubType =
    typeof imaging.subtype === 'string' && imaging.subtype.length > 0
      ? (imaging.subtype as string)
      : null;
  const impressionText =
    typeof imaging.impression_text === 'string' && imaging.impression_text.length > 0
      ? (imaging.impression_text as string)
      : null;
  const findingsText =
    typeof imaging.findings_text === 'string' && imaging.findings_text.length > 0
      ? (imaging.findings_text as string)
      : null;

  const reasonForTest =
    typeof results.reason_for_test === 'string' && results.reason_for_test.length > 0
      ? (results.reason_for_test as string)
      : null;

  await db.query(
    `
      INSERT INTO document_results (
        document_id,
        encounter_date,
        result_type,
        lab_category,
        lab_subtype,
        lab_abnormal_flags,
        lab_summary_text,
        imaging_category,
        imaging_subtype,
        impression_text,
        findings_text,
        reason_for_test
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      documentId,
      encounterDateValue,
      resultType,
      labCategory,
      labSubType,
      labAbnormalFlags,
      labSummaryText,
      imagingCategory,
      imagingSubType,
      impressionText,
      findingsText,
      reasonForTest,
    ],
  );
}

async function upsertDocumentCommunications(
  db: mysql.Pool,
  documentId: number,
  encounterDate: Date | string | null,
  metadata: any,
): Promise<void> {
  const encounterDateValue = normalizeDate(encounterDate);

  const modules = metadata && typeof metadata === 'object' ? (metadata as any).modules : null;
  const commModule =
    modules && typeof (modules as any).communication === 'object'
      ? (modules as any).communication
      : null;

  let initiatedBy: string | null = null;
  let messageDirection: string | null = null;
  let reasonText: string | null = null;
  let adviceGivenText: string | null = null;
  let patientResponseText: string | null = null;

  if (commModule && typeof (commModule as any).communication === 'object') {
    const comm = (commModule as any).communication;

    if (typeof comm.initiated_by === 'string' && comm.initiated_by.length > 0) {
      initiatedBy = comm.initiated_by;
    }
    if (
      typeof comm.message_direction === 'string' &&
      comm.message_direction.length > 0
    ) {
      messageDirection = comm.message_direction;
    }
    if (typeof comm.reason === 'string' && comm.reason.length > 0) {
      reasonText = comm.reason;
    }
    if (typeof comm.advice_given === 'string' && comm.advice_given.length > 0) {
      adviceGivenText = comm.advice_given;
    }
    if (
      typeof comm.patient_response === 'string' &&
      comm.patient_response.length > 0
    ) {
      patientResponseText = comm.patient_response;
    }
  } else if (metadata && typeof (metadata as any).communication === 'object') {
    const comm = (metadata as any).communication;

    if (typeof comm.initiated_by === 'string' && comm.initiated_by.length > 0) {
      initiatedBy = comm.initiated_by;
    }
    if (
      typeof comm.message_direction === 'string' &&
      comm.message_direction.length > 0
    ) {
      messageDirection = comm.message_direction;
    }
    if (typeof comm.reason === 'string' && comm.reason.length > 0) {
      reasonText = comm.reason;
    }
    if (typeof comm.advice_given === 'string' && comm.advice_given.length > 0) {
      adviceGivenText = comm.advice_given;
    }
    if (
      typeof comm.patient_response === 'string' &&
      comm.patient_response.length > 0
    ) {
      patientResponseText = comm.patient_response;
    }
  }

  // If nothing meaningful is present, do not insert/update.
  if (
    !initiatedBy &&
    !messageDirection &&
    !reasonText &&
    !adviceGivenText &&
    !patientResponseText
  ) {
    return;
  }

  // Normalize enum values to avoid DB truncation.
  if (initiatedBy && !COMM_INITIATED_VALUES.includes(initiatedBy)) {
    initiatedBy = 'other';
  }
  if (messageDirection && !COMM_DIRECTION_VALUES.includes(messageDirection)) {
    messageDirection = 'unknown';
  }

  await db.query(
    `
      INSERT INTO document_communications (
        document_id,
        encounter_date,
        initiated_by,
        message_direction,
        reason_text,
        advice_given_text,
        patient_response_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        encounter_date = VALUES(encounter_date),
        initiated_by = VALUES(initiated_by),
        message_direction = VALUES(message_direction),
        reason_text = VALUES(reason_text),
        advice_given_text = VALUES(advice_given_text),
        patient_response_text = VALUES(patient_response_text)
    `,
    [
      documentId,
      encounterDateValue,
      initiatedBy,
      messageDirection,
      reasonText,
      adviceGivenText,
      patientResponseText,
    ],
  );
}

async function updateTaxonomyFromProjections(
  db: mysql.Pool,
  documentId: number,
  metadata: any,
): Promise<void> {
  // Clear existing rule-based evidence for projection-backed taxonomy categories for this document.
  // LLM-driven taxonomy evidence (from runTaxonomyExtractionForDocument) uses different keyword ids
  // and is not affected by this cleanup.
  try {
    await db.query(
      `
        DELETE FROM document_term_evidence
        WHERE document_id = ?
          AND (
            keyword_id LIKE 'vitals.%' OR
            keyword_id LIKE 'smoking.%' OR
            keyword_id LIKE 'mental_health.%' OR
            keyword_id LIKE 'sexual_history.%' OR
            keyword_id LIKE 'appointments.%' OR
            keyword_id LIKE 'results.%' OR
            keyword_id LIKE 'referrals.%' OR
            keyword_id LIKE 'communication.%'
          )
      `,
      [documentId],
    );
  } catch {
    // Best-effort; evidence deduplication is diagnostic only.
  }
  // Vitals: tag any document that has any vitals.
  try {
    const [vRows] = (await db.query(
      `
        SELECT
          has_vitals,
          spo2_is_low,
          blood_pressure_systolic,
          blood_pressure_diastolic,
          heart_rate,
          temperature_f
        FROM document_vitals
        WHERE document_id = ?
        LIMIT 1
      `,
      [documentId],
    )) as any[];
      if (Array.isArray(vRows) && vRows.length > 0) {
        const v = vRows[0] as any;
        // Build a human-readable vitals snippet from available metadata for debugging.
        const vitalsSnippetParts: string[] = [];
        const metadataVitals = (metadata as any).vitals ?? null;
        const metadataVitalsObj =
          metadataVitals && typeof metadataVitals === 'object'
            ? (metadataVitals as any)
            : null;

        const bpText =
          metadataVitalsObj && typeof metadataVitalsObj.blood_pressure === 'string'
            ? (metadataVitalsObj.blood_pressure as string)
            : null;
        if (bpText) {
          vitalsSnippetParts.push(`BP ${bpText}`);
        }
      if (v.has_vitals === 1) {
        await insertDocumentTerm({
          connection: db,
          documentId,
          keywordId: 'vitals.any_mention',
        });
        await insertDocumentTermEvidence({
          connection: db,
          documentId,
          keywordId: 'vitals.any_mention',
          evidenceType: 'rule',
          evidenceText:
            vitalsSnippetParts.length > 0
              ? `Vital signs documented: ${vitalsSnippetParts.join('; ')}`
              : 'document_vitals.has_vitals=1 (at least one vital sign present).',
        });
      }
      if (v.spo2_is_low === 1) {
        await insertDocumentTerm({
          connection: db,
          documentId,
          keywordId: 'vitals.hypoxia',
        });
        const spo2Val =
          typeof v.spo2 === 'number' && Number.isFinite(v.spo2)
            ? (v.spo2 as number)
            : null;
        await insertDocumentTermEvidence({
          connection: db,
          documentId,
          keywordId: 'vitals.hypoxia',
          evidenceType: 'rule',
          evidenceText: spo2Val !== null
            ? `spo2_is_low=1 (spo2=${spo2Val})`
            : 'spo2_is_low=1',
        });
      }

      const sbp =
        typeof v.blood_pressure_systolic === 'number'
          ? (v.blood_pressure_systolic as number)
          : null;
      const dbp =
        typeof v.blood_pressure_diastolic === 'number'
          ? (v.blood_pressure_diastolic as number)
          : null;
      const hr =
        typeof v.heart_rate === 'number' ? (v.heart_rate as number) : null;
      const tempF =
        typeof v.temperature_f === 'number' ? (v.temperature_f as number) : null;

      const hasHypotension =
        (sbp !== null && sbp < 90) || (dbp !== null && dbp < 60);
      if (hasHypotension) {
        await insertDocumentTerm({
          connection: db,
          documentId,
          keywordId: 'vitals.hypotension',
        });
        await insertDocumentTermEvidence({
          connection: db,
          documentId,
          keywordId: 'vitals.hypotension',
          evidenceType: 'rule',
          evidenceText: `blood_pressure_systolic=${sbp ?? 'null'}, blood_pressure_diastolic=${dbp ?? 'null'} (hypotension rule: SBP < 90 or DBP < 60).`,
        });
      }

      if (hr !== null && hr >= 120) {
        await insertDocumentTerm({
          connection: db,
          documentId,
          keywordId: 'vitals.tachycardia',
        });
        await insertDocumentTermEvidence({
          connection: db,
          documentId,
          keywordId: 'vitals.tachycardia',
          evidenceType: 'rule',
          evidenceText: `heart_rate=${hr} (tachycardia rule: HR >= 120).`,
        });
      }

      if (tempF !== null && tempF >= 100.4) {
        await insertDocumentTerm({
          connection: db,
          documentId,
          keywordId: 'vitals.fever',
        });
        await insertDocumentTermEvidence({
          connection: db,
          documentId,
          keywordId: 'vitals.fever',
          evidenceType: 'rule',
          evidenceText: `temperature_f=${tempF} (fever rule: temp >= 100.4°F).`,
        });
      }
    }
  } catch {
    // Best-effort; ignore taxonomy errors here.
  }

  // Smoking: tag any smoking mention and basic status/counseling.
  try {
    const [sRows] = (await db.query(
      `
        SELECT
          patient_status,
          provider_status,
          has_smoking_history_documented,
          has_cessation_counseling
        FROM document_smoking
        WHERE document_id = ?
        LIMIT 1
      `,
      [documentId],
    )) as any[];

    if (Array.isArray(sRows) && sRows.length > 0) {
      const s = sRows[0] as any;
      const hasHistory =
        s.has_smoking_history_documented === 1 ||
        s.has_smoking_history_documented === true;
      const hasCessation =
        s.has_cessation_counseling === 1 || s.has_cessation_counseling === true;

      const patientStatus =
        typeof s.patient_status === 'string' && s.patient_status.length > 0
          ? (s.patient_status as string)
          : null;
      const providerStatus =
        typeof s.provider_status === 'string' && s.provider_status.length > 0
          ? (s.provider_status as string)
          : null;

      const status = patientStatus ?? providerStatus ?? null;

      if (hasHistory) {
        await insertDocumentTerm({
          connection: db,
          documentId,
          keywordId: 'smoking.any_mention',
        });
        await insertDocumentTermEvidence({
          connection: db,
          documentId,
          keywordId: 'smoking.any_mention',
          evidenceType: 'rule',
          evidenceText: `has_smoking_history_documented=${s.has_smoking_history_documented}, patient_status=${patientStatus ?? 'null'}, provider_status=${providerStatus ?? 'null'}.`,
        });
      }

      if (status === 'current') {
        await insertDocumentTerm({
          connection: db,
          documentId,
          keywordId: 'smoking.current_smoker',
        });
        await insertDocumentTermEvidence({
          connection: db,
          documentId,
          keywordId: 'smoking.current_smoker',
          evidenceType: 'rule',
          evidenceText: `smoking status derived as "current" (patient_status=${patientStatus ?? 'null'}, provider_status=${providerStatus ?? 'null'}).`,
        });
      } else if (status === 'former') {
        await insertDocumentTerm({
          connection: db,
          documentId,
          keywordId: 'smoking.former_smoker',
        });
        await insertDocumentTermEvidence({
          connection: db,
          documentId,
          keywordId: 'smoking.former_smoker',
          evidenceType: 'rule',
          evidenceText: `smoking status derived as "former" (patient_status=${patientStatus ?? 'null'}, provider_status=${providerStatus ?? 'null'}).`,
        });
      } else if (status === 'never') {
        await insertDocumentTerm({
          connection: db,
          documentId,
          keywordId: 'smoking.never_smoker',
        });
        await insertDocumentTermEvidence({
          connection: db,
          documentId,
          keywordId: 'smoking.never_smoker',
          evidenceType: 'rule',
          evidenceText: `smoking status derived as "never" (patient_status=${patientStatus ?? 'null'}, provider_status=${providerStatus ?? 'null'}).`,
        });
      }

      if (hasCessation) {
        await insertDocumentTerm({
          connection: db,
          documentId,
          keywordId: 'smoking.cessation_counseling',
        });
        await insertDocumentTermEvidence({
          connection: db,
          documentId,
          keywordId: 'smoking.cessation_counseling',
          evidenceType: 'rule',
          evidenceText: 'has_cessation_counseling=1.',
        });
      }
    }
  } catch {
    // Ignore taxonomy errors; projections remain valid.
  }

  // Mental health: tag any mental health content and a few key diagnoses.
  try {
    const [mRows] = (await db.query(
      `
        SELECT
          has_mental_health_content,
          symptom_anxiety,
          symptom_depression,
          dx_anxiety_disorder,
          dx_depressive_disorder,
          dx_substance_use_disorder
        FROM document_mental_health
        WHERE document_id = ?
        LIMIT 1
      `,
      [documentId],
    )) as any[];

    if (Array.isArray(mRows) && mRows.length > 0) {
      const m = mRows[0] as any;
      const hasContent =
        m.has_mental_health_content === 1 ||
        m.has_mental_health_content === true;

      const hasAnxiety =
        m.symptom_anxiety === 1 ||
        m.symptom_anxiety === true ||
        m.dx_anxiety_disorder === 1 ||
        m.dx_anxiety_disorder === true;

      const hasDepression =
        m.symptom_depression === 1 ||
        m.symptom_depression === true ||
        m.dx_depressive_disorder === 1 ||
        m.dx_depressive_disorder === true;

      const hasSUD =
        m.dx_substance_use_disorder === 1 ||
        m.dx_substance_use_disorder === true;

      if (hasContent) {
        await insertDocumentTerm({
          connection: db,
          documentId,
          keywordId: 'mental_health.any_mention',
        });
        await insertDocumentTermEvidence({
          connection: db,
          documentId,
          keywordId: 'mental_health.any_mention',
          evidenceType: 'rule',
          evidenceText: 'has_mental_health_content=1 (document_mental_health.has_mental_health_content).',
        });
      }

      if (hasAnxiety) {
        await insertDocumentTerm({
          connection: db,
          documentId,
          keywordId: 'mental_health.anxiety',
        });
        await insertDocumentTermEvidence({
          connection: db,
          documentId,
          keywordId: 'mental_health.anxiety',
          evidenceType: 'rule',
          evidenceText: `anxiety-related flags present (symptom_anxiety=${m.symptom_anxiety}, dx_anxiety_disorder=${m.dx_anxiety_disorder}).`,
        });
      }

      if (hasDepression) {
        await insertDocumentTerm({
          connection: db,
          documentId,
          keywordId: 'mental_health.depression',
        });
        await insertDocumentTermEvidence({
          connection: db,
          documentId,
          keywordId: 'mental_health.depression',
          evidenceType: 'rule',
          evidenceText: `depression-related flags present (symptom_depression=${m.symptom_depression}, dx_depressive_disorder=${m.dx_depressive_disorder}).`,
        });
      }

      if (hasSUD) {
        await insertDocumentTerm({
          connection: db,
          documentId,
          keywordId: 'mental_health.substance_use_disorder',
        });
        await insertDocumentTermEvidence({
          connection: db,
          documentId,
          keywordId: 'mental_health.substance_use_disorder',
          evidenceType: 'rule',
          evidenceText: `dx_substance_use_disorder=${m.dx_substance_use_disorder}.`,
        });
      }
    }
  } catch {
    // Ignore taxonomy errors; projections remain valid.
  }

  // Sexual history: tag any sexual history mention and risky behaviors / STI risk.
  try {
    const modules = metadata && typeof metadata === 'object' ? (metadata as any).modules : null;
    const sexualModule =
      modules && typeof (modules as any).sexual_health === 'object'
        ? (modules as any).sexual_health
        : null;

    if (sexualModule && typeof (sexualModule as any).sexual_health === 'object') {
      const sh = (sexualModule as any).sexual_health;

      const pra = (sh as any).patient_reported_activity ?? {};
      const risk = (sh as any).provider_documented_risk_factors ?? {};
      const reasonsRaw = (sh as any).reason_for_testing ?? [];
      const reasons = Array.isArray(reasonsRaw) ? reasonsRaw.map((r) => String(r)) : [];
      const historyOfStisRaw = (pra as any).history_of_stis ?? [];
      const historyOfStis = Array.isArray(historyOfStisRaw)
        ? historyOfStisRaw.map((v) => String(v).toLowerCase())
        : [];
      const reportedVariationsRaw = (pra as any).reported_variations ?? [];
      const reportedVariations = Array.isArray(reportedVariationsRaw)
        ? reportedVariationsRaw
            .map((v: any) => String(v).trim())
            .filter((s: string) => s.length > 0)
        : [];

      const sexuallyActiveVal =
        typeof (pra as any).sexually_active === 'string'
          ? ((pra as any).sexually_active as string)
          : null;
      const partnersCount =
        typeof (pra as any).partners_count === 'number' &&
        Number.isFinite((pra as any).partners_count)
          ? ((pra as any).partners_count as number)
          : null;
      const newPartnerVal =
        typeof (pra as any).new_partner === 'string'
          ? ((pra as any).new_partner as string)
          : null;
      const condomUseVal =
        typeof (pra as any).condom_use === 'string'
          ? ((pra as any).condom_use as string)
          : null;
      const transactionalSexVal =
        typeof (pra as any).transactional_sex === 'string'
          ? ((pra as any).transactional_sex as string)
          : null;

      const mentionReasons: string[] = [];
      const riskReasons: string[] = [];

      const mentionEvidenceParts: string[] = [];

      if (
        sexuallyActiveVal &&
        sexuallyActiveVal !== 'not_documented' &&
        sexuallyActiveVal !== 'null'
      ) {
        mentionReasons.push(`sexually_active=${sexuallyActiveVal}`);

        if (sexuallyActiveVal === 'yes') {
          mentionEvidenceParts.push('patient is sexually active');
        } else if (sexuallyActiveVal === 'no') {
          mentionEvidenceParts.push('patient denies sexual activity');
        } else if (sexuallyActiveVal === 'unsure') {
          mentionEvidenceParts.push('sexual activity status uncertain');
        }
      }
      if (partnersCount !== null) {
        mentionReasons.push(`partners_count=${partnersCount}`);
        mentionEvidenceParts.push(
          `reports ${partnersCount} sexual partner(s) in history`,
        );
      }
      if (newPartnerVal && newPartnerVal !== 'null') {
        mentionReasons.push(`new_partner=${newPartnerVal}`);
        if (newPartnerVal === 'yes') {
          mentionEvidenceParts.push('reports a new sexual partner');
        } else if (newPartnerVal === 'no') {
          mentionEvidenceParts.push('no new sexual partner reported');
        }
      }
      if (
        condomUseVal &&
        condomUseVal !== 'not_documented' &&
        condomUseVal !== 'null'
      ) {
        mentionReasons.push(`condom_use=${condomUseVal}`);
      }
      if (
        transactionalSexVal &&
        transactionalSexVal !== 'not_documented' &&
        transactionalSexVal !== 'null'
      ) {
        mentionReasons.push(`transactional_sex=${transactionalSexVal}`);
        if (transactionalSexVal === 'yes') {
          mentionEvidenceParts.push('transactional sex documented');
        } else if (transactionalSexVal === 'no') {
          mentionEvidenceParts.push('denies transactional sex');
        } else if (transactionalSexVal === 'unsure') {
          mentionEvidenceParts.push('uncertain about transactional sex history');
        }
      }
      if (historyOfStis.length > 0) {
        mentionReasons.push(
          `history_of_stis=[${historyOfStis.join(', ')}]`,
        );
        const nonNone = historyOfStis.filter(
          (h) => h !== 'none' && h !== 'unknown',
        );
        if (nonNone.length > 0) {
          mentionEvidenceParts.push(
            `history of STIs: ${nonNone.join(', ')}`,
          );
        } else if (historyOfStis.includes('none')) {
          mentionEvidenceParts.push('denies prior STIs');
        }
      }
      // Prefer using patient-reported variations directly as evidence when available.
      if (reportedVariations.length > 0) {
        mentionEvidenceParts.push(...reportedVariations);
      }

      const hasAnySexualMention = mentionReasons.length > 0;

      const partnerPositive = (risk as any).partner_positive === true;
      const riskNewPartner = (risk as any).new_partner === true;
      const multiplePartners = (risk as any).multiple_partners === true;
      const unprotectedSex = (risk as any).unprotected_sex === true;

      const hasStiHistory = historyOfStis.some(
        (h) =>
          h === 'chlamydia' ||
          h === 'gonorrhea' ||
          h === 'hsv' ||
          h === 'hiv' ||
          h === 'syphilis',
      );

      // Risky sexual behavior should be driven by explicit risk behaviors or partner/STI history,
      // not by symptoms or routine preventive screening alone.
      if (partnerPositive) {
        riskReasons.push('partner_positive=true');
      }
      if (riskNewPartner) {
        riskReasons.push('new_partner=true (provider_documented_risk_factors)');
      }
      if (multiplePartners) {
        riskReasons.push('multiple_partners=true');
      }
      if (unprotectedSex) {
        riskReasons.push('unprotected_sex=true');
      }
      // routine_screening alone is not considered risky behavior; it reflects guideline-driven care.
      if (hasStiHistory) {
        riskReasons.push(
          `history_of_stis includes STI of interest: [${historyOfStis.join(
            ', ',
          )}]`,
        );
      }
      if (
        transactionalSexVal &&
        (transactionalSexVal === 'yes' || transactionalSexVal === 'unsure')
      ) {
        riskReasons.push(`transactional_sex=${transactionalSexVal}`);
      }
      if (partnersCount !== null && partnersCount > 1) {
        riskReasons.push(`partners_count=${partnersCount} (>1)`);
      }

      const hasRiskyBehavior = riskReasons.length > 0;

      if (hasAnySexualMention) {
        await insertDocumentTerm({
          connection: db,
          documentId,
          keywordId: 'sexual_history.any_mention',
        });
        await insertDocumentTermEvidence({
          connection: db,
          documentId,
          keywordId: 'sexual_history.any_mention',
          evidenceType: 'rule',
          evidenceText:
            mentionEvidenceParts.length > 0
              ? `Sexual history / activity documented: ${mentionEvidenceParts.join(
                  '; ',
                )}`
              : `Sexual history / activity documented via sexual_health module: ${mentionReasons.join(
                  '; ',
                )}`,
        });
      }

      if (hasRiskyBehavior) {
        await insertDocumentTerm({
          connection: db,
          documentId,
          keywordId: 'sexual_history.risky_behavior',
        });
        await insertDocumentTermEvidence({
          connection: db,
          documentId,
          keywordId: 'sexual_history.risky_behavior',
          evidenceType: 'rule',
          evidenceText: `Risky sexual behavior / STI risk inferred from sexual_health module signals: ${riskReasons.join(
            '; ',
          )}`,
        });
      }
    }
  } catch {
    // Ignore taxonomy errors; projections remain valid.
  }

  // Appointments: tag any document with structured appointment data.
  try {
    const [aRows] = (await db.query(
      `
        SELECT
          status,
          appointment_date
        FROM document_appointments
        WHERE document_id = ?
        ORDER BY appointment_date ASC
        LIMIT 1
      `,
      [documentId],
    )) as any[];

    if (Array.isArray(aRows) && aRows.length > 0) {
      const a = aRows[0] as any;
      const status =
        typeof a.status === 'string' && a.status.length > 0
          ? (a.status as string)
          : null;

      await insertDocumentTerm({
        connection: db,
        documentId,
        keywordId: 'appointments.any_mention',
      });
      await insertDocumentTermEvidence({
        connection: db,
        documentId,
        keywordId: 'appointments.any_mention',
        evidenceType: 'rule',
        evidenceText: `document_appointments row present (status=${status ?? 'unknown'}).`,
      });
    }
  } catch {
    // Ignore taxonomy errors; projections remain valid.
  }

  // Results: tag documents with lab and imaging results.
  try {
    const [rRows] = (await db.query(
      `
        SELECT
          result_type,
          lab_category,
          imaging_category
        FROM document_results
        WHERE document_id = ?
        ORDER BY encounter_date ASC
        LIMIT 1
      `,
      [documentId],
    )) as any[];

    if (Array.isArray(rRows) && rRows.length > 0) {
      const r = rRows[0] as any;
      const resultType =
        typeof r.result_type === 'string' && r.result_type.length > 0
          ? (r.result_type as string)
          : null;
      const labCategory =
        typeof r.lab_category === 'string' && r.lab_category.length > 0
          ? (r.lab_category as string)
          : null;
      const imagingCategory =
        typeof r.imaging_category === 'string' &&
        r.imaging_category.length > 0
          ? (r.imaging_category as string)
          : null;

      await insertDocumentTerm({
        connection: db,
        documentId,
        keywordId: 'results.any_mention',
      });
      await insertDocumentTermEvidence({
        connection: db,
        documentId,
        keywordId: 'results.any_mention',
        evidenceType: 'rule',
        evidenceText: `document_results row present (result_type=${resultType ?? 'null'}, lab_category=${labCategory ?? 'null'}, imaging_category=${imagingCategory ?? 'null'}).`,
      });

      if (resultType === 'lab') {
        await insertDocumentTerm({
          connection: db,
          documentId,
          keywordId: 'results.lab',
        });
        await insertDocumentTermEvidence({
          connection: db,
          documentId,
          keywordId: 'results.lab',
          evidenceType: 'rule',
          evidenceText: `lab results present (lab_category=${labCategory ?? 'null'}).`,
        });
      } else if (resultType === 'imaging') {
        await insertDocumentTerm({
          connection: db,
          documentId,
          keywordId: 'results.imaging',
        });
        await insertDocumentTermEvidence({
          connection: db,
          documentId,
          keywordId: 'results.imaging',
          evidenceType: 'rule',
          evidenceText: `imaging results present (imaging_category=${imagingCategory ?? 'null'}).`,
        });
      }
    }
  } catch {
    // Ignore taxonomy errors; projections remain valid.
  }

  // Referrals: tag documents with referral requests and denials.
  try {
    const [refRows] = (await db.query(
      `
        SELECT
          has_referral_request,
          has_referral_denial,
          referral_specialty
        FROM document_referrals
        WHERE document_id = ?
        ORDER BY encounter_date ASC
        LIMIT 1
      `,
      [documentId],
    )) as any[];

    if (Array.isArray(refRows) && refRows.length > 0) {
      const r = refRows[0] as any;
      const hasRequest =
        r.has_referral_request === 1 || r.has_referral_request === true;
      const hasDenial =
        r.has_referral_denial === 1 || r.has_referral_denial === true;
      const specialty =
        typeof r.referral_specialty === 'string' &&
        r.referral_specialty.length > 0
          ? (r.referral_specialty as string)
          : null;

      if (hasRequest) {
        await insertDocumentTerm({
          connection: db,
          documentId,
          keywordId: 'referrals.any_mention',
        });
        await insertDocumentTermEvidence({
          connection: db,
          documentId,
          keywordId: 'referrals.any_mention',
          evidenceType: 'rule',
          evidenceText: `document_referrals row present (specialty=${specialty ?? 'null'}).`,
        });
      }

      if (hasDenial) {
        await insertDocumentTerm({
          connection: db,
          documentId,
          keywordId: 'referrals.denial',
        });
        await insertDocumentTermEvidence({
          connection: db,
          documentId,
          keywordId: 'referrals.denial',
          evidenceType: 'rule',
          evidenceText: 'referral denial documented (has_referral_denial=1).',
        });
      }
    }
  } catch {
    // Ignore taxonomy errors; projections remain valid.
  }

  // Communication: tag documents with structured communication metadata.
  try {
    const [cRows] = (await db.query(
      `
        SELECT
          initiated_by,
          message_direction
        FROM document_communications
        WHERE document_id = ?
        LIMIT 1
      `,
      [documentId],
    )) as any[];

    if (Array.isArray(cRows) && cRows.length > 0) {
      const c = cRows[0] as any;
      const initiatedBy =
        typeof c.initiated_by === 'string' && c.initiated_by.length > 0
          ? (c.initiated_by as string)
          : null;

      await insertDocumentTerm({
        connection: db,
        documentId,
        keywordId: 'communication.any_mention',
      });
      await insertDocumentTermEvidence({
        connection: db,
        documentId,
        keywordId: 'communication.any_mention',
        evidenceType: 'rule',
        evidenceText: `document_communications row present (initiated_by=${initiatedBy ?? 'null'}).`,
      });

      if (initiatedBy === 'patient') {
        await insertDocumentTerm({
          connection: db,
          documentId,
          keywordId: 'communication.patient_initiated',
        });
        await insertDocumentTermEvidence({
          connection: db,
          documentId,
          keywordId: 'communication.patient_initiated',
          evidenceType: 'rule',
          evidenceText: 'communication initiated_by=patient.',
        });
      } else if (
        initiatedBy === 'provider' ||
        initiatedBy === 'clinic'
      ) {
        await insertDocumentTerm({
          connection: db,
          documentId,
          keywordId: 'communication.provider_initiated',
        });
        await insertDocumentTermEvidence({
          connection: db,
          documentId,
          keywordId: 'communication.provider_initiated',
          evidenceType: 'rule',
          evidenceText: `communication initiated_by=${initiatedBy}.`,
        });
      }
    }
  } catch {
    // Ignore taxonomy errors; projections remain valid.
  }
}

export async function updateDocumentProjectionsForVectorStoreFile(
  vectorStoreFileId: string,
  _metadata: any,
): Promise<void> {
  const db = await getDb();

  const [rows] = (await db.query(
    'SELECT id, date, metadata_json FROM documents WHERE vector_store_file_id = ? LIMIT 1',
    [vectorStoreFileId],
  )) as any[];

  if (!Array.isArray(rows) || rows.length === 0) {
    return;
  }

  const row = rows[0] as any;
  const documentId = row.id as number;
  const encounterDate = (row.date as Date | string | null) ?? null;

  let metadata = row.metadata_json;

  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      metadata = null;
    }
  }

  if (!metadata || typeof metadata !== 'object') {
    return;
  }

  await upsertDocumentVitals(db, documentId, encounterDate, metadata);
  await upsertDocumentSmoking(db, documentId, encounterDate, metadata);
  await upsertDocumentMentalHealth(db, documentId, encounterDate, metadata);
  await upsertDocumentReferrals(db, documentId, encounterDate, metadata);
  await upsertDocumentResults(db, documentId, encounterDate, metadata);
  await upsertDocumentCommunications(db, documentId, encounterDate, metadata);
  await updateTaxonomyFromProjections(db, documentId, metadata);
}
