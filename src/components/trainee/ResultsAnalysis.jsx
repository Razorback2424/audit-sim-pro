import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertOctagon, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, RotateCcw } from 'lucide-react';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { currencyFormatter } from '../../utils/formatters';
import { storage } from '../../AppCore';

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

const resolveDocumentUrl = async (doc) => {
  if (!doc) return '';
  if (doc.downloadURL) return doc.downloadURL;
  if (doc.storagePath) {
    const fileRef = storageRef(storage, doc.storagePath);
    return await getDownloadURL(fileRef);
  }
  return '';
};

const extractBreakdown = (source) => {
  const breakdown = CLASSIFICATION_KEYS.map((key) => ({ key, amount: parseNumber(source?.[key]) }))
    .filter(({ amount }) => Math.abs(amount) > 0.0001)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  return breakdown;
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

  if (breakdown.length > 0) {
    return { primaryKey: breakdown[0].key, breakdown };
  }

  if (allocation.isException === true) return { primaryKey: 'improperlyIncluded', breakdown: [] };
  if (allocation.isException === false) return { primaryKey: 'properlyIncluded', breakdown: [] };
  return { primaryKey: '', breakdown: [] };
};

const extractCorrectDecision = (item) => {
  const answerKey = item?.answerKey && typeof item.answerKey === 'object' ? item.answerKey : null;
  const breakdown = answerKey ? extractBreakdown(answerKey) : [];
  if (breakdown.length > 0) {
    return { primaryKey: breakdown[0].key, breakdown };
  }

  const expectedKey = normalizeExpectedClassificationKey(item?.expectedClassification);
  if (expectedKey) {
    return { primaryKey: expectedKey, breakdown: [] };
  }

  return { primaryKey: '', breakdown: [] };
};

