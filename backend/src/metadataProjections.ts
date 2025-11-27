import type mysql from 'mysql2/promise';
import { getDb } from './db';

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

  let hasReferralRequest = 0;
  let referralSpecialty: string | null = null;
  let referralReasonText: string | null = null;
  let referralPatientRequested = 0;
  let referralProviderInitiated = 0;
  let hasReferralDenial = 0;
  let referralDenialType: string | null = null;
  let referralDenialReasonText: string | null = null;

  if (referralModule && typeof (referralModule as any).referral === 'object') {
    const ref = (referralModule as any).referral;
    const req = ref.referral_request ?? {};
    const denial = ref.referral_denial ?? {};

    if (typeof req.specialty === 'string' && req.specialty.length > 0) {
      referralSpecialty = req.specialty;
    }
    if (typeof req.reason === 'string' && req.reason.length > 0) {
      referralReasonText = req.reason;
    }
    if (req.patient_requested === true) {
      referralPatientRequested = 1;
    }
    if (req.provider_initiated === true) {
      referralProviderInitiated = 1;
    }

    if (
      referralSpecialty ||
      referralReasonText ||
      referralPatientRequested ||
      referralProviderInitiated
    ) {
      hasReferralRequest = 1;
    }

    if (typeof denial.denial_type === 'string' && denial.denial_type.length > 0) {
      hasReferralDenial = 1;
      referralDenialType = denial.denial_type;
    }
    if (typeof denial.denial_reason_text === 'string' && denial.denial_reason_text.length > 0) {
      referralDenialReasonText = denial.denial_reason_text;
    }
  } else {
    const referralsRaw = toStringArray((metadata as any).referrals);
    const referralsLower = referralsRaw.map((r) => r.toLowerCase());

    hasReferralRequest = referralsRaw.length > 0 ? 1 : 0;
    referralReasonText = referralsRaw.length > 0 ? referralsRaw.join('; ') : null;

    if (referralsLower.some((r) => r.includes('pulmonology') || r.includes('pulmonary'))) {
      referralSpecialty = 'pulmonology';
    }
  }

  const conditionsDiscussed = toLowerStringArray((metadata as any).conditions_discussed);
  const allReasonText = `${referralReasonText ?? ''} ${conditionsDiscussed.join(' ')}`.toLowerCase();

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
      ON DUPLICATE KEY UPDATE
        encounter_date = VALUES(encounter_date),
        has_referral_request = VALUES(has_referral_request),
        referral_specialty = VALUES(referral_specialty),
        referral_reason_text = VALUES(referral_reason_text),
        referral_patient_requested = VALUES(referral_patient_requested),
        referral_provider_initiated = VALUES(referral_provider_initiated),
        has_referral_denial = VALUES(has_referral_denial),
        referral_denial_type = VALUES(referral_denial_type),
        referral_denial_reason_text = VALUES(referral_denial_reason_text),
        reason_mentions_copd = VALUES(reason_mentions_copd),
        reason_mentions_emphysema_or_obstructive_lung = VALUES(reason_mentions_emphysema_or_obstructive_lung)
    `,
    [
      documentId,
      encounterDateValue,
      hasReferralRequest ? 1 : 0,
      referralSpecialty,
      referralReasonText,
      referralPatientRequested,
      referralProviderInitiated,
      hasReferralDenial,
      referralDenialType,
      referralDenialReasonText,
      reasonMentionsCopd ? 1 : 0,
      reasonMentionsEmphysemaOrObstructive ? 1 : 0,
    ],
  );
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
}

