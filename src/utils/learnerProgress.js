import { nullSafeDate } from './dates';

export const DEFAULT_PATH_ID = 'general';
export const DEFAULT_TIER = 'foundations';
export const TIER_ORDER = Object.freeze(['foundations', 'core', 'advanced']);
export const MODULE_LABELS = Object.freeze({
  payables: 'Accounts Payable',
  cash: 'Cash',
  fixed_assets: 'Fixed Assets',
});
const MODULE_KEY_ALIASES = Object.freeze({
  'accounts payable': 'payables',
  'accounts_payable': 'payables',
  'accounts-payable': 'payables',
  ap: 'payables',
  'fixed assets': 'fixed_assets',
  'fixed-assets': 'fixed_assets',
  fixed_assets: 'fixed_assets',
  cash: 'cash',
});

const normalizeModuleKey = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return '';
  if (MODULE_LABELS[trimmed]) return trimmed;
  const underscored = trimmed.replace(/[\s-]+/g, '_');
  if (MODULE_LABELS[underscored]) return underscored;
  if (MODULE_KEY_ALIASES[trimmed]) return MODULE_KEY_ALIASES[trimmed];
  if (MODULE_KEY_ALIASES[underscored]) return MODULE_KEY_ALIASES[underscored];
  return trimmed;
};

export const humanizeToken = (value = '') =>
  value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');

export const normalizeTier = (value) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return TIER_ORDER.includes(normalized) ? normalized : DEFAULT_TIER;
};

export const getProgramTier = (caseData) => {
  const rawPathId = typeof caseData?.pathId === 'string' ? caseData.pathId.trim().toLowerCase() : '';
  if (TIER_ORDER.includes(rawPathId)) return rawPathId;
  const rawTier = typeof caseData?.tier === 'string' ? caseData.tier.trim().toLowerCase() : '';
  if (TIER_ORDER.includes(rawTier)) return rawTier;
  return DEFAULT_TIER;
};

export const getPathId = (caseData) =>
  (typeof caseData?.pathId === 'string' && caseData.pathId.trim()) ||
  (typeof caseData?.auditArea === 'string' && caseData.auditArea.trim()) ||
  DEFAULT_PATH_ID;

export const getPathLabel = (pathId, pathTitle) => {
  if (typeof pathTitle === 'string' && pathTitle.trim()) return pathTitle.trim();
  return humanizeToken(pathId || DEFAULT_PATH_ID) || 'General';
};

export const getModuleLabel = (caseData) => {
  const rawArea = typeof caseData?.auditArea === 'string' ? caseData.auditArea.trim().toLowerCase() : '';
  if (!rawArea) return 'General';
  return MODULE_LABELS[rawArea] || humanizeToken(rawArea);
};

export const getSkillLabel = (caseData) =>
  caseData?.primarySkill || caseData?.moduleTitle || caseData?.title || caseData?.caseName || 'Skill';

export const getProgressUpdatedAtMs = (caseData) => {
  const progress = caseData?.progress;
  const activeAttemptUpdatedAt = nullSafeDate(progress?.activeAttempt?.updatedAt);
  const lastAttemptAt = nullSafeDate(progress?.lastAttemptAt);
  const updatedAt = nullSafeDate(progress?.updatedAt);
  const fallback = nullSafeDate(caseData?.updatedAt) || nullSafeDate(caseData?.createdAt);
  const date = activeAttemptUpdatedAt || lastAttemptAt || updatedAt || fallback;
  return date ? date.getTime() : 0;
};

export const hasMeaningfulDraft = (progress) => {
  if (!progress || typeof progress !== 'object') return false;
  if (progress.hasSuccessfulAttempt) return false;
  const activeAttempt = progress.activeAttempt;
  if (!activeAttempt || typeof activeAttempt !== 'object') return false;
  const draft = activeAttempt.draft;
  const hasDraftPayload = draft && typeof draft === 'object' && Object.keys(draft).length > 0;
  const hasStep = typeof activeAttempt.step === 'string' && activeAttempt.step.trim();
  const hasStartedAt = Boolean(activeAttempt.startedAt || activeAttempt.updatedAt);
  return hasDraftPayload || hasStep || hasStartedAt;
};