const DecoyTable = ({ items, studentAnswers }) => {
  if (items.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-sm text-gray-500">
        No decoy transactions were included in this submission.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
        <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Routine Transactions (Decoys)</h3>
      </div>
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Transaction
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Your Decision
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Result
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {items.map((item) => {
            const answer = studentAnswers[item.paymentId] || {};
            const flagged = !!answer.isException;
            const isFalsePositive = flagged;

            return (
              <tr key={item.paymentId}>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  <div className="font-medium">{item.payee}</div>
                  <div className="text-xs text-gray-500">{currencyFormatter.format(Number(item.amount) || 0)}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {flagged ? (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                      Flagged Exception
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                      Passed
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {isFalsePositive ? (
                    <div className="flex items-center text-amber-600">
                      <AlertOctagon size={16} className="mr-1.5" />
                      <span>False Positive (Inefficient)</span>
                    </div>
                  ) : (
                    <div className="flex items-center text-emerald-600">
                      <CheckCircle2 size={16} className="mr-1.5" />
                      <span>Correct</span>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default function ResultsAnalysis({ disbursements, studentAnswers, onRequestRetake, onReturnToDashboard }) {
  const [activeIssueIndex, setActiveIssueIndex] = useState(0);
  const [showDecoys, setShowDecoys] = useState(false);
  const [highlightUrl, setHighlightUrl] = useState('');
  const [highlightLoading, setHighlightLoading] = useState(false);
  const [highlightError, setHighlightError] = useState('');
  const [highlightInlineNotSupported, setHighlightInlineNotSupported] = useState(false);

  const { traps, decoys, issues, falsePositiveCount } = useMemo(() => {
    const traps = [];
    const decoys = [];
    const issues = [];
    let falsePositiveCount = 0;

    (disbursements || []).forEach((item) => {
      const isTrap = !!item.shouldFlag;
      const answer = studentAnswers[item.paymentId] || {};

      if (isTrap) {
        traps.push(item);

        const studentDecision = extractDecisionFromAllocation(answer);
        const correctDecision = extractCorrectDecision(item);

        const studentFlaggedException = answer?.isException === true;
        if (!studentFlaggedException) {
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
          }
        }
      } else {
        decoys.push(item);
        if (answer?.isException) falsePositiveCount += 1;
      }
    });

    return { traps, decoys, issues, falsePositiveCount };
  }, [disbursements, studentAnswers]);

  const currentIssue = issues[activeIssueIndex] || null;
  const isDone = issues.length > 0 && activeIssueIndex >= issues.length;
  const missedCount = issues.length;
  const hasTraps = traps.length > 0;
  const showRetake = typeof onRequestRetake === 'function' && hasTraps;
  const showReturn = typeof onReturnToDashboard === 'function';

  const hasRevealForItem = (item) =>
    !!item?.highlightedDocument && !!(item.highlightedDocument.downloadURL || item.highlightedDocument.storagePath);

  useEffect(() => {
    setHighlightUrl('');
    setHighlightError('');
    setHighlightInlineNotSupported(false);

    const doc = currentIssue?.item?.highlightedDocument;
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
  }, [currentIssue?.item?.highlightedDocument]);

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
      <div
        className={`rounded-xl border shadow-sm px-6 py-5 ${
          !hasTraps || missedCount === 0 ? 'bg-emerald-50/60 border-emerald-200' : 'bg-rose-50/60 border-rose-200'
        }`}
      >
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-600">At a glance</div>
            <h2 className="mt-1 text-2xl font-bold text-gray-900">
              {!hasTraps
                ? 'No critical items were configured for this case.'
                : missedCount === 0
                ? 'Nice work! You caught all the errors in the selections made.'
                : `You missed ${missedCount} critical ${missedCount === 1 ? 'item' : 'items'}.`}
            </h2>
            {(() => {
              const baseMessage = !hasTraps
                ? 'Ask your instructor to add critical risks (traps) to enable a full review walkthrough.'
                : missedCount === 0
                ? ''
                : 'We’ll walk through each one step-by-step and show you exactly where it appears in the evidence.';
              const falsePositiveMessage =
                falsePositiveCount > 0
                  ? `${baseMessage ? ' ' : ''}(You also flagged ${falsePositiveCount} routine ${falsePositiveCount === 1 ? 'item' : 'items'}.)`
                  : '';
              const message = `${baseMessage}${falsePositiveMessage}`.trim();
              if (!message) return null;
              return <p className="mt-1 text-sm text-gray-700">{message}</p>;
            })()}
          </div>
          {showRetake && missedCount === 0 && showReturn ? (
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={onReturnToDashboard}
                className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-2"
              >
                Back to Dashboard
              </button>
              <button
                type="button"
                onClick={onRequestRetake}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-800 focus:ring-offset-2"
              >
                <RotateCcw size={16} />
                Retake Case
              </button>
            </div>
          ) : showRetake ? (
            <button
              type="button"
              onClick={onRequestRetake}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-800 focus:ring-offset-2"
            >
              <RotateCcw size={16} />
              Try Again
            </button>
          ) : null}
        </div>
      </div>

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
              {typeof onRequestRetake === 'function' ? (
                <button
                  type="button"
                  onClick={onRequestRetake}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-800 focus:ring-offset-2"
                >
                  <RotateCcw size={16} />
                  Try Again
                </button>
              ) : null}
            </div>
          ) : currentIssue ? (
            <div className="px-6 py-6 space-y-5">
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

                <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                  <div className="border-b border-gray-200 bg-gray-50 px-4 py-3 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Highlighted invoice</div>
                      <div className="text-sm text-gray-700">
                        {currentIssue.item?.highlightedDocument?.fileName || 'Highlighted evidence'}
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
                    {!hasRevealForItem(currentIssue.item) ? (
                      <div className="px-6 py-10 text-center text-sm text-gray-600">
                        No highlighted invoice was provided for this item.
                      </div>
                    ) : highlightLoading ? (
                      <div className="px-6 py-10 text-center text-sm text-gray-600">Loading highlighted invoice…</div>
                    ) : highlightError ? (
                      <div className="px-6 py-10 text-center text-sm text-amber-700">{highlightError}</div>
                    ) : highlightInlineNotSupported ? (
                      <div className="px-6 py-10 text-center text-sm text-gray-600">
                        Preview not available for this file type. Use “Open”.
                      </div>
                    ) : highlightUrl ? (
                      <iframe
                        title="Highlighted invoice"
                        src={highlightUrl}
                        className="w-full"
                        style={{ height: '520px' }}
                      />
                    ) : (
                      <div className="px-6 py-10 text-center text-sm text-gray-600">
                        Highlighted invoice not available.
                      </div>
                    )}
                  </div>
                </div>
            </div>
          ) : null}
        </div>
      )}

      {decoys.length > 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowDecoys((prev) => !prev)}
            className="w-full px-6 py-4 flex items-center justify-between bg-gray-50 border-b border-gray-200 text-left"
          >
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-600">Optional</div>
              <div className="text-sm font-semibold text-gray-900">Routine transactions</div>
            </div>
            <div className="text-sm font-semibold text-blue-700">{showDecoys ? 'Hide' : 'Show'}</div>
          </button>
          {showDecoys ? <DecoyTable items={decoys} studentAnswers={studentAnswers} /> : null}
        </div>
      ) : null}

    </div>
  );
}
