import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Button, useRoute, useModal, useAuth, appId } from '../AppCore';
import { listStudentCases, deleteRetakeAttempt } from '../services/caseService';
import { listRecipes } from '../services/recipeService';
import { listCaseRecipes } from '../generation/recipeRegistry';
import { subscribeProgressForCases, saveProgress } from '../services/progressService';
import { generateAttemptFromRecipe } from '../services/attemptService';
import { nullSafeDate, getNow } from '../utils/dates';
import { toProgressModel } from '../models/progress';

/** @typedef {import('../models/case').CaseModel} CaseModel */
/** @typedef {import('../models/progress').ProgressModel} ProgressModel */

const PAGE_SIZE = 20;

const TIER_ORDER = Object.freeze(['foundations', 'core', 'advanced']);
const TIER_LABELS = Object.freeze({
  foundations: 'Foundations',
  core: 'Core',
  advanced: 'Expert',
});
const MODULE_TIER_ORDER = Object.freeze(['basic', 'intermediate', 'advanced']);
const MODULE_TIER_LABELS = Object.freeze({
  basic: 'Basics',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
});
const MODULE_LABELS = Object.freeze({
  payables: 'Accounts Payable',
  cash: 'Cash',
  fixed_assets: 'Fixed Assets',
});
const JOURNEY_STEPS = Object.freeze([
  { key: 'foundations', label: 'Foundations' },
  { key: 'core', label: 'Core' },
  { key: 'advanced', label: 'Expert' },
]);

const mapCaseLevelToTier = (caseLevel) => {
  const normalized = typeof caseLevel === 'string' ? caseLevel.trim().toLowerCase() : '';
  if (normalized === 'basic') return 'foundations';
  if (normalized === 'intermediate') return 'core';
  if (normalized === 'advanced') return 'advanced';
  return '';
};
const DEFAULT_PATH_ID = 'general';
const DEFAULT_TIER = 'foundations';

const humanizeToken = (value = '') =>
  value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');

const normalizeTier = (value) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return TIER_ORDER.includes(normalized) ? normalized : DEFAULT_TIER;
};

const formatTier = (tier) => TIER_LABELS[normalizeTier(tier)] || TIER_LABELS[DEFAULT_TIER];

const normalizeModuleTier = (caseData) => {
  const level = typeof caseData?.caseLevel === 'string' ? caseData.caseLevel.trim().toLowerCase() : '';
  if (level === 'basic') return 'basic';
  if (level === 'intermediate') return 'intermediate';
  if (level === 'advanced') return 'advanced';
  const tier = normalizeTier(caseData?.tier);
  if (tier === 'core') return 'intermediate';
  if (tier === 'advanced') return 'advanced';
  return 'basic';
};

const formatModuleTier = (tier) => MODULE_TIER_LABELS[tier] || MODULE_TIER_LABELS.basic;

const getPathId = (caseData) =>
  (typeof caseData?.pathId === 'string' && caseData.pathId.trim()) ||
  (typeof caseData?.auditArea === 'string' && caseData.auditArea.trim()) ||
  DEFAULT_PATH_ID;

const getPathLabel = (pathId, pathTitle) => {
  if (typeof pathTitle === 'string' && pathTitle.trim()) return pathTitle.trim();
  return humanizeToken(pathId || DEFAULT_PATH_ID) || 'General';
};

const getModuleTitle = (caseData) =>
  caseData?.moduleTitle || caseData?.title || caseData?.caseName || 'Untitled module';

const getModuleLabel = (caseData) => {
  const rawArea = typeof caseData?.auditArea === 'string' ? caseData.auditArea.trim().toLowerCase() : '';
  if (!rawArea) return 'General';
  return MODULE_LABELS[rawArea] || humanizeToken(rawArea);
};

const getSkillLabel = (caseData) =>
  caseData?.primarySkill || caseData?.moduleTitle || caseData?.title || 'Skill';

const formatCaseLevel = (value) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'basic') return 'Basics';
  if (normalized === 'intermediate') return 'Intermediate';
  if (normalized === 'advanced') return 'Advanced';
  return 'Basics';
};

const getModuleSkills = (caseData) => {
  const skills = [];
  if (typeof caseData?.primarySkill === 'string' && caseData.primarySkill.trim()) {
    skills.push(caseData.primarySkill.trim());
  }
  if (Array.isArray(caseData?.secondarySkills)) {
    caseData.secondarySkills.forEach((skill) => {
      if (typeof skill === 'string' && skill.trim()) {
        skills.push(skill.trim());
      }
    });
  }
  return skills.slice(0, 3);
};

const resolveCaseLevelLabel = (caseData, codedMap) => {
  if (typeof caseData?.caseLevel === 'string' && caseData.caseLevel.trim()) {
    return formatCaseLevel(caseData.caseLevel);
  }
  const moduleId = caseData?.moduleId || caseData?.id;
  const coded = moduleId ? codedMap.get(moduleId) : null;
  if (coded?.caseLevel) {
    return formatCaseLevel(coded.caseLevel);
  }
  const tier = normalizeTier(caseData?.tier);
  if (tier === 'core') return 'Intermediate';
  if (tier === 'advanced') return 'Advanced';
  return 'Basics';
};

const isRecipeConfigured = (recipe) => {
  const instruction = recipe?.instruction || {};
  const gateOptions = Array.isArray(instruction?.gateCheck?.options)
    ? instruction.gateCheck.options
    : [];
  const hasGateQuestion = typeof instruction?.gateCheck?.question === 'string' && instruction.gateCheck.question.trim();
  const hasCorrectOption = gateOptions.some((opt) => opt && (opt.correct || opt.isCorrect));
  const hasVideo =
    typeof instruction?.visualAsset?.source_id === 'string'
      ? instruction.visualAsset.source_id.trim()
      : typeof instruction?.visualAsset?.url === 'string'
      ? instruction.visualAsset.url.trim()
      : '';
  return Boolean(hasGateQuestion && gateOptions.length > 0 && hasCorrectOption && hasVideo);
};