export const isModuleCompleted = (progress) => {
  if (typeof progress?.hasSuccessfulAttempt === 'boolean') {
    return progress.hasSuccessfulAttempt;
  }
  const percentComplete = Number(progress?.percentComplete || 0);
  const state = typeof progress?.state === 'string' ? progress.state.toLowerCase() : '';
  return state === 'submitted' || percentComplete >= 100;
};

const getModuleTitle = (caseData) =>
  caseData?.moduleTitle || caseData?.title || caseData?.caseName || 'Untitled module';

const getModuleIdForCase = (caseData) => caseData?.moduleId || caseData?.id || '';

const getModuleIdForRecipe = (recipe) => recipe?.moduleId || recipe?.id || '';

const getModuleKeyForRecipe = (recipe) => {
  const rawArea = normalizeModuleKey(recipe?.auditArea);
  if (rawArea) return rawArea;
  const moduleId = getModuleIdForRecipe(recipe);
  return normalizeModuleKey(moduleId);
};

const getModuleKeyForCase = (caseData) => {
  const rawArea = normalizeModuleKey(caseData?.auditArea);
  if (rawArea) return rawArea;
  const moduleTitle = normalizeModuleKey(caseData?.moduleTitle);
  if (moduleTitle && MODULE_LABELS[moduleTitle]) return moduleTitle;
  return '';
};

const resolveSkillDepth = (item) => {
  const rawLevel = typeof item?.caseLevel === 'string' ? item.caseLevel.trim().toLowerCase() : '';
  if (rawLevel === 'basic' || rawLevel === 'intermediate' || rawLevel === 'advanced') return rawLevel;
  const tier = normalizeTier(item?.tier);
  if (tier === 'core') return 'intermediate';
  if (tier === 'advanced') return 'advanced';
  return 'basic';
};

const getSkillBase = (item) => {
  if (typeof item?.primarySkill === 'string' && item.primarySkill.trim()) {
    return item.primarySkill.trim();
  }
  if (typeof item?.moduleTitle === 'string' && item.moduleTitle.trim()) {
    return item.moduleTitle.trim();
  }
  if (typeof item?.title === 'string' && item.title.trim()) {
    return item.title.trim();
  }
  if (typeof item?.caseName === 'string' && item.caseName.trim()) {
    return item.caseName.trim();
  }
  return '';
};

const getSkillKey = (item) => {
  const base = getSkillBase(item);
  const depth = resolveSkillDepth(item);
  if (base && depth) return `${base}::${depth}`;
  if (base) return base;
  return (
    item?.moduleId ||
    item?.recipeId ||
    item?.id ||
    (typeof item?.title === 'string' && item.title.trim()) ||
    ''
  );
};

const getRecipePathId = (recipe) => {
  if (typeof recipe?.pathId === 'string' && recipe.pathId.trim()) return recipe.pathId.trim();
  const rawArea = typeof recipe?.auditArea === 'string' ? recipe.auditArea.trim().toLowerCase() : '';
  if (rawArea && rawArea !== DEFAULT_PATH_ID) return 'foundations';
  return DEFAULT_PATH_ID;
};

const getModuleLabelForRecipe = (recipe) => {
  const rawArea = typeof recipe?.auditArea === 'string' ? recipe.auditArea.trim().toLowerCase() : '';
  if (rawArea && MODULE_LABELS[rawArea]) return MODULE_LABELS[rawArea];
  const moduleTitle = typeof recipe?.moduleTitle === 'string' ? recipe.moduleTitle.trim() : '';
  if (moduleTitle) return moduleTitle;
  const title = typeof recipe?.title === 'string' ? recipe.title.trim() : '';
  if (title) return title;
  return rawArea ? humanizeToken(rawArea) : 'General';
};

const getOrderIndex = (caseData) => {
  const value = Number(caseData?.orderIndex);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
};

const sortCasesForNext = (a, b) => {
  const aIndex = getOrderIndex(a);
  const bIndex = getOrderIndex(b);
  if (aIndex !== bIndex) return aIndex - bIndex;
  return getModuleTitle(a).localeCompare(getModuleTitle(b));
};

const createTierStats = () => ({
  foundations: { done: 0, total: 0 },
  core: { done: 0, total: 0 },
  advanced: { done: 0, total: 0 },
});

