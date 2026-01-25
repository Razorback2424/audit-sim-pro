import { appId } from '../AppCore';
import { buildCaseDraftFromRecipe } from '../generation/buildCaseDraft';
import { getCaseRecipe } from '../generation/recipeRegistry';
import { createCase } from './caseService';
import { fetchRecipe } from './recipeService';
import { queueCaseGenerationJob, saveCaseGenerationPlan } from './caseGenerationService';

const toTrimmedString = (value) =>
  typeof value === 'string' ? value.trim() : value === null || value === undefined ? '' : String(value);

const resolveInstruction = ({ recipeDetails, draftInstruction, recipeVersion }) => {
  if (recipeDetails?.instruction && typeof recipeDetails.instruction === 'object') {
    return { ...recipeDetails.instruction, version: recipeVersion };
  }
  return { ...draftInstruction, version: recipeVersion };
};

const resolveWorkflow = ({ recipeDetails, draft }) => {
  const fallback = draft?.workflow;
  const fallbackSteps = Array.isArray(fallback?.steps) ? fallback.steps : [];
  const candidate = recipeDetails?.workflow;
  const candidateSteps = Array.isArray(candidate?.steps) ? candidate.steps : [];

  if (candidateSteps.length > 0) {
    if (fallbackSteps.includes('ca_check') && !candidateSteps.includes('ca_check')) {
      return fallback;
    }
    if (fallbackSteps.includes('ca_completeness') && !candidateSteps.includes('ca_completeness')) {
      return fallback;
    }
    return candidate;
  }

  if (fallbackSteps.length > 0) {
    return fallback;
  }

  return { steps: ['instruction', 'selection', 'testing', 'results'], gateScope: 'once' };
};

export const generateAttemptFromRecipe = async ({ moduleId, uid, retakeAttempt = false }) => {
  if (!moduleId) {
    throw new Error('generateAttemptFromRecipe requires a moduleId.');
  }
  if (!uid) {
    throw new Error('generateAttemptFromRecipe requires a uid.');
  }

  const recipeMeta = getCaseRecipe(moduleId);
  const recipeDetails = await fetchRecipe(moduleId).catch(() => null);

  const draft = buildCaseDraftFromRecipe({ recipeId: moduleId, overrides: {} });
  const recipeVersion =
    Number.isFinite(Number(recipeDetails?.recipeVersion))
      ? Number(recipeDetails.recipeVersion)
      : draft.recipeVersion || Number(recipeMeta?.version) || 1;

  const instruction = resolveInstruction({
    recipeDetails,
    draftInstruction: draft.instruction,
    recipeVersion,
  });

  const title =
    toTrimmedString(recipeDetails?.title) ||
    toTrimmedString(recipeDetails?.moduleTitle) ||
    draft.caseName ||
    recipeMeta.label ||
    'Audit Case';
  const moduleTitle =
    toTrimmedString(recipeDetails?.moduleTitle) ||
    toTrimmedString(recipeMeta.moduleTitle) ||
    recipeMeta.label ||
    '';

  const workflow = resolveWorkflow({ recipeDetails, draft });
  const casePayload = {
    caseName: title,
    title,
    instruction,
    disbursements: draft.disbursements,
    invoiceMappings: draft.invoiceMappings || [],
    referenceDocuments: draft.referenceDocuments,
    workpaper: draft.workpaper || null,
    publicVisible: false,
    visibleToUserIds: [uid],
    status: 'assigned',
    opensAt: null,
    dueAt: null,
    auditArea: recipeDetails?.auditArea || recipeMeta.auditArea || draft.auditArea,
    caseLevel: draft.caseLevel || recipeMeta.caseLevel || '',
    moduleId: moduleId,
    recipeVersion,
    moduleTitle,
    pathId: recipeDetails?.pathId || recipeMeta.pathId || '',
    tier: recipeDetails?.tier || recipeMeta.tier || 'foundations',
    primarySkill: recipeDetails?.primarySkill || recipeMeta.primarySkill || '',
    workflow,
    generationConfig: recipeDetails?.generationConfig || {},
    retakeAttempt: Boolean(retakeAttempt),
    createdBy: uid,
    cashContext: draft.cashContext || null,
    cashOutstandingItems: draft.cashOutstandingItems || [],
    cashCutoffItems: draft.cashCutoffItems || [],
    cashRegisterItems: draft.cashRegisterItems || [],
    cashReconciliationMap: draft.cashReconciliationMap || [],
    cashArtifacts: draft.cashArtifacts || [],
  };

  const caseId = await createCase(casePayload);

  if (draft.generationPlan) {
    try {
      await saveCaseGenerationPlan({ caseId, plan: draft.generationPlan });
      const phaseList = Array.isArray(draft.generationPlan?.phases)
        ? draft.generationPlan.phases
        : [];
      const initialPhaseId = phaseList.length > 0
        ? String(phaseList[0]?.id || phaseList[0] || '').trim()
        : '';
      await queueCaseGenerationJob({
        caseId,
        plan: draft.generationPlan,
        appId,
        phaseId: initialPhaseId || null,
      });
    } catch (error) {
      console.warn('[attemptService] Generation job failed', error);
    }
  }

  return caseId;
};