const getProgressUpdatedAtMs = (caseData) => {
  const progress = caseData?.progress;
  const activeAttemptUpdatedAt = nullSafeDate(progress?.activeAttempt?.updatedAt);
  const lastAttemptAt = nullSafeDate(progress?.lastAttemptAt);
  const updatedAt = nullSafeDate(progress?.updatedAt);
  const fallback = nullSafeDate(caseData?.updatedAt) || nullSafeDate(caseData?.createdAt);
  const date = activeAttemptUpdatedAt || lastAttemptAt || updatedAt || fallback;
  return date ? date.getTime() : 0;
};

const formatRelativeDate = (date, now) => {
  if (!date) return 'Unknown';
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((startOfToday - startOfDate) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const formatMinutes = (minutes) => {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return '';
  return `${Math.round(value)} min`;
};

const hasMeaningfulDraft = (progress) => {
  if (!progress || typeof progress !== 'object') return false;
  if (progress.hasSuccessfulAttempt) return false;
  const activeAttempt = progress.activeAttempt;
  if (!activeAttempt || typeof activeAttempt !== 'object') return false;
  const draft = activeAttempt.draft;
  const hasDraftPayload =
    draft && typeof draft === 'object' && Object.keys(draft).length > 0;
  const hasStep = typeof activeAttempt.step === 'string' && activeAttempt.step.trim();
  const hasStartedAt = Boolean(activeAttempt.startedAt || activeAttempt.updatedAt);
  return hasDraftPayload || hasStep || hasStartedAt;
};

const isModuleCompleted = (progress) => {
  if (typeof progress?.hasSuccessfulAttempt === 'boolean') {
    return progress.hasSuccessfulAttempt;
  }
  const percentComplete = Number(progress?.percentComplete || 0);
  const state = typeof progress?.state === 'string' ? progress.state.toLowerCase() : '';
  return state === 'submitted' || percentComplete >= 100;
};

export default function TraineeDashboardPage() {
  const { navigate } = useRoute();
  const { userId } = useAuth();
  const { showModal, hideModal } = useModal();
  const showModalRef = useRef(showModal);

  useEffect(() => {
    showModalRef.current = showModal;
  }, [showModal]);

  /** @type {[CaseModel[], React.Dispatch<React.SetStateAction<CaseModel[]>>]} */
  const [cases, setCases] = useState([]);
  /** @type {[Map<string, ProgressModel>, React.Dispatch<React.SetStateAction<Map<string, ProgressModel>>>]} */
  const [progress, setProgress] = useState(new Map());
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [error, setError] = useState('');
  const [selectedModuleId, setSelectedModuleId] = useState(null);
  const [recipes, setRecipes] = useState([]);
  const [recipesLoading, setRecipesLoading] = useState(false);
  const [startingModuleId, setStartingModuleId] = useState('');
  const [deletingRetakeIds, setDeletingRetakeIds] = useState(() => new Set());

  const fetchCases = useCallback(async () => {
    if (!userId) return;
    try {
      setLoading(true);
      setCases([]);
      setInitialLoad(true);

      if (process.env.NODE_ENV !== 'production') {
        console.info('[dashboard] fetch start', {
          uid: userId,
        });
      }

      let next = null;
      const collected = [];
      const seenCursors = new Set();
      let pageCount = 0;
      const maxPages = 50;

      while (pageCount < maxPages) {
        const result = await listStudentCases({
          appId,
          uid: userId,
          pageSize: PAGE_SIZE,
          cursor: next || undefined,
          sortBy: 'title',
          includeOpensAtGate: false,
        });

        if (!result || !Array.isArray(result.items)) {
          if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
            console.warn('[dashboard] unexpected listStudentCases payload', result);
          }
        }

        const items = Array.isArray(result?.items) ? result.items : [];
        collected.push(...items);

        if (!result?.nextCursor || items.length === 0) {
          next = null;
          break;
        }

        const cursorKey = JSON.stringify(result.nextCursor);
        if (seenCursors.has(cursorKey)) {
          next = null;
          break;
        }
        seenCursors.add(cursorKey);
        next = result.nextCursor;
        pageCount += 1;
      }

      if (process.env.NODE_ENV !== 'production') {
        if (pageCount >= maxPages) {
          console.warn('[dashboard] fetch reached page cap', { count: collected.length });
        } else {
          console.info('[dashboard] fetch success', { count: collected.length });
        }
      }

      setCases(collected);
      setError('');
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.error('Error fetching cases for trainee:', err);
      }
      const message = err?.message || 'Unable to load cases.';
      setError(message);
      setCases([]);
      const modal = showModalRef.current;
      if (modal) modal(message, 'Error');
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setInitialLoad(false);
      return;
    }
    fetchCases();
  }, [userId, fetchCases]);

  useEffect(() => {
    if (!userId) return;
    let isActive = true;
    const loadRecipes = async () => {
      try {
        setRecipesLoading(true);
        const items = await listRecipes({ pageSize: 25 });
        if (!isActive) return;
        const active = items.filter((recipe) => recipe.isActive && isRecipeConfigured(recipe));
        setRecipes(active);
      } catch (err) {
        console.error('Error loading recipes:', err);
      } finally {
        if (isActive) setRecipesLoading(false);
      }
    };
    loadRecipes();
    return () => {
      isActive = false;
    };
  }, [userId]);

  const caseIds = useMemo(() => cases.map((c) => c.id), [cases]);

  useEffect(() => {
    if (!userId || caseIds.length === 0) {
      setProgress(new Map());
      return;
    }

    const unsubscribe = subscribeProgressForCases(
      { appId, uid: userId, caseIds },
      (progressMap) => {
        setProgress(progressMap);
      },
      (err) => {
        console.error('Error subscribing to progress:', err);
      }
    );

    return () => unsubscribe();
  }, [userId, caseIds]);

  const recipeByModuleId = useMemo(() => {
    const map = new Map();
    recipes.forEach((recipe) => {
      const key = recipe?.moduleId || recipe?.id;
      if (!key) return;
      map.set(key, recipe);
    });
    return map;
  }, [recipes]);

  const codedRecipeById = useMemo(() => {
    const map = new Map();
    listCaseRecipes().forEach((recipe) => {
      if (!recipe?.id) return;
      map.set(recipe.id, recipe);
    });
    return map;
  }, []);

  const casesWithProgress = useMemo(() => {
    return cases.map((caseData) => {
      const recipeMeta = caseData?.moduleId ? recipeByModuleId.get(caseData.moduleId) : null;
      const fallbackTier = mapCaseLevelToTier(caseData?.caseLevel);
      const fallbackPathId =
        caseData?.auditArea && String(caseData.auditArea).trim().toLowerCase() !== 'general'
          ? 'foundations'
          : '';
      const resolvedCase = recipeMeta
        ? {
            ...caseData,
            pathId:
              (typeof recipeMeta?.pathId === 'string' && recipeMeta.pathId.trim()) ||
              (typeof caseData?.pathId === 'string' && caseData.pathId.trim()) ||
              caseData?.pathId,
            pathTitle:
              (typeof recipeMeta?.pathTitle === 'string' && recipeMeta.pathTitle.trim()) ||
              (typeof caseData?.pathTitle === 'string' && caseData.pathTitle.trim()) ||
              caseData?.pathTitle ||
              '',
            pathDescription:
              (typeof recipeMeta?.pathDescription === 'string' && recipeMeta.pathDescription.trim()) ||
              (typeof caseData?.pathDescription === 'string' && caseData.pathDescription.trim()) ||
              caseData?.pathDescription ||
              '',
            tier:
              (typeof recipeMeta?.tier === 'string' && recipeMeta.tier.trim()) ||
              (typeof caseData?.tier === 'string' && caseData.tier.trim()) ||
              caseData?.tier,
            moduleTitle:
              (typeof recipeMeta?.moduleTitle === 'string' && recipeMeta.moduleTitle.trim()) ||
              (typeof recipeMeta?.title === 'string' && recipeMeta.title.trim()) ||
              (typeof caseData?.moduleTitle === 'string' && caseData.moduleTitle.trim()) ||
              caseData?.moduleTitle ||
              '',
            primarySkill:
              (typeof recipeMeta?.primarySkill === 'string' && recipeMeta.primarySkill.trim()) ||
              (typeof caseData?.primarySkill === 'string' && caseData.primarySkill.trim()) ||
              caseData?.primarySkill ||
              '',
            secondarySkills:
              Array.isArray(recipeMeta?.secondarySkills) && recipeMeta.secondarySkills.length > 0
                ? recipeMeta.secondarySkills
                : Array.isArray(caseData?.secondarySkills) && caseData.secondarySkills.length > 0
                ? caseData.secondarySkills
                : caseData?.secondarySkills || [],
          }
        : caseData;

      const normalizedCase = {
        ...resolvedCase,
        pathId:
          (typeof resolvedCase?.pathId === 'string' && resolvedCase.pathId.trim() && resolvedCase.pathId.trim() !== 'general')
            ? resolvedCase.pathId.trim()
            : fallbackPathId || resolvedCase?.pathId || DEFAULT_PATH_ID,
        pathTitle:
          (typeof resolvedCase?.pathTitle === 'string' && resolvedCase.pathTitle.trim())
            ? resolvedCase.pathTitle.trim()
            : fallbackPathId
            ? 'Foundations'
            : resolvedCase?.pathTitle || '',
        tier:
          (typeof resolvedCase?.tier === 'string' && resolvedCase.tier.trim())
            ? resolvedCase.tier.trim().toLowerCase()
            : fallbackTier || resolvedCase?.tier,
      };

      return {
        ...normalizedCase,
        progress: progress.get(caseData.id) || toProgressModel(null, caseData.id),
      };
    });
  }, [cases, progress, recipeByModuleId]);

  const moduleCompletionById = useMemo(() => {
    const map = new Map();
    casesWithProgress.forEach((caseData) => {
      const moduleId = caseData?.moduleId;
      if (!moduleId) return;
      if (isModuleCompleted(caseData.progress)) {
        map.set(moduleId, true);
      }
    });
    return map;
  }, [casesWithProgress]);

  const isRetakeAttempt = useCallback(
    (caseData) => {
      const moduleId = caseData?.moduleId;
      if (!moduleId) return false;
      if (!moduleCompletionById.get(moduleId)) return false;
      return !isModuleCompleted(caseData.progress);
    },
    [moduleCompletionById]
  );

  const primaryCases = useMemo(
    () => casesWithProgress.filter((caseData) => !isRetakeAttempt(caseData)),
    [casesWithProgress, isRetakeAttempt]
  );

  const completionByPathTier = useMemo(() => {
    const summary = new Map();
    primaryCases.forEach((caseData) => {
      const pathId = getPathId(caseData);
      const tier = normalizeTier(caseData?.tier);
      const entry = summary.get(pathId) || {
        foundations: { done: 0, total: 0 },
        core: { done: 0, total: 0 },
        advanced: { done: 0, total: 0 },
      };
      entry[tier].total += 1;
      if (isModuleCompleted(caseData.progress)) {
        entry[tier].done += 1;
      }
      summary.set(pathId, entry);
    });
    return summary;
  }, [primaryCases]);

  const now = useMemo(() => getNow().date, []);

  const getTierStatsForPath = useCallback(
    (pathId) =>
      completionByPathTier.get(pathId) || {
        foundations: { done: 0, total: 0 },
        core: { done: 0, total: 0 },
        advanced: { done: 0, total: 0 },
      },
    [completionByPathTier]
  );

  const isTierComplete = useCallback((stats, tier) => {
    const entry = stats[tier];
    if (!entry) return false;
    if (entry.total === 0) return false;
    return entry.done >= entry.total;
  }, []);

  const isTierUnlocked = useCallback(
    (pathId, tier) => {
      if (tier === 'foundations') return true;
      const stats = getTierStatsForPath(pathId);
      if (tier === 'core') return isTierComplete(stats, 'foundations');
      if (tier === 'advanced') return isTierComplete(stats, 'core');
      return false;
    },
    [getTierStatsForPath, isTierComplete]
  );

  const getCurrentTierForPath = useCallback(
    (pathId) => {
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
    },
    [getTierStatsForPath, isTierUnlocked]
  );

  const eligibleModules = useMemo(() => {
    return primaryCases.filter((caseData) => {
      if (isModuleCompleted(caseData.progress)) return false;
      const pathId = getPathId(caseData);
      const tier = normalizeTier(caseData?.tier);
      return isTierUnlocked(pathId, tier);
    });
  }, [primaryCases, isTierUnlocked]);

  const draftCase = useMemo(() => {
    const candidates = primaryCases.filter((caseData) => {
      if (!caseData?.progress) return false;
      if (isModuleCompleted(caseData.progress)) return false;
      return hasMeaningfulDraft(caseData.progress);
    });
    if (candidates.length === 0) return null;
    return candidates.reduce((latest, current) => {
      if (!latest) return current;
      return getProgressUpdatedAtMs(current) > getProgressUpdatedAtMs(latest) ? current : latest;
    }, null);
  }, [primaryCases]);


  const currentPathId = useMemo(() => {
    if (draftCase) return getPathId(draftCase);
    if (eligibleModules.length > 0) return getPathId(eligibleModules[0]);
    if (primaryCases.length > 0) return getPathId(primaryCases[0]);
    return DEFAULT_PATH_ID;
  }, [draftCase, eligibleModules, primaryCases]);

  const currentTier = useMemo(() => {
    if (draftCase) return normalizeTier(draftCase?.tier);
    return getCurrentTierForPath(currentPathId);
  }, [currentPathId, getCurrentTierForPath, draftCase]);

  const moduleOptions = useMemo(() => {
    const sourceModules =
      eligibleModules.length > 0
        ? eligibleModules
        : primaryCases.filter((caseData) => !isModuleCompleted(caseData.progress));
    const moduleMap = new Map();

    sourceModules
      .filter(
        (caseData) =>
          getPathId(caseData) === currentPathId && normalizeTier(caseData?.tier) === currentTier
      )
      .forEach((caseData) => {
        const moduleId = (caseData?.auditArea || '').toLowerCase();
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

    const ordered = Array.from(moduleMap.values()).sort((a, b) => {
      if (b.updatedAtMs !== a.updatedAtMs) return b.updatedAtMs - a.updatedAtMs;
      return a.label.localeCompare(b.label);
    });

    return ordered.slice(0, 6).map((entry) => ({
      value: entry.moduleId,
      label: entry.label,
      description: entry.description || '',
    }));
  }, [currentPathId, currentTier, eligibleModules, primaryCases]);

  useEffect(() => {
    if (!selectedModuleId) return;
    const stillValid = moduleOptions.some((option) => option.value === selectedModuleId);
    if (!stillValid) setSelectedModuleId(null);
  }, [moduleOptions, selectedModuleId]);

  const recommendedCase = useMemo(() => {
    const activeModuleId = selectedModuleId || moduleOptions[0]?.value || '';
    const sortedModules = eligibleModules
      .filter((caseData) => {
        if (getPathId(caseData) !== currentPathId) return false;
        if (normalizeTier(caseData?.tier) !== currentTier) return false;
        if (!activeModuleId) return true;
        return (caseData?.auditArea || '').toLowerCase() === activeModuleId;
      })
      .sort((a, b) => {
        const aIndex = Number(a?.orderIndex ?? Number.POSITIVE_INFINITY);
        const bIndex = Number(b?.orderIndex ?? Number.POSITIVE_INFINITY);
        if (aIndex !== bIndex) return aIndex - bIndex;
        return getModuleTitle(a).localeCompare(getModuleTitle(b));
      });

    return sortedModules[0] || null;
  }, [eligibleModules, currentPathId, currentTier, moduleOptions, selectedModuleId]);

  const heroCase = draftCase || recommendedCase;
  const heroMode = draftCase ? 'resume' : 'continue';
  const heroPathId = heroCase ? getPathId(heroCase) : currentPathId;
  const heroTier = normalizeTier(heroCase?.tier || currentTier);
  const heroPathLabel = heroCase ? getPathLabel(heroPathId, heroCase?.pathTitle) : getPathLabel(heroPathId, '');
  const heroSkills = heroCase ? getModuleSkills(heroCase) : [];

  const currentFocusCase = heroCase;
  const currentPathLabel = currentFocusCase
    ? getPathLabel(currentPathId, currentFocusCase?.pathTitle)
    : getPathLabel(currentPathId, '');
  const moduleLabelFromOptions =
    moduleOptions.find((option) => option.value === selectedModuleId)?.label ||
    moduleOptions[0]?.label ||
    'General';
  const currentModuleLabel = currentFocusCase
    ? getModuleLabel(currentFocusCase) === 'General'
      ? moduleLabelFromOptions
      : getModuleLabel(currentFocusCase)
    : moduleLabelFromOptions;

  const shouldShowFocusSkills = heroSkills.length > 0 && Boolean(heroCase);

  const highestTierWithModules = useMemo(() => {
    const tiersWithModules = new Set();
    primaryCases.forEach((caseData) => {
      if (getPathId(caseData) !== currentPathId) return;
      const tier = normalizeTier(caseData?.tier);
      tiersWithModules.add(tier);
    });
    for (let i = TIER_ORDER.length - 1; i >= 0; i -= 1) {
      if (tiersWithModules.has(TIER_ORDER[i])) {
        return TIER_ORDER[i];
      }
    }
    return 'foundations';
  }, [currentPathId, primaryCases]);

  const journeyTier = highestTierWithModules === 'foundations' ? 'foundations' : currentTier;

  const getJourneyStepState = (stepKey) => {
    const currentIndex = TIER_ORDER.indexOf(journeyTier);
    const stepIndex = TIER_ORDER.indexOf(stepKey);
    if (stepIndex === -1) return 'upcoming';
    if (currentIndex === -1) {
      return stepKey === 'foundations' ? 'active' : 'upcoming';
    }
    if (stepIndex < currentIndex) return 'completed';
    if (stepIndex === currentIndex) return 'active';
    return 'upcoming';
  };

  const moduleJourney = useMemo(() => {
    const currentModuleId = (currentFocusCase?.auditArea || '').toLowerCase();
    return Object.entries(MODULE_LABELS).map(([moduleId, label]) => {
      const moduleCases = primaryCases.filter(
        (caseData) => (caseData?.auditArea || '').toLowerCase() === moduleId
      );
      const tierStats = {
        basic: { done: 0, total: 0 },
        intermediate: { done: 0, total: 0 },
        advanced: { done: 0, total: 0 },
      };
      moduleCases.forEach((caseData) => {
        const tierKey = normalizeModuleTier(caseData);
        tierStats[tierKey].total += 1;
        if (isModuleCompleted(caseData.progress)) {
          tierStats[tierKey].done += 1;
        }
      });

      const basicsAssigned = tierStats.basic.total > 0;
      const intermediateAssigned = tierStats.intermediate.total > 0;
      const advancedAssigned = tierStats.advanced.total > 0;
      const totalCases = Object.values(tierStats).reduce((sum, entry) => sum + entry.total, 0);
      const basicsComplete = basicsAssigned && tierStats.basic.done >= tierStats.basic.total;
      const intermediateComplete =
        intermediateAssigned && tierStats.intermediate.done >= tierStats.intermediate.total;
      const advancedComplete = advancedAssigned && tierStats.advanced.done >= tierStats.advanced.total;
      const intermediateUnlocked = basicsComplete;
      const advancedUnlocked = intermediateComplete;
      const tierUnlocked = {
        basic: true,
        intermediate: intermediateUnlocked,
        advanced: advancedUnlocked,
      };

      const currentTierKey =
        MODULE_TIER_ORDER.find((tierKey) => {
          const stats = tierStats[tierKey];
          if (!tierUnlocked[tierKey]) return false;
          return stats.total > 0 && stats.done < stats.total;
        }) || '';

      const moduleCompleted = advancedAssigned && advancedComplete;
      const lockedByPrereq =
        (intermediateAssigned && !basicsComplete) ||
        (advancedAssigned && !intermediateComplete);
      const lockedMessage = lockedByPrereq
        ? intermediateAssigned && !basicsComplete
          ? 'Complete Basics to unlock Intermediate.'
          : advancedAssigned && !intermediateComplete
          ? 'Complete Intermediate to unlock Advanced.'
          : ''
        : '';
      const statusType = lockedByPrereq
        ? 'locked'
        : moduleCompleted
        ? 'completed'
        : totalCases === 0
        ? 'waiting'
        : currentTierKey
        ? 'in_progress'
        : 'ready';

      const completedTierIndex = (() => {
        if (advancedComplete) return 2;
        if (intermediateComplete) return 1;
        if (basicsComplete) return 0;
        return -1;
      })();
      const nextTierKey =
        currentTierKey
          ? ''
          : completedTierIndex < MODULE_TIER_ORDER.length - 1
          ? MODULE_TIER_ORDER[completedTierIndex + 1]
          : '';
      const tierChipLabel = moduleCompleted
        ? `${MODULE_TIER_LABELS.advanced} (completed)`
        : currentTierKey
        ? `Current: ${formatModuleTier(currentTierKey)}`
        : nextTierKey
        ? `Next: ${formatModuleTier(nextTierKey)}`
        : `Next: ${MODULE_TIER_LABELS.basic}`;

      const tierStates = {
        basic: !tierUnlocked.basic
          ? 'locked'
          : basicsComplete
          ? 'completed'
          : currentTierKey === 'basic'
          ? 'current'
          : nextTierKey === 'basic'
          ? 'next'
          : 'upcoming',
        intermediate: !tierUnlocked.intermediate
          ? 'locked'
          : intermediateComplete
          ? 'completed'
          : currentTierKey === 'intermediate'
          ? 'current'
          : nextTierKey === 'intermediate'
          ? 'next'
          : 'upcoming',
        advanced: !tierUnlocked.advanced
          ? 'locked'
          : advancedComplete
          ? 'completed'
          : currentTierKey === 'advanced'
          ? 'current'
          : nextTierKey === 'advanced'
          ? 'next'
          : 'upcoming',
      };

      const tierProgressPercent = Math.round(
        ((completedTierIndex + 1) / MODULE_TIER_ORDER.length) * 100
      );
      const completedTierCount = Math.max(completedTierIndex + 1, 0);

      const currentTierStats = currentTierKey ? tierStats[currentTierKey] : null;
      const lastCompletedTierKey =
        completedTierIndex >= 0 ? MODULE_TIER_ORDER[completedTierIndex] : '';
      const lastCompletedTierStats = lastCompletedTierKey ? tierStats[lastCompletedTierKey] : null;

      return {
        moduleId,
        label,
        statusType,
        lockedMessage,
        tierChipLabel,
        tierStates,
        tierProgressPercent,
        completedTierCount,
        totalCases,
        currentTierKey,
        currentTierStats,
        lastCompletedTierKey,
        lastCompletedTierStats,
        isActiveModule: currentModuleId === moduleId,
      };
    });
  }, [currentFocusCase, primaryCases]);

  const handleChooseDifferent = () => {
    const options = eligibleModules.filter((caseData) => caseData.id !== heroCase?.id);
    const modal = showModalRef.current;
    if (!modal) return;
    if (options.length === 0) {
      modal('No other cases are available right now.', 'Choose a different case');
      return;
    }
    const orderedOptions = heroCase
      ? [
          ...options.filter(
            (caseData) =>
              getPathId(caseData) === heroPathId && normalizeTier(caseData?.tier) === heroTier
          ),
          ...options.filter(
            (caseData) =>
              getPathId(caseData) === heroPathId && normalizeTier(caseData?.tier) !== heroTier
          ),
          ...options.filter((caseData) => getPathId(caseData) !== heroPathId),
        ]
      : options;
    modal(
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        <p className="text-sm text-gray-600">
          {heroMode === 'resume'
            ? 'Pick another case to work on now. Your draft stays saved.'
            : 'Pick another case to work on now.'}
        </p>
        <div className="space-y-3">
          {orderedOptions.map((caseData) => (
            <button
              key={caseData.id}
              type="button"
              onClick={() => {
                hideModal();
                navigate(`/cases/${caseData.id}`);
              }}
              className="w-full rounded-md border border-gray-200 p-3 text-left hover:border-gray-400 hover:bg-gray-50 transition-colors"
            >
              <div className="text-sm font-semibold text-gray-900">{getModuleTitle(caseData)}</div>
              <div className="text-xs text-gray-500 mt-1">
                {getPathLabel(getPathId(caseData), caseData?.pathTitle)} · {formatTier(caseData?.tier)}
              </div>
            </button>
          ))}
        </div>
      </div>,
      'Choose a different case'
    );
  };

  const handleDiscardDraft = () => {
    if (!draftCase || !userId) return;
    const modal = showModalRef.current;
    if (!modal) return;
    modal(
      <div className="space-y-3">
        <p className="text-gray-700">
          This will erase your current progress for this draft.
        </p>
        <p className="text-sm text-gray-500">This can’t be undone.</p>
      </div>,
      'Discard draft?',
      (close) => (
        <>
          <Button variant="secondary" onClick={close}>
            Keep draft
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              close();
              try {
                await saveProgress({
                  appId,
                  uid: userId,
                  caseId: draftCase.id,
                  patch: {
                    percentComplete: 0,
                    state: 'not_started',
                    step: 'instruction',
                    draft: {},
                    hasSuccessfulAttempt: false,
                  },
                  forceOverwrite: true,
                  clearActiveAttempt: true,
                });
              } catch (err) {
                const errorMessage = err?.message || 'Unable to discard the draft.';
                const fallbackModal = showModalRef.current;
                if (fallbackModal) fallbackModal(errorMessage, 'Error');
              }
            }}
          >
            Discard draft
          </Button>
        </>
      )
    );
  };

  const handleOpenModulePicker = () => {
    const modal = showModalRef.current;
    if (!modal) return;
    if (moduleOptions.length === 0) {
      modal('No modules are available yet.', 'Change Module');
      return;
    }
    modal(
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        <p className="text-sm text-gray-600">Choose a module within this path.</p>
        <div className="space-y-3">
          {moduleOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                setSelectedModuleId(option.value);
                hideModal();
              }}
              className="w-full rounded-md border border-gray-200 p-3 text-left hover:border-gray-400 hover:bg-gray-50 transition-colors"
            >
              <div className="text-sm font-semibold text-gray-900">{option.label}</div>
              {option.description ? (
                <div className="text-xs text-gray-500 mt-1">{option.description}</div>
              ) : null}
            </button>
          ))}
        </div>
      </div>,
      'Change Module'
    );
  };

  const availableModules = useMemo(() => {
    return recipes.filter((recipe) => {
      const moduleId = recipe?.moduleId || recipe?.id;
      if (!moduleId) return false;
      return !moduleCompletionById.get(moduleId);
    });
  }, [recipes, moduleCompletionById]);

  const retakeCases = useMemo(() => {
    return casesWithProgress
      .filter((caseData) => isRetakeAttempt(caseData))
      .sort((a, b) => getProgressUpdatedAtMs(b) - getProgressUpdatedAtMs(a));
  }, [casesWithProgress, isRetakeAttempt]);

  const lastEditedMs = heroCase ? getProgressUpdatedAtMs(heroCase) : 0;
  const lastEditedLabel = heroCase
    ? formatRelativeDate(lastEditedMs ? new Date(lastEditedMs) : null, now)
    : '';
  const estimatedTime = heroCase ? formatMinutes(heroCase?.estimatedMinutes) : '';
  const heroActionLabel = heroMode === 'resume' ? 'Resume' : 'Start Case';
  const heroHierarchyLabel = heroCase
    ? `${getPathLabel(getPathId(heroCase), heroCase?.pathTitle)} / ${getModuleLabel(heroCase)} · ${formatCaseLevel(heroCase?.caseLevel)}`
    : '';
  const availableModule = availableModules[0] || null;
  const availableLevelLabel = availableModule
    ? resolveCaseLevelLabel(availableModule, codedRecipeById)
    : '';
  const availableHierarchyLabel = availableModule
    ? `${getPathLabel(getPathId(availableModule), availableModule?.pathTitle)} / ${getModuleLabel(availableModule)} · ${availableLevelLabel}`
    : '';

  const handleStartModule = async (moduleId) => {
    if (!moduleId || !userId) return;
    if (startingModuleId) return;
    try {
      setStartingModuleId(moduleId);
      const caseId = await generateAttemptFromRecipe({ moduleId, uid: userId });
      navigate(`/cases/${caseId}`);
    } catch (err) {
      console.error('Failed to start module:', err);
      const modal = showModalRef.current;
      if (modal) modal(err?.message || 'Unable to start module. Please try again.', 'Error');
    } finally {
      setStartingModuleId('');
    }
  };

  const handleDeleteRetake = useCallback(
    (caseData) => {
      if (!caseData?.id || !userId) return;
      const modal = showModalRef.current;
      if (!modal) return;
      modal(
        <div className="space-y-3">
          <p className="text-gray-700">
            This will permanently remove the retake attempt and its generated documents.
          </p>
          <p className="text-sm text-gray-500">This can’t be undone.</p>
        </div>,
        'Delete retake attempt?',
        (close) => (
          <>
            <Button variant="secondary" onClick={close}>
              Keep retake
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                close();
                try {
                  setDeletingRetakeIds((prev) => {
                    const next = new Set(prev);
                    next.add(caseData.id);
                    return next;
                  });
                  await deleteRetakeAttempt({ caseId: caseData.id });
                  await fetchCases();
                } catch (err) {
                  const errorMessage = err?.message || 'Unable to delete the retake attempt.';
                  const fallbackModal = showModalRef.current;
                  if (fallbackModal) fallbackModal(errorMessage, 'Error');
                } finally {
                  setDeletingRetakeIds((prev) => {
                    const next = new Set(prev);
                    next.delete(caseData.id);
                    return next;
                  });
                }
              }}
            >
              Delete retake
            </Button>
          </>
        )
      );
    },
    [fetchCases, userId]
  );

  if (!userId && initialLoad) {
    return <div className="p-4 text-center">Authenticating user, please wait...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto w-full max-w-[1400px] px-6 py-8 space-y-6 sm:px-8 lg:px-10">
        {error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md p-4">
            {error}
          </div>
        ) : null}

        <div className="bg-white rounded-lg border border-gray-100 p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-gray-400 mb-3 text-center sm:text-left">
            Program Path
          </div>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            {JOURNEY_STEPS.map((step, index) => {
              const state = getJourneyStepState(step.key);
              return (
                <div key={step.key} className="flex items-center">
                  <div className="flex items-center gap-2">
                    {state === 'completed' ? (
                      <CheckCircle2 size={20} className="text-emerald-600" />
                    ) : (
                      <span
                        className={`h-4 w-4 rounded-full border-2 ${
                          state === 'active'
                            ? 'border-blue-600 bg-blue-100'
                            : 'border-gray-300 bg-white'
                        }`}
                        aria-hidden="true"
                      />
                    )}
                    <span
                      className={`text-sm font-semibold ${
                        state === 'active'
                          ? 'text-blue-700'
                          : state === 'completed'
                          ? 'text-emerald-700'
                          : 'text-gray-500'
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>
                  {index < JOURNEY_STEPS.length - 1 ? (
                    <div className="mx-3 h-px w-12 bg-gray-200" aria-hidden="true" />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-100 p-6 space-y-4">
          <div className="flex flex-col gap-1">
            <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Module Journey</div>
            <div className="text-sm text-gray-600">
              Track your progress inside each module.
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {moduleJourney.map((module) => {
              const statusTone =
                module.statusType === 'completed'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : module.statusType === 'in_progress'
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : module.statusType === 'waiting'
                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : module.statusType === 'ready'
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                  : 'bg-slate-50 text-slate-500 border-slate-200';
              const tierTone =
                module.statusType === 'completed'
                  ? 'bg-emerald-100 text-emerald-700'
                  : module.statusType === 'waiting'
                  ? 'bg-amber-100 text-amber-700'
                  : module.statusType === 'locked'
                  ? 'bg-slate-100 text-slate-500'
                  : module.statusType === 'ready'
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-blue-100 text-blue-700';
              const statusLabel =
                module.statusType === 'completed'
                  ? 'Completed'
                  : module.statusType === 'waiting'
                  ? 'Waiting for assignment'
                  : module.statusType === 'locked'
                  ? 'Locked'
                  : module.statusType === 'ready'
                  ? 'Ready for next tier'
                  : 'In progress';
              const progressTone =
                module.statusType === 'completed'
                  ? 'bg-emerald-500'
                  : module.statusType === 'ready'
                  ? 'bg-indigo-500'
                  : module.statusType === 'waiting' || module.statusType === 'locked'
                  ? 'bg-slate-300'
                  : 'bg-blue-500';
              const assignedTierLabel = module.currentTierStats
                ? formatModuleTier(module.currentTierKey)
                : module.lastCompletedTierKey
                ? formatModuleTier(module.lastCompletedTierKey)
                : '';
              const assignedTierStats = module.currentTierStats || module.lastCompletedTierStats;
              return (
                <div
                  key={module.moduleId}
                  className={`rounded-xl border p-4 space-y-3 ${
                    module.isActiveModule ? 'border-blue-200 shadow-sm' : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold text-gray-900">{module.label}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone}`}>
                          {statusLabel}
                        </span>
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tierTone}`}>
                          {module.tierChipLabel}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full ${progressTone}`}
                      style={{ width: `${module.tierProgressPercent}%` }}
                    />
                  </div>
                  <div className="text-xs text-gray-500">
                    Tier progress: {module.completedTierCount}/{MODULE_TIER_ORDER.length} tiers complete
                  </div>
                  {assignedTierStats ? (
                    <div className="text-xs text-gray-500">
                      {assignedTierLabel} cases: {assignedTierStats.done}/{assignedTierStats.total} complete
                    </div>
                  ) : module.totalCases === 0 ? (
                    <div className="text-xs text-gray-500">No cases assigned yet</div>
                  ) : null}
                  {module.statusType === 'locked' && module.lockedMessage ? (
                    <div className="text-xs text-slate-500">{module.lockedMessage}</div>
                  ) : null}

                  <div className="flex items-center justify-between text-xs text-gray-500">
                    {MODULE_TIER_ORDER.map((tierKey) => {
                      const state = module.tierStates[tierKey];
                      const dotClass =
                        state === 'completed'
                          ? 'bg-emerald-500'
                          : state === 'current'
                          ? 'bg-blue-500'
                          : state === 'next'
                          ? 'bg-blue-200'
                          : 'bg-slate-300';
                      const textClass =
                        state === 'completed'
                          ? 'text-emerald-700'
                          : state === 'current'
                          ? 'text-blue-700'
                          : state === 'next'
                          ? 'text-blue-600'
                          : 'text-slate-400';
                      const suffix =
                        state === 'completed'
                          ? '✓'
                          : state === 'current'
                          ? 'Current'
                          : state === 'next'
                          ? 'Next'
                          : state === 'locked'
                          ? 'Locked'
                          : '';
                      return (
                        <div key={`${module.moduleId}-${tierKey}`} className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${dotClass}`} />
                          <span className={`font-semibold ${textClass}`}>
                            {MODULE_TIER_LABELS[tierKey]}{suffix ? ` ${suffix}` : ''}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {initialLoad && loading ? (
          <div className="text-center py-16 bg-white rounded-lg shadow-sm">
            <Loader2 size={32} className="animate-spin text-gray-500 mx-auto mb-3" />
            <p className="text-gray-600">Loading your dashboard…</p>
          </div>
        ) : heroCase ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8">
            <div className="space-y-3">
              <div className="text-xs uppercase tracking-[0.2em] text-gray-500">
                {heroMode === 'resume' ? 'In progress' : 'Next up'}
              </div>
              <h1 className="text-3xl font-semibold text-gray-900">
                {heroMode === 'resume' ? `${getModuleTitle(heroCase)} — Draft` : getModuleTitle(heroCase)}
              </h1>
              {heroMode === 'resume' ? (
                <div className="text-sm text-gray-600 space-y-1">
                  {heroHierarchyLabel ? <div>{heroHierarchyLabel}</div> : null}
                  <div>Last edited: {lastEditedLabel}</div>
                  {estimatedTime ? <div>Estimated time: {estimatedTime}</div> : null}
                </div>
              ) : (
                <div className="text-sm text-gray-600">
                  {heroHierarchyLabel}
                </div>
              )}
            </div>
            <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:gap-6 gap-3">
              <Button
                onClick={() => navigate(`/cases/${heroCase.id}`)}
                className="sm:w-auto w-full"
              >
                {heroActionLabel}
              </Button>
              <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500">
                <button
                  type="button"
                  onClick={handleChooseDifferent}
                  className="hover:text-gray-700 transition-colors"
                >
                  Choose a different case
                </button>
                {heroMode === 'resume' ? (
                  <button
                    type="button"
                    onClick={handleDiscardDraft}
                    className="hover:text-gray-700 transition-colors"
                  >
                    Discard draft
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : availableModules.length > 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8">
            <div className="space-y-3">
              <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Available module</div>
              <h1 className="text-3xl font-semibold text-gray-900">
                {availableModules[0]?.moduleTitle || availableModules[0]?.title || 'Module'}
              </h1>
              {availableHierarchyLabel ? (
                <div className="text-sm text-gray-600">{availableHierarchyLabel}</div>
              ) : null}
              <div className="text-sm text-gray-600">
                {availableLevelLabel ? `New level unlocked: ${availableLevelLabel}.` : 'Start your next case to enter the cockpit.'}
              </div>
            </div>
            <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:gap-6 gap-3">
              <Button
                onClick={() => handleStartModule(availableModules[0]?.moduleId || availableModules[0]?.id)}
                className="sm:w-auto w-full"
                isLoading={startingModuleId === (availableModules[0]?.moduleId || availableModules[0]?.id)}
                disabled={startingModuleId !== '' && startingModuleId !== (availableModules[0]?.moduleId || availableModules[0]?.id)}
              >
                Start Case
              </Button>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center space-y-3">
            <div className="text-xs uppercase tracking-[0.2em] text-gray-500">All clear</div>
            <h1 className="text-2xl font-semibold text-gray-900">No activities assigned yet.</h1>
            <p className="text-sm text-gray-600">
              {recipesLoading ? 'Loading modules…' : 'Check back soon or contact your instructor for access.'}
            </p>
          </div>
        )}

        {heroHierarchyLabel || moduleOptions.length > 0 ? (
          <div className="flex items-center justify-between text-sm text-gray-500">
            <div>
              Current Module: {heroHierarchyLabel || `${currentPathLabel} / ${currentModuleLabel}`}
            </div>
            <button
              type="button"
              onClick={handleOpenModulePicker}
              className="text-gray-500 hover:text-gray-700 transition-colors"
            >
              Change Module
            </button>
          </div>
        ) : null}

        <div className="flex items-center justify-end text-sm text-gray-500">
          <button
            type="button"
            onClick={() => navigate('/trainee/submission-history')}
            className="hover:text-gray-700 transition-colors"
          >
            Completed cases
          </button>
        </div>

        {shouldShowFocusSkills ? (
          <div className="bg-white rounded-lg border border-gray-100 p-5 space-y-3">
            <div className="text-sm font-semibold text-gray-800">Focus skills for your next step</div>
            <div className="space-y-2 text-sm text-gray-700">
              {heroSkills.map((skill) => (
                <div key={skill}>{skill}</div>
              ))}
            </div>
          </div>
        ) : null}

        {retakeCases.length > 0 ? (
          <div className="bg-white rounded-lg border border-gray-100 p-5 space-y-3">
            <div className="text-sm font-semibold text-gray-800">Practice attempts</div>
            <p className="text-sm text-gray-600">
              These are optional retakes. Your main path continues above.
            </p>
            <div className="space-y-3">
              {retakeCases.map((caseData) => {
                const retakeHasDraft = hasMeaningfulDraft(caseData.progress);
                const isDeleting = deletingRetakeIds.has(caseData.id);
                return (
                  <div
                    key={caseData.id}
                    className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="text-sm font-semibold text-gray-900">
                        {getModuleTitle(caseData)}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {getPathLabel(getPathId(caseData), caseData?.pathTitle)} · {formatTier(caseData?.tier)}
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <Button
                        variant="secondary"
                        onClick={() => navigate(`/cases/${caseData.id}`)}
                        className="sm:w-auto w-full"
                        disabled={isDeleting}
                      >
                        {retakeHasDraft ? 'Resume retake' : 'Start retake'}
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => handleDeleteRetake(caseData)}
                        className="sm:w-auto w-full"
                        disabled={isDeleting}
                        isLoading={isDeleting}
                      >
                        {isDeleting ? 'Deleting...' : 'Delete retake'}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

      </main>
    </div>
  );
}
