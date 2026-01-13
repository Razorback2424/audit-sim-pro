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

export const generateAttemptFromRecipe = async ({ moduleId, uid }) => {
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

  const casePayload = {
    caseName: title,
    title,
    instruction,
    disbursements: draft.disbursements,
    invoiceMappings: draft.invoiceMappings || [],
    referenceDocuments: draft.referenceDocuments,
    publicVisible: false,
    visibleToUserIds: [uid],
    status: 'assigned',
    opensAt: null,
    dueAt: null,
    auditArea: recipeDetails?.auditArea || recipeMeta.auditArea || draft.auditArea,
    moduleId: moduleId,
    recipeVersion,
    moduleTitle,
    pathId: recipeDetails?.pathId || recipeMeta.pathId || '',
    tier: recipeDetails?.tier || recipeMeta.tier || 'foundations',
    primarySkill: recipeDetails?.primarySkill || recipeMeta.primarySkill || '',
    workflow: recipeDetails?.workflow || { steps: ['instruction', 'selection', 'testing', 'results'], gateScope: 'once' },
    generationConfig: recipeDetails?.generationConfig || {},
  };

  const caseId = await createCase(casePayload);

  if (draft.generationPlan) {
    try {
      await saveCaseGenerationPlan({ caseId, plan: draft.generationPlan });
      await queueCaseGenerationJob({ caseId, plan: draft.generationPlan, appId });
    } catch (error) {
      console.warn('[attemptService] Generation job failed', error);
    }
  }

  return caseId;
};
