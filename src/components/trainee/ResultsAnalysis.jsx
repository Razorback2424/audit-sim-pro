import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, PlusCircle, RotateCcw } from 'lucide-react';
import { getSignedDocumentUrl } from '../../services/documentService';
import { currencyFormatter } from '../../utils/formatters';

const normalize = (val) => (typeof val === 'string' ? val.trim().toLowerCase() : '');

const CLASSIFICATION_LABELS = Object.freeze({
  properlyIncluded: 'Properly Included',
  properlyExcluded: 'Properly Excluded',
  improperlyIncluded: 'Improperly Included',
  improperlyExcluded: 'Improperly Excluded',
});

const CLASSIFICATION_KEYS = Object.freeze(Object.keys(CLASSIFICATION_LABELS));

const parseNumber = (value) => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;
  const cleaned = value.replace(/[^0-9.-]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeExpectedClassificationKey = (raw) => {
  if (!raw) return '';
  const text = normalize(raw);
  if (text.includes('missing') || text.includes('unrecorded')) return 'improperlyExcluded';
  if (text.includes('improperly') && text.includes('excluded')) return 'improperlyExcluded';
  if (text.includes('improperly') && text.includes('included')) return 'improperlyIncluded';
  if (text.includes('properly') && text.includes('excluded')) return 'properlyExcluded';
  if (text.includes('properly') && text.includes('included')) return 'properlyIncluded';
  if (CLASSIFICATION_KEYS.includes(text)) return text;
  return '';
};

const keyToLabel = (key) => CLASSIFICATION_LABELS[key] || 'Unclassified';

const correctDecisionLabel = (issue) => {
  const label = keyToLabel(issue?.correctDecision?.primaryKey);
  if (label !== 'Unclassified') return label;
  if (issue?.item?.shouldFlag) return 'Exception (classification not set)';
  return 'Unclassified';
};

const isInlinePreviewable = (contentType, fileNameOrPath) => {
  const normalizedType = typeof contentType === 'string' ? contentType.toLowerCase() : '';
  if (normalizedType === 'application/pdf' || normalizedType === 'application/x-pdf') {
    return true;
  }
  const normalizedName = typeof fileNameOrPath === 'string' ? fileNameOrPath.toLowerCase() : '';
  const pdfPattern = /\.pdf(?:$|[?#])/;
  if (!normalizedType && pdfPattern.test(normalizedName)) {
    return true;
  }
  if (normalizedType === 'application/octet-stream' && pdfPattern.test(normalizedName)) {
    return true;
  }
  return false;
};

const extractBreakdown = (source) => {
  const breakdown = CLASSIFICATION_KEYS.map((key) => ({ key, amount: parseNumber(source?.[key]) }))
    .filter(({ amount }) => Math.abs(amount) > 0.0001)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  return breakdown;
};

const extractSplitValues = (source) => {
  const raw = source && typeof source === 'object' ? source : {};
  return CLASSIFICATION_KEYS.reduce((acc, key) => {
    acc[key] = parseNumber(raw?.[key]);
    return acc;
  }, {});
};

const hasSplitExpectation = (item) => {
  const answerKey = item?.answerKey && typeof item.answerKey === 'object' ? item.answerKey : null;
  if (!answerKey) return false;
  const breakdown = extractBreakdown(answerKey);
  return breakdown.length > 1;
};

const compareSplitValues = (allocation, answerKey) => {
  const actualSource =
    allocation?.splitValues && typeof allocation.splitValues === 'object'
      ? allocation.splitValues
      : allocation;
  const expectedSource = answerKey && typeof answerKey === 'object' ? answerKey : {};
  const actual = extractSplitValues(actualSource);
  const expected = extractSplitValues(expectedSource);
  const tolerance = 0.01;
  const mismatchedKeys = CLASSIFICATION_KEYS.filter(
    (key) => Math.abs((actual[key] || 0) - (expected[key] || 0)) > tolerance
  );
  return { matches: mismatchedKeys.length === 0, mismatchedKeys };
};

const pickImproperKey = (breakdown) => {
  const improperKeys = new Set(['improperlyIncluded', 'improperlyExcluded']);
  const improper = (breakdown || []).filter(
    ({ key, amount }) => improperKeys.has(key) && Math.abs(amount) > 0.01
  );
  if (improper.length === 0) return '';
  if (improper.length === 1) return improper[0].key;
  const sorted = [...improper].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  return sorted[0].key;
};

const extractDecisionFromAllocation = (allocation) => {
  if (!allocation || typeof allocation !== 'object') {
    return { primaryKey: '', breakdown: [] };
  }

  const breakdown = extractBreakdown(allocation?.splitValues && typeof allocation.splitValues === 'object' ? allocation.splitValues : allocation);

  const explicitKey = typeof allocation.singleClassification === 'string' ? allocation.singleClassification : '';
  const explicitIsValid = CLASSIFICATION_KEYS.includes(explicitKey);
  if (explicitIsValid) {
    return { primaryKey: explicitKey, breakdown };
  }

  if (allocation.isException === true) {
    const improperKey = pickImproperKey(breakdown);
    if (improperKey) {
      return { primaryKey: improperKey, breakdown };
    }
  }

  if (breakdown.length > 0) {
    return { primaryKey: breakdown[0].key, breakdown };
  }

  if (allocation.isException === true) return { primaryKey: 'improperlyIncluded', breakdown: [] };
  if (allocation.isException === false) return { primaryKey: 'properlyIncluded', breakdown: [] };
  return { primaryKey: '', breakdown: [] };
};

const extractCorrectDecision = (item) => {
  const explicitKey = typeof item?.answerKeySingleClassification === 'string' ? item.answerKeySingleClassification : '';
  if (CLASSIFICATION_KEYS.includes(explicitKey)) {
    return { primaryKey: explicitKey, breakdown: [] };
  }
  const answerKey = item?.answerKey && typeof item.answerKey === 'object' ? item.answerKey : null;
  const breakdown = answerKey ? extractBreakdown(answerKey) : [];
  const improperKey = pickImproperKey(breakdown);
  if (improperKey) {
    return { primaryKey: improperKey, breakdown };
  }
  if (breakdown.length > 0) {
    return { primaryKey: breakdown[0].key, breakdown };
  }

  const expectedKey = normalizeExpectedClassificationKey(item?.expectedClassification);
  if (expectedKey) {
    return { primaryKey: expectedKey, breakdown: [] };
  }

  return { primaryKey: '', breakdown: [] };
};

const DecoyTable = ({ items }) => {
  if (items.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-sm text-gray-500">
        No routine items were correctly handled.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
        <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Correct Routine Transactions</h3>
      </div>
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Transaction
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Your Answer
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Correct Answer
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {items.map(({ item, studentDecision, correctDecision }) => (
            <tr key={item.paymentId}>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                <div className="font-medium">{item.payee}</div>
                <div className="text-xs text-gray-500">{currencyFormatter.format(Number(item.amount) || 0)}</div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                  {keyToLabel(studentDecision?.primaryKey)}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm">
                <div className="flex items-center text-emerald-600">
                  <CheckCircle2 size={16} className="mr-1.5" />
                  <span>{keyToLabel(correctDecision?.primaryKey)}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default function ResultsAnalysis({
  caseId,
  disbursements,
  studentAnswers,
  gateResults,
  referenceDocuments = [],
  onRequestRetake,
  onGenerateNewCase,
  onReturnToDashboard,
  nextRecommendation,
}) {
  const [activeIssueIndex, setActiveIssueIndex] = useState(0);
  const [showDecoys, setShowDecoys] = useState(false);
  const [highlightUrl, setHighlightUrl] = useState('');
  const [highlightLoading, setHighlightLoading] = useState(false);
  const [highlightError, setHighlightError] = useState('');
  const [highlightInlineNotSupported, setHighlightInlineNotSupported] = useState(false);
  const tieOutGate = gateResults?.tieOut || null;
  const selectionGate = gateResults?.selection || null;

  const resolveDocumentUrl = useCallback(
    async (doc) => {
      if (!doc || (!doc.storagePath && !doc.downloadURL)) return '';
      if (!caseId) throw new Error('Case ID is required to open documents.');
      return getSignedDocumentUrl({
        caseId,
        storagePath: doc.storagePath,
        downloadURL: doc.downloadURL,
      });
    },
    [caseId]
  );

  const { traps, routineCorrect, issues, falsePositiveCount, caughtTraps } = useMemo(() => {
    const traps = [];
    const routineCorrect = [];
    const issues = [];
    const caughtTraps = [];
    let falsePositiveCount = 0;
    const selectedIds = new Set(
      studentAnswers && typeof studentAnswers === 'object' ? Object.keys(studentAnswers) : []
    );
    const requiredIds = new Set(
      Array.isArray(selectionGate?.requiredIds) ? selectionGate.requiredIds : []
    );

    (disbursements || []).forEach((item) => {
      if (!item || !item.paymentId) return;
      const isTrap = !!item.shouldFlag;
      const answer = studentAnswers[item.paymentId] || {};
      const hasAnswer = selectedIds.has(item.paymentId);
      const studentDecision = extractDecisionFromAllocation(answer);
      const correctDecision = extractCorrectDecision(item);
      const splitExpected = hasSplitExpectation(item);
      const splitCheck = splitExpected ? compareSplitValues(answer, item.answerKey) : { matches: true };

      if (isTrap) {
        traps.push(item);

        const studentFlaggedException = answer?.isException === true;
        if (!studentFlaggedException) {
          if (!hasAnswer && !requiredIds.has(item.paymentId)) {
            return;
          }
          issues.push({
            type: 'missed_exception',
            item,
            studentDecision,
            correctDecision,
          });
          return;
        }

        // If the author provided an expected classification, enforce it. Otherwise, only require the exception flag.
        const expectedKey = correctDecision.primaryKey;
        if (expectedKey) {
          const matches = normalize(studentDecision.primaryKey) === normalize(expectedKey);
          if (!matches) {
            issues.push({
              type: 'wrong_classification',
              item,
              studentDecision,
              correctDecision,
            });
          } else if (splitExpected && !splitCheck.matches) {
            issues.push({
              type: 'split_mismatch',
              item,
              studentDecision,
              correctDecision,
              mismatchedKeys: splitCheck.mismatchedKeys,
            });
          } else {
            caughtTraps.push({ item, studentDecision, correctDecision });
          }
        } else {
          caughtTraps.push({ item, studentDecision, correctDecision });
        }
      } else {
        if (!hasAnswer) return;
        const studentFlaggedException = answer?.isException === true;
        if (studentFlaggedException) {
          falsePositiveCount += 1;
          issues.push({
            type: 'false_positive',
            item,
            studentDecision,
            correctDecision,
          });
          return;
        }

        if (
          correctDecision.primaryKey &&
          normalize(studentDecision.primaryKey) === normalize(correctDecision.primaryKey)
        ) {
          if (splitExpected && !splitCheck.matches) {
            issues.push({
              type: 'wrong_routine_classification',
              item,
              studentDecision,
              correctDecision,
            });
          } else {
            routineCorrect.push({ item, studentDecision, correctDecision });
          }
          return;
        }

        if (correctDecision.primaryKey) {
          issues.push({
            type: 'wrong_routine_classification',
            item,
            studentDecision,
            correctDecision,
          });
        }
      }
    });

    return { traps, routineCorrect, issues, falsePositiveCount, caughtTraps };
  }, [disbursements, selectionGate, studentAnswers]);

  const currentIssue = issues[activeIssueIndex] || null;
  const isDone = issues.length > 0 && activeIssueIndex >= issues.length;
  const criticalIssues = issues.filter(
    (issue) =>
      issue.type === 'missed_exception' ||
      issue.type === 'wrong_classification' ||
      issue.type === 'split_mismatch'
  );
  const criticalMissCount = criticalIssues.length;
  const routineIssueCount = Math.max(0, issues.length - criticalMissCount);
  const hasTraps = traps.length > 0;
  const showRetake = typeof onRequestRetake === 'function' && hasTraps;
  const showGenerate = typeof onGenerateNewCase === 'function' && hasTraps;
  const showReturn = typeof onReturnToDashboard === 'function';
  const selectedCount =
    studentAnswers && typeof studentAnswers === 'object' ? Object.keys(studentAnswers).length : 0;
  const virtualSeniorSummary = (() => {
    if (!hasTraps) {
      return {
        message: 'Virtual Senior feedback is limited because this case has no critical traps configured.',
        bullets: [
          'Ask for a trap-enabled case to get full coaching.',
          'Use the guided review to validate your routine work.',
        ],
      };
    }
    if (criticalMissCount === 0 && routineIssueCount === 0 && falsePositiveCount === 0) {
      return {
        message: 'Virtual Senior: Strong execution. You matched the expected call on every critical item.',
        bullets: [
          'Keep: your exception judgement is on target.',
          'Next: increase speed without sacrificing evidence checks.',
        ],
      };
    }
    return {
      message: 'Virtual Senior: Focus on evidence quality and exception judgment.',
      bullets: [
        criticalMissCount > 0
          ? `Priority: rework ${criticalMissCount} critical ${criticalMissCount === 1 ? 'miss' : 'misses'}.`
          : 'Priority: clean up routine classification errors.',
        falsePositiveCount > 0
          ? `Watchouts: ${falsePositiveCount} false ${falsePositiveCount === 1 ? 'positive' : 'positives'}.`
          : 'Watchouts: avoid over-flagging routine items.',
      ],
    };
  })();
  const recommendation = nextRecommendation || null;

  const invoiceDoc = useMemo(() => {
    const item = currentIssue?.item;
    if (!item) return null;
    if (item.highlightedDocument) return item.highlightedDocument;
    const supporting = Array.isArray(item.supportingDocuments) ? item.supportingDocuments : [];
    if (supporting.length > 0) {
      const doc = supporting.find((entry) => entry && (entry.storagePath || entry.downloadURL || entry.fileName));
      if (doc) return doc;
    }
    if (item.storagePath || item.downloadURL || item.fileName) {
      return {
        storagePath: item.storagePath,
        downloadURL: item.downloadURL,
        fileName: item.fileName,
        contentType: item.contentType,
      };
    }
    return null;
  }, [currentIssue]);

  const apAgingDoc = useMemo(() => {
    const docs = Array.isArray(referenceDocuments) ? referenceDocuments : [];
    const corrected = docs.find((doc) => String(doc?.fileName || '').toLowerCase().includes('corrected'));
    const templateMatch = docs.find((doc) => doc?.generationSpec?.templateId === 'refdoc.ap-aging.v1');
    const nameMatch = docs.find((doc) => String(doc?.fileName || '').toLowerCase().includes('ap aging'));
    return corrected || templateMatch || nameMatch || null;
  }, [referenceDocuments]);

  useEffect(() => {
    setHighlightUrl('');
    setHighlightError('');
    setHighlightInlineNotSupported(false);

    const doc = invoiceDoc;
    if (!doc || (!doc.downloadURL && !doc.storagePath)) {
      setHighlightLoading(false);
      return;
    }

    const previewOk = isInlinePreviewable(doc.contentType, doc.fileName || doc.storagePath || doc.downloadURL);
    setHighlightInlineNotSupported(!previewOk);

    let cancelled = false;
    setHighlightLoading(true);

    resolveDocumentUrl(doc)
      .then((url) => {
        if (cancelled) return;
        setHighlightUrl(url || '');
        setHighlightError(url ? '' : 'Highlighted invoice is not available for this item.');
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[ResultsAnalysis] Failed to load highlighted invoice', err);
        setHighlightUrl('');
        setHighlightError('Unable to load highlighted invoice.');
      })
      .finally(() => {
        if (cancelled) return;
        setHighlightLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [invoiceDoc, resolveDocumentUrl]);

  const [apAgingUrl, setApAgingUrl] = useState('');
  const [apAgingLoading, setApAgingLoading] = useState(false);
  const [apAgingError, setApAgingError] = useState('');
  const [apAgingInlineUnsupported, setApAgingInlineUnsupported] = useState(false);

  useEffect(() => {
    setApAgingUrl('');
    setApAgingError('');
    setApAgingInlineUnsupported(false);

    if (!apAgingDoc || (!apAgingDoc.downloadURL && !apAgingDoc.storagePath)) {
      setApAgingLoading(false);
      return;
    }

    const previewOk = isInlinePreviewable(
      apAgingDoc.contentType,
      apAgingDoc.fileName || apAgingDoc.storagePath || apAgingDoc.downloadURL
    );
    setApAgingInlineUnsupported(!previewOk);

    let cancelled = false;
    setApAgingLoading(true);

    resolveDocumentUrl(apAgingDoc)
      .then((url) => {
        if (cancelled) return;
        setApAgingUrl(url || '');
        setApAgingError(url ? '' : 'AP aging document is not available.');
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[ResultsAnalysis] Failed to load AP aging preview', err);
        setApAgingUrl('');
        setApAgingError('Unable to load AP aging document.');
      })
      .finally(() => {
        if (cancelled) return;
        setApAgingLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apAgingDoc, resolveDocumentUrl]);

  const goPrev = useCallback(() => {
    setActiveIssueIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const goNext = useCallback(() => {
    setActiveIssueIndex((prev) => {
      if (issues.length === 0) return 0;
      return Math.min(issues.length, prev + 1);
    });
  }, [issues.length]);

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {tieOutGate || selectionGate ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm px-6 py-5 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Gate Summary</div>
          <div className="grid gap-3 md:grid-cols-2 text-sm text-gray-700">
            {tieOutGate ? (
              <div>
                <span className="font-semibold">C&amp;A tie-out:</span>{' '}
                {tieOutGate.passed ? 'Passed' : 'Not passed'}
              </div>
            ) : null}
            {selectionGate ? (
              <div>
                <span className="font-semibold">Selection threshold:</span>{' '}
                {currencyFormatter.format(Number(selectionGate.thresholdAmount || 0))}
              </div>
            ) : null}
            {selectionGate ? (
              <div>
                <span className="font-semibold">Performance materiality:</span>{' '}
                {currencyFormatter.format(Number(selectionGate.performanceMateriality || 0))}
              </div>
            ) : null}
            {selectionGate ? (
              <div>
                <span className="font-semibold">Required picks:</span>{' '}
                {Array.isArray(selectionGate.requiredIds) && selectionGate.requiredIds.length > 0
                  ? selectionGate.requiredIds.join(', ')
                  : 'None'}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm px-6 py-5 space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Virtual Senior Feedback</div>
        <p className="text-sm text-gray-700">{virtualSeniorSummary.message}</p>
        <ul className="text-sm text-gray-600 list-disc list-inside">
          {virtualSeniorSummary.bullets.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <div
        className={`rounded-xl border shadow-sm px-6 py-5 ${
          !hasTraps || criticalMissCount === 0
            ? 'bg-emerald-50/60 border-emerald-200'
            : 'bg-rose-50/60 border-rose-200'
        }`}
      >
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-600">At a glance</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5 text-sm text-gray-700">
              <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                <div className="text-xs uppercase tracking-wide text-gray-500">Selections</div>
                <div className="text-lg font-semibold text-gray-900">{selectedCount}</div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                <div className="text-xs uppercase tracking-wide text-gray-500">Critical misses</div>
                <div className="text-lg font-semibold text-gray-900">{criticalMissCount}</div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                <div className="text-xs uppercase tracking-wide text-gray-500">Traps caught</div>
                <div className="text-lg font-semibold text-gray-900">{caughtTraps.length}</div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                <div className="text-xs uppercase tracking-wide text-gray-500">Routine correct</div>
                <div className="text-lg font-semibold text-gray-900">{routineCorrect.length}</div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                <div className="text-xs uppercase tracking-wide text-gray-500">False positives</div>
                <div className="text-lg font-semibold text-gray-900">{falsePositiveCount}</div>
              </div>
            </div>
            <h2 className="mt-1 text-2xl font-bold text-gray-900">
              {!hasTraps
                ? 'No critical items were configured for this case.'
                : criticalMissCount === 0
                ? routineIssueCount > 0
                  ? 'Critical items were handled correctly.'
                  : 'Nice work! You caught all the errors in the selections made.'
                : `You missed ${criticalMissCount} critical ${criticalMissCount === 1 ? 'item' : 'items'}.`}
            </h2>
            {(() => {
              const baseMessage = !hasTraps
                ? 'Ask your instructor to add critical risks (traps) to enable a full review walkthrough.'
                : criticalMissCount === 0
                ? ''
                : 'We’ll walk through each one step-by-step and show you exactly where it appears in the evidence.';
              const routineNote =
                routineIssueCount > 0
                  ? `${baseMessage ? ' ' : ''}(${baseMessage ? 'You also missed' : 'You missed'} ${routineIssueCount} routine ${routineIssueCount === 1 ? 'item' : 'items'}.)`
                  : '';
              const falsePositiveMessage =
                falsePositiveCount > 0
                  ? `${baseMessage || routineNote ? ' ' : ''}(${baseMessage || routineNote ? 'You also flagged' : 'You flagged'} ${falsePositiveCount} routine ${falsePositiveCount === 1 ? 'item' : 'items'}.)`
                  : '';
              const message = `${baseMessage}${routineNote}${falsePositiveMessage}`.trim();
              if (!message) return null;
              return <p className="mt-1 text-sm text-gray-700">{message}</p>;
            })()}
          </div>
          {showRetake && criticalMissCount === 0 && showReturn ? (
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={onReturnToDashboard}
                className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-2"
              >
                Back to Dashboard
              </button>
              {showRetake ? (
                <button
                  type="button"
                  onClick={onRequestRetake}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-800 focus:ring-offset-2"
                >
                  <RotateCcw size={16} />
                  Retake Case
                </button>
              ) : null}
              {showGenerate ? (
                <button
                  type="button"
                  onClick={onGenerateNewCase}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-900 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-900 hover:text-white focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
                >
                  <PlusCircle size={16} />
                  Generate New Case
                </button>
              ) : null}
            </div>
          ) : showRetake || showGenerate ? (
            <div className="flex flex-col sm:flex-row gap-2">
              {showRetake ? (
                <button
                  type="button"
                  onClick={onRequestRetake}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-800 focus:ring-offset-2"
                >
                  <RotateCcw size={16} />
                  Try Again
                </button>
              ) : null}
              {showGenerate ? (
                <button
                  type="button"
                  onClick={onGenerateNewCase}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-900 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-900 hover:text-white focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
                >
                  <PlusCircle size={16} />
                  Generate New Case
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {recommendation ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm px-6 py-5 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Next recommended case</div>
          <div className="text-lg font-semibold text-gray-900">{recommendation.title}</div>
          <p className="text-sm text-gray-700">{recommendation.reason}</p>
          {recommendation.cta ? (
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={recommendation.cta.onClick}
                className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
              >
                {recommendation.cta.label}
              </button>
              {recommendation.secondaryCta ? (
                <button
                  type="button"
                  onClick={recommendation.secondaryCta.onClick}
                  className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-2"
                >
                  {recommendation.secondaryCta.label}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {!hasTraps || issues.length === 0 ? null : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-600">Guided Review</div>
              <div className="text-sm text-gray-800">
                {isDone ? 'All set.' : `Issue ${activeIssueIndex + 1} of ${issues.length}`}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={goPrev}
                disabled={activeIssueIndex === 0}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={16} />
                Back
              </button>
              <button
                type="button"
                onClick={goNext}
                disabled={isDone || issues.length === 0}
                className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          {isDone ? (
            <div className="px-6 py-6 space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-4">
                <CheckCircle2 className="text-emerald-600 mt-0.5" />
                <div>
                  <div className="font-semibold text-gray-900">You’ve reviewed every miss.</div>
                  <div className="text-sm text-gray-700">Run the case again and apply the same reasoning in real time.</div>
                </div>
              </div>
              {showRetake || showGenerate ? (
                <div className="flex flex-col sm:flex-row gap-2">
                  {showRetake ? (
                    <button
                      type="button"
                      onClick={onRequestRetake}
                      className="inline-flex items-center justify-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-800 focus:ring-offset-2"
                    >
                      <RotateCcw size={16} />
                      Try Again
                    </button>
                  ) : null}
                  {showGenerate ? (
                    <button
                      type="button"
                      onClick={onGenerateNewCase}
                      className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-900 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-900 hover:text-white focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
                    >
                      <PlusCircle size={16} />
                      Generate New Case
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : currentIssue ? (
            <div className="px-6 py-6 space-y-5">
              {(() => {
                const isCritical =
                  currentIssue.type === 'missed_exception' ||
                  currentIssue.type === 'wrong_classification' ||
                  currentIssue.type === 'split_mismatch';
                if (!isCritical) return null;
                return (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                      <div className="border-b border-gray-200 bg-gray-50 px-4 py-3 flex items-center justify-between">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Invoice evidence</div>
                          <div className="text-sm text-gray-700">
                            {invoiceDoc?.fileName || 'Invoice'}
                          </div>
                        </div>
                        {highlightUrl ? (
                          <a
                            href={highlightUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
                          >
                            <ExternalLink size={14} />
                            Open
                          </a>
                        ) : null}
                      </div>
                      <div className="bg-gray-100">
                        {!invoiceDoc ? (
                          <div className="px-6 py-10 text-center text-sm text-gray-600">
                            No invoice is linked to this item.
                          </div>
                        ) : highlightLoading ? (
                          <div className="px-6 py-10 text-center text-sm text-gray-600">Loading invoice…</div>
                        ) : highlightError ? (
                          <div className="px-6 py-10 text-center text-sm text-amber-700">{highlightError}</div>
                        ) : highlightInlineNotSupported ? (
                          <div className="px-6 py-10 text-center text-sm text-gray-600">
                            Preview not available for this file type. Use “Open”.
                          </div>
                        ) : highlightUrl ? (
                          <iframe
                            title="Invoice evidence"
                            src={highlightUrl}
                            className="w-full"
                            style={{ height: '420px' }}
                          />
                        ) : (
                          <div className="px-6 py-10 text-center text-sm text-gray-600">
                            Invoice preview not available.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                      <div className="border-b border-gray-200 bg-gray-50 px-4 py-3 flex items-center justify-between">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">AP aging</div>
                          <div className="text-sm text-gray-700">
                            {apAgingDoc?.fileName || 'AP Aging Summary'}
                          </div>
                        </div>
                        {apAgingUrl ? (
                          <a
                            href={apAgingUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
                          >
                            <ExternalLink size={14} />
                            Open
                          </a>
                        ) : null}
                      </div>
                      <div className="bg-gray-100">
                        {!apAgingDoc ? (
                          <div className="px-6 py-10 text-center text-sm text-gray-600">
                            AP aging reference not found.
                          </div>
                        ) : apAgingLoading ? (
                          <div className="px-6 py-10 text-center text-sm text-gray-600">Loading AP aging…</div>
                        ) : apAgingError ? (
                          <div className="px-6 py-10 text-center text-sm text-amber-700">{apAgingError}</div>
                        ) : apAgingInlineUnsupported ? (
                          <div className="px-6 py-10 text-center text-sm text-gray-600">
                            Preview not available for this file type. Use “Open”.
                          </div>
                        ) : apAgingUrl ? (
                          <iframe
                            title="AP aging reference"
                            src={apAgingUrl}
                            className="w-full"
                            style={{ height: '420px' }}
                          />
                        ) : (
                          <div className="px-6 py-10 text-center text-sm text-gray-600">
                            AP aging preview not available.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                <div>
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-3">
                      <h3 className="text-3xl font-extrabold text-gray-900">
                        {currentIssue.item?.payee || 'Vendor'}
                      </h3>
                      <div className="text-2xl font-bold text-gray-900">
                        {currencyFormatter.format(Number(currentIssue.item?.amount) || 0)}
                      </div>
                    </div>
                    {currentIssue.item?.paymentId ? (
                      <div className="text-sm text-gray-600">Payment ID: {currentIssue.item.paymentId}</div>
                    ) : null}
                  </div>
                </div>
              </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-gray-200 bg-white p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Your decision</div>
                    <div className="mt-1 text-xl font-bold text-gray-900">
                      {keyToLabel(currentIssue.studentDecision?.primaryKey)}
                    </div>
                    {Array.isArray(currentIssue.studentDecision?.breakdown) &&
                    currentIssue.studentDecision.breakdown.length > 1 ? (
                      <div className="mt-2 text-sm text-gray-700">
                        Split:{' '}
                        {currentIssue.studentDecision.breakdown
                          .map(({ key, amount }) => `${keyToLabel(key)} ${currencyFormatter.format(amount)}`)
                          .join(' • ')}
                      </div>
                    ) : null}
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-white p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Correct call</div>
                    <div className="mt-1 text-xl font-bold text-gray-900">
                      {correctDecisionLabel(currentIssue)}
                    </div>
                    {Array.isArray(currentIssue.correctDecision?.breakdown) &&
                    currentIssue.correctDecision.breakdown.length > 1 ? (
                      <div className="mt-2 text-sm text-gray-700">
                        Split:{' '}
                        {currentIssue.correctDecision.breakdown
                          .map(({ key, amount }) => `${keyToLabel(key)} ${currencyFormatter.format(amount)}`)
                          .join(' • ')}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-4">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Your workpaper note</div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800 leading-relaxed">
                      {(() => {
                        const student = studentAnswers?.[currentIssue.item?.paymentId] || {};
                        const note = String(student.workpaperNote || student.notes || student.note || '').trim();
                        return note || 'No note submitted.';
                      })()}
                    </p>
                  </div>
                  <div className="border-t border-gray-200 pt-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Senior Manager&apos;s Note
                    </div>
                    <p className="mt-2 text-sm text-gray-800 leading-relaxed">
                      {currentIssue.item?.answerKey?.explanation || 'No explanation provided yet for this item.'}
                    </p>
                  </div>
                </div>

            </div>
          ) : null}
        </div>
      )}

      {caughtTraps.length > 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-600">Good catches</div>
            <div className="text-sm text-gray-800">You flagged these traps correctly.</div>
          </div>
          <div className="divide-y divide-gray-200">
            {caughtTraps.map(({ item, correctDecision }, index) => {
              const correctLabel = correctDecisionLabel({ item, correctDecision });
              return (
                <div key={item.paymentId || item.id || index} className="px-6 py-5 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2">
                    <div>
                      <div className="text-lg font-semibold text-gray-900">{item?.payee || 'Vendor'}</div>
                      {item?.paymentId ? (
                        <div className="text-xs text-gray-500">Payment ID: {item.paymentId}</div>
                      ) : null}
                    </div>
                    <div className="text-lg font-bold text-emerald-700">
                      {currencyFormatter.format(Number(item?.amount) || 0)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                    Good catch — you flagged this as an exception.
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Why it was a trap</div>
                    <p className="mt-2 text-sm text-gray-800 leading-relaxed">
                      {item?.answerKey?.explanation || 'No explanation provided yet for this item.'}
                    </p>
                  </div>
                  {correctLabel !== 'Unclassified' ? (
                    <div className="text-sm text-gray-700">
                      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Correct call</span>{' '}
                      <span className="ml-2 font-semibold text-gray-900">{correctLabel}</span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {routineCorrect.length > 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowDecoys((prev) => !prev)}
            className="w-full px-6 py-4 flex items-center justify-between bg-gray-50 border-b border-gray-200 text-left"
          >
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-600">Optional</div>
              <div className="text-sm font-semibold text-gray-900">Correct routine transactions</div>
            </div>
            <div className="text-sm font-semibold text-blue-700">{showDecoys ? 'Hide' : 'Show'}</div>
          </button>
          {showDecoys ? <DecoyTable items={routineCorrect} /> : null}
        </div>
      ) : null}

    </div>
  );
}