const createCurriculumTierMap = () => ({
  foundations: new Set(),
  core: new Set(),
  advanced: new Set(),
});

export const buildLearnerProgressView = ({ cases = [], recipes = [], selectedModuleId = null } = {}) => {
  const recipeByModuleId = new Map();
  recipes.forEach((recipe) => {
    const moduleId = getModuleIdForRecipe(recipe);
    if (!moduleId) return;
    recipeByModuleId.set(moduleId, recipe);
  });
  const resolveCaseModuleKey = (caseData) => {
    const direct = getModuleKeyForCase(caseData);
    if (direct) return direct;
    const moduleId = caseData?.moduleId || caseData?.recipeId || '';
    const recipe = moduleId ? recipeByModuleId.get(moduleId) : null;
    return recipe ? getModuleKeyForRecipe(recipe) : '';
  };
  const resolveSkillKeyForCase = (caseData) => {
    const moduleId = caseData?.moduleId || caseData?.recipeId || '';
    const recipe = moduleId ? recipeByModuleId.get(moduleId) : null;
    const base = recipe && recipe.primarySkill ? recipe.primarySkill : getSkillBase(caseData);
    const depth = resolveSkillDepth(recipe || caseData);
    if (base && depth) return `${base}::${depth}`;
    if (base) return base;
    return getSkillKey(caseData);
  };
  const moduleCompletionById = new Map();
  cases.forEach((caseData) => {
    const moduleId = getModuleIdForCase(caseData);
    if (!moduleId) return;
    if (isModuleCompleted(caseData.progress)) {
      moduleCompletionById.set(moduleId, true);
    }
  });

  const isRetakeAttempt = (caseData) => {
    const moduleId = getModuleIdForCase(caseData);
    if (!moduleId) return false;
    if (!moduleCompletionById.get(moduleId)) return false;
    return !isModuleCompleted(caseData.progress);
  };

  const primaryCases = cases.filter((caseData) => !isRetakeAttempt(caseData));
  const selectedModuleKey = normalizeModuleKey(selectedModuleId);
  const retakeCases = cases
    .filter((caseData) => isRetakeAttempt(caseData))
    .sort((a, b) => getProgressUpdatedAtMs(b) - getProgressUpdatedAtMs(a));

  const pickLatestCase = (candidates) => {
    if (candidates.length === 0) return null;
    return candidates.reduce((latest, current) => {
      if (!latest) return current;
      return getProgressUpdatedAtMs(current) > getProgressUpdatedAtMs(latest) ? current : latest;
    }, null);
  };

  const draftCase = (() => {
    const candidates = primaryCases.filter((caseData) => {
      if (!caseData?.progress) return false;
      if (isModuleCompleted(caseData.progress)) return false;
      return hasMeaningfulDraft(caseData.progress);
    });
    if (!selectedModuleKey) return pickLatestCase(candidates);
    const scopedCandidates = candidates.filter(
      (caseData) => resolveCaseModuleKey(caseData) === selectedModuleKey
    );
    return pickLatestCase(scopedCandidates);
  })();

  const assignedCases = primaryCases.filter((caseData) => {
    if (isModuleCompleted(caseData.progress)) return false;
    const status = typeof caseData?.status === 'string' ? caseData.status.toLowerCase() : '';
    return status === 'assigned' || status === 'in_progress' || status === 'draft';
  });

  const assignedCasesInModule = selectedModuleKey
    ? assignedCases.filter((caseData) => resolveCaseModuleKey(caseData) === selectedModuleKey)
    : assignedCases;

  const assignedNextCase = assignedCasesInModule
    .filter((caseData) => caseData.id !== draftCase?.id)
    .slice()
    .sort(sortCasesForNext)[0];

  const recipesByModuleKey = new Map();
  recipes.forEach((recipe) => {
    const moduleKey = getModuleKeyForRecipe(recipe);
    if (!moduleKey) return;
    const entries = recipesByModuleKey.get(moduleKey) || [];
    entries.push(recipe);
    recipesByModuleKey.set(moduleKey, entries);
  });

  const curriculumByPathTier = new Map();
  const addCurriculumModule = (pathId, tier, moduleId) => {
    if (!moduleId) return;
    const entry = curriculumByPathTier.get(pathId) || createCurriculumTierMap();
    entry[tier].add(moduleId);
    curriculumByPathTier.set(pathId, entry);
  };

  recipes.forEach((recipe) => {
    const moduleId = getModuleIdForRecipe(recipe);
    if (!moduleId) return;
    addCurriculumModule(getRecipePathId(recipe), normalizeTier(recipe?.tier), moduleId);
  });

  primaryCases.forEach((caseData) => {
    const moduleId = getModuleIdForCase(caseData);
    if (!moduleId) return;
    addCurriculumModule(getPathId(caseData), getProgramTier(caseData), moduleId);
  });

  const completionByPathTier = new Map();
  curriculumByPathTier.forEach((tierMap, pathId) => {
    const stats = createTierStats();
    TIER_ORDER.forEach((tier) => {
      const moduleIds = tierMap[tier] || new Set();
      stats[tier].total = moduleIds.size;
      moduleIds.forEach((moduleId) => {
        if (moduleCompletionById.get(moduleId)) {
          stats[tier].done += 1;
        }
      });
    });
    completionByPathTier.set(pathId, stats);
  });

  const getTierStatsForPath = (pathId) => completionByPathTier.get(pathId) || createTierStats();

  const isTierComplete = (stats, tier) => {
    const entry = stats[tier];
    if (!entry) return false;
    if (entry.total === 0) return false;
    return entry.done >= entry.total;
  };

  const isTierUnlocked = (pathId, tier) => {
    if (tier === 'foundations') return true;
    const stats = getTierStatsForPath(pathId);
    if (tier === 'core') return isTierComplete(stats, 'foundations');
    if (tier === 'advanced') return isTierComplete(stats, 'core');
    return false;
  };

  const eligibleCases = primaryCases.filter((caseData) => {
    if (isModuleCompleted(caseData.progress)) return false;
    const pathId = getPathId(caseData);
    const tier = getProgramTier(caseData);
    return isTierUnlocked(pathId, tier);
  });

  const getCurrentTierForPath = (pathId) => {
    const stats = getTierStatsForPath(pathId);
    const unlocked = TIER_ORDER.filter((tier) => isTierUnlocked(pathId, tier));
    for (const tier of unlocked) {
      const entry = stats[tier];
      if (entry.total > 0 && entry.done < entry.total) {
        return tier;
      }
    }
    if (unlocked.includes('advanced')) return 'advanced';
    if (unlocked.includes('core')) return 'core';
    return 'foundations';
  };

  const selectedModuleCases = selectedModuleKey
    ? primaryCases.filter((caseData) => resolveCaseModuleKey(caseData) === selectedModuleKey)
    : [];
  const selectedModuleRecipes = selectedModuleKey ? recipesByModuleKey.get(selectedModuleKey) || [] : [];
  const selectedModulePathId =
    (selectedModuleCases[0] && getPathId(selectedModuleCases[0])) ||
    (selectedModuleRecipes[0] && getRecipePathId(selectedModuleRecipes[0])) ||
    '';
  const fallbackRecipePathId = recipes.length > 0 ? getRecipePathId(recipes[0]) : '';
  const currentPathId =
    selectedModulePathId ||
    (draftCase && getPathId(draftCase)) ||
    (assignedNextCase && getPathId(assignedNextCase)) ||
    (eligibleCases[0] && getPathId(eligibleCases[0])) ||
    (primaryCases[0] && getPathId(primaryCases[0])) ||
    fallbackRecipePathId ||
    DEFAULT_PATH_ID;

  const currentTier =
    (draftCase && getProgramTier(draftCase)) ||
    (assignedNextCase && getProgramTier(assignedNextCase)) ||
    getCurrentTierForPath(currentPathId);

  const sourceModules = assignedNextCase
    ? assignedCases
    : eligibleCases.length > 0
    ? eligibleCases
    : primaryCases.filter((caseData) => !isModuleCompleted(caseData.progress));
  const moduleMap = new Map();
  sourceModules
    .filter((caseData) => getPathId(caseData) === currentPathId)
    .forEach((caseData) => {
      const moduleId = resolveCaseModuleKey(caseData);
      if (!moduleId) return;
      const updatedAtMs = getProgressUpdatedAtMs(caseData);
      const entry = moduleMap.get(moduleId);
      if (!entry || updatedAtMs > entry.updatedAtMs) {
        moduleMap.set(moduleId, {
          moduleId,
          label: getModuleLabel(caseData),
          description: caseData?.pathDescription || '',
          updatedAtMs,
        });
      }
    });

  recipes
    .filter((recipe) => getRecipePathId(recipe) === currentPathId)
    .forEach((recipe) => {
      const moduleId = getModuleKeyForRecipe(recipe);
      if (!moduleId || moduleMap.has(moduleId)) return;
      moduleMap.set(moduleId, {
        moduleId,
        label: getModuleLabelForRecipe(recipe),
        description: recipe?.pathDescription || '',
        updatedAtMs: 0,
      });
    });

  const moduleOptions = Array.from(moduleMap.values())
    .sort((a, b) => {
      if (b.updatedAtMs !== a.updatedAtMs) return b.updatedAtMs - a.updatedAtMs;
      return a.label.localeCompare(b.label);
    })
    .slice(0, 6)
    .map((entry) => ({
      value: entry.moduleId,
      label: entry.label,
      description: entry.description || '',
    }));

  const activeModuleId =
    moduleOptions.find((option) => option.value === selectedModuleId)?.value ||
    moduleOptions[0]?.value ||
    '';

  const eligibleInPath = eligibleCases.filter((caseData) => getPathId(caseData) === currentPathId);
  const activeModuleKey = selectedModuleKey || activeModuleId;
  const eligibleInModule = activeModuleKey
    ? eligibleInPath.filter((caseData) => resolveCaseModuleKey(caseData) === activeModuleKey)
    : eligibleInPath;
  const moduleScoped =
    selectedModuleKey
      ? eligibleInModule
      : eligibleInModule.length > 0
      ? eligibleInModule
      : eligibleInPath.filter((caseData) => getProgramTier(caseData) === currentTier);
  const recommendedCase = moduleScoped.length > 0 ? moduleScoped.sort(sortCasesForNext)[0] : null;

  const availableModulesAll = recipes.filter((recipe) => {
    const moduleId = getModuleIdForRecipe(recipe);
    if (!moduleId) return false;
    if (getRecipePathId(recipe) !== currentPathId) return false;
    return !moduleCompletionById.get(moduleId);
  });
  const preferredModuleKey = selectedModuleKey || activeModuleId;
  const availableModules =
    preferredModuleKey
      ? availableModulesAll.filter(
          (recipe) => getModuleKeyForRecipe(recipe) === preferredModuleKey
        )
      : [];
  const resolvedAvailableModules =
    availableModules.length > 0 ? availableModules : availableModulesAll;
  const preferredRecipe =
    resolvedAvailableModules.length > 0 ? resolvedAvailableModules[0] : null;
  const hasSelectedModuleContent =
    selectedModuleKey &&
    (selectedModuleCases.length > 0 || selectedModuleRecipes.length > 0);

  const currentAction = draftCase
    ? { type: 'resumeDraft', caseData: draftCase }
    : assignedNextCase
    ? { type: 'assigned', caseData: assignedNextCase }
    : recommendedCase
    ? { type: 'recommended', caseData: recommendedCase }
    : hasSelectedModuleContent && preferredRecipe
    ? { type: 'startModule', recipe: preferredRecipe }
    : selectedModuleKey && !hasSelectedModuleContent
    ? { type: 'emptyModule', moduleId: selectedModuleKey }
    : null;

  const heroCase = currentAction?.caseData || null;
  const heroRecipe = currentAction?.recipe || null;
  const skillProgress = (() => {
    const heroBase = getSkillBase(heroCase || heroRecipe);
    if (!heroBase) return null;
    const heroModuleKey = heroCase ? resolveCaseModuleKey(heroCase) : getModuleKeyForRecipe(heroRecipe);
    if (!heroModuleKey) return null;

    const moduleCases = primaryCases.filter(
      (caseData) => resolveCaseModuleKey(caseData) === heroModuleKey
    );
    const completedSkillKeys = new Set();
    const caseSkillKeys = new Set();
    moduleCases.forEach((caseData) => {
      const key = resolveSkillKeyForCase(caseData);
      if (!key) return;
      caseSkillKeys.add(key);
      if (isModuleCompleted(caseData.progress)) {
        completedSkillKeys.add(key);
      }
    });

    const moduleRecipes = recipesByModuleKey.get(heroModuleKey) || [];
    const recipeSkillKeys = new Set(
      moduleRecipes.map((recipe) => getSkillKey(recipe)).filter(Boolean)
    );
    const skillKeySource = recipeSkillKeys.size > 0 ? recipeSkillKeys : caseSkillKeys;
    if (skillKeySource.size === 0) return null;

    const matchesBase = (key) => key === heroBase || key.startsWith(`${heroBase}::`);
    const total = Array.from(skillKeySource).filter(matchesBase).length;
    if (total === 0) return null;
    const done = Array.from(completedSkillKeys).filter(matchesBase).length;
    return { label: heroBase, done, total };
  })();
  const pathTierStats = getTierStatsForPath(currentPathId);
  const actionTier = currentAction?.caseData ? getProgramTier(currentAction.caseData) : null;
  const activeProgramTier = actionTier || getCurrentTierForPath(currentPathId);
  const programTierStates = {};
  TIER_ORDER.forEach((tier) => {
    const stats = pathTierStats[tier];
    const completed = isTierComplete(pathTierStats, tier);
    const eligible = isTierUnlocked(currentPathId, tier);
    const status = completed ? 'completed' : activeProgramTier === tier ? 'active' : 'upcoming';
    programTierStates[tier] = {
      status,
      completed,
      eligible,
      done: stats.done,
      total: stats.total,
    };
  });

  const moduleJourney = Object.entries(MODULE_LABELS).map(([moduleId, label]) => {
    const moduleCases = primaryCases.filter((caseData) => resolveCaseModuleKey(caseData) === moduleId);
    const fallbackRecipes = recipesByModuleKey.get(moduleId) || [];
    const recipeSkillIds = new Set(
      fallbackRecipes.map((recipe) => getSkillKey(recipe)).filter(Boolean)
    );
    const caseSkillIds = new Set();
    const completedSkillIds = new Set();
    moduleCases.forEach((caseData) => {
      const caseSkillId = resolveSkillKeyForCase(caseData);
      if (!caseSkillId) return;
      caseSkillIds.add(caseSkillId);
      if (isModuleCompleted(caseData.progress)) {
        completedSkillIds.add(caseSkillId);
      }
    });
    const skillIdSource = recipeSkillIds.size > 0 ? recipeSkillIds : caseSkillIds;
    const totalSkills = skillIdSource.size;
    const completedSkills =
      skillIdSource.size > 0
        ? Array.from(completedSkillIds).filter((skillId) => skillIdSource.has(skillId)).length
        : completedSkillIds.size;
    const progressPercent =
      totalSkills > 0 ? Math.round((completedSkills / totalSkills) * 100) : 0;

    const nextCase = moduleCases
      .filter((caseData) => !isModuleCompleted(caseData.progress))
      .sort(sortCasesForNext)[0];
    const fallbackSkill =
      !nextCase && fallbackRecipes.length > 0
        ? fallbackRecipes[0]?.primarySkill ||
          fallbackRecipes[0]?.title ||
          fallbackRecipes[0]?.moduleTitle ||
          ''
        : '';
    const nextSkillLabel = nextCase ? getSkillLabel(nextCase) : fallbackSkill;

    return {
      moduleId,
      label,
      totalSkills,
      completedSkills,
      progressPercent,
      nextSkillLabel,
    };
  });

  return {
    primaryCases,
    retakeCases,
    moduleCompletionById,
    draftCase,
    assignedCases,
    eligibleCases,
    currentPathId,
    currentTier,
    moduleOptions,
    activeModuleId,
    recommendedCase,
    currentAction,
    heroCase,
    heroRecipe,
    skillProgress,
    programPath: {
      pathId: currentPathId,
      tierStats: pathTierStats,
      tierStates: programTierStates,
      activeTier: activeProgramTier,
    },
    moduleJourney,
    availableModules: resolvedAvailableModules,
  };
};
