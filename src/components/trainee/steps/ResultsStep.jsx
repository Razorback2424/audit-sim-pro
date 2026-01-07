import React, { useMemo } from 'react';
import { Button } from '../../../AppCore';
import { CheckCircle2, XCircle, Info } from 'lucide-react';
import { currencyFormatter } from '../../../utils/formatters';

const formatTimestamp = (ts) => {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') {
    return ts.toDate().toLocaleString();
  }
  if (typeof ts.seconds === 'number') {
    return new Date(ts.seconds * 1000).toLocaleString();
  }
  return null;
};

const FixedAssetResults = ({
  submission,
  fixedAssetDraft,
  fixedAssetRisk,
  fixedAssetTotals,
  fixedAssetAdditions,
  fixedAssetDisposals,
}) => {
  const latestAttempt =
    Array.isArray(submission?.attempts) && submission.attempts.length > 0
      ? submission.attempts[submission.attempts.length - 1]
      : submission;
  const fixedAssetResponses = latestAttempt?.fixedAssetResponses || {};
  const scopingDecision = fixedAssetResponses.scopingDecision || fixedAssetDraft.scopingDecision || {};
  const outcome = scopingDecision.outcome || 'Pending';
  const tmValue = scopingDecision.tmInput ?? fixedAssetRisk?.tolerableMisstatement ?? '';
  const additionsTotal = fixedAssetResponses.summaryTotals?.additions ?? fixedAssetTotals.additions;
  const gradeValue = typeof submission?.grade === 'number' ? submission.grade : null;
  const seniorFeedbackList = Array.isArray(submission?.virtualSeniorFeedback)
    ? submission.virtualSeniorFeedback
    : [];

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-3">
        <h2 className="text-2xl font-semibold text-gray-800">Fixed Asset Results</h2>
        <p className="text-sm text-gray-600">Your testing strategy and recalculations are captured below.</p>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Outcome</p>
            <p className="text-lg font-semibold text-indigo-900">
              {outcome === 'requires_testing'
                ? 'Testing completed'
                : outcome === 'no_testing'
                ? 'No testing required'
                : outcome === 'insufficient_scope'
                ? 'Insufficient scope'
                : 'Pending'}
            </p>
          </div>
          <div className="rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Additions vs TM</p>
            <p className="text-lg font-semibold text-indigo-900">
              {currencyFormatter.format(additionsTotal || 0)} vs{' '}
              {tmValue ? currencyFormatter.format(Number(tmValue) || 0) : '—'}
            </p>
          </div>
          <div className="rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Virtual Senior grade</p>
            <p className="text-lg font-semibold text-indigo-900">
              {gradeValue !== null ? `${gradeValue.toFixed(1)} / 100` : 'Pending'}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-3">
        <h3 className="text-xl font-semibold text-gray-800">What you documented</h3>
        <ul className="text-sm text-gray-700 space-y-2">
          <li>Lead schedule tickmarks recorded for {Object.keys(fixedAssetResponses.leadScheduleTicks || {}).length} cells.</li>
          <li>
            Additions reviewed: {Object.keys(fixedAssetResponses.additionResponses || {}).length} / {fixedAssetAdditions.length || 0}
          </li>
          <li>
            Disposals recalculated: {Object.keys(fixedAssetResponses.disposalResponses || {}).length} / {fixedAssetDisposals.length || 0}
          </li>
          <li>
            Analytics conclusion:{' '}
            {fixedAssetResponses.analyticsResponse?.conclusion
              ? fixedAssetResponses.analyticsResponse.conclusion === 'reasonable'
                ? 'Reasonable'
                : 'Investigate'
              : 'Not recorded'}
          </li>
        </ul>
      </div>

      {seniorFeedbackList.length > 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-3">
          <h4 className="text-lg font-semibold text-gray-800">Virtual Senior Notes</h4>
          <ul className="list-disc pl-5 space-y-2 text-sm text-gray-700">
            {seniorFeedbackList.map((item, idx) => (
              <li key={item.paymentId || idx}>{Array.isArray(item.notes) ? item.notes.join(' ') : item.notes}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
};

export default function ResultsStep({
  isFixedAssetLayout,
  submission,
  fixedAssetDraft,
  fixedAssetRisk,
  fixedAssetTotals,
  fixedAssetAdditions,
  fixedAssetDisposals,
  classificationFields,
  selectedDisbursementDetails,
  caseTitle,
  navigate,
}) {
  const gradeValue = typeof submission?.grade === 'number' ? submission.grade : null;
  const gradeDisplay = gradeValue !== null ? gradeValue.toFixed(1) : null;
  const gradedAtText = formatTimestamp(submission?.gradedAt);
  const gradingDetails = submission?.gradingDetails || {};
  const gradeReady = gradeDisplay !== null;
  const seniorFeedback = Array.isArray(submission?.virtualSeniorFeedback)
    ? submission.virtualSeniorFeedback
    : [];

  const classificationLookup = useMemo(
    () => classificationFields.reduce((acc, field) => ({ ...acc, [field.key]: field.label || field.key }), {}),
    [classificationFields]
  );

  const formatClassificationLabel = (key) => classificationLookup[key] || key || 'Not specified';

  const renderDisbursementResults = () => {
    if (!submission) {
      return <p className="text-sm text-gray-500">Retrieving your submission details...</p>;
    }
    if (!gradeReady) {
      return <p className="text-sm text-gray-500">Grading is in progress. This usually takes a few seconds—feel free to refresh shortly.</p>;
    }
    if (selectedDisbursementDetails.length === 0) {
      return <p className="text-sm text-gray-500">No disbursements were recorded in your submission.</p>;
    }

    const answerKeyIsSplit = (disbursement) => {
      if (disbursement?.answerKeyMode === 'split') return true;
      const keyTotals = classificationFields.map(({ key }) => Number(disbursement?.answerKey?.[key] ?? 0));
      return keyTotals.filter((value) => Math.abs(value) > 0.009).length > 1;
    };

    return (
      <ul className="space-y-4">
        {selectedDisbursementDetails.map((d) => {
          const detail = gradingDetails[d.paymentId];
          const answerKey = d.answerKey || {};
          const splitConfigured = detail?.splitMode ?? answerKeyIsSplit(d);
          const explanation = detail?.explanation || answerKey.explanation;
          const showExplanation = typeof explanation === 'string' && explanation.trim().length > 0;
          const selectedLabel = formatClassificationLabel(detail?.userClassification);
          const correctLabel = formatClassificationLabel(detail?.correctClassification);
          const statusBadge = detail ? (
            detail.isCorrect ? (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-green-100 text-green-700">
                <CheckCircle2 size={16} className="mr-1" /> Correct
              </span>
            ) : (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-amber-100 text-amber-700">
                <XCircle size={16} className="mr-1" /> Needs Review
              </span>
            )
          ) : (
            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-amber-50 text-amber-700">
              <Info size={16} className="mr-1" /> Awaiting grade
            </span>
          );

          const renderDetailContent = () => {
            if (!detail) {
              return <p className="mt-3 text-sm text-gray-500">Grading details are not available for this disbursement yet.</p>;
            }
            if (splitConfigured) {
              return (
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-sm text-left text-gray-700 border border-gray-200 rounded-md">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-3 py-2 font-semibold text-gray-600">Classification</th>
                        <th className="px-3 py-2 font-semibold text-gray-600">Your Entry</th>
                        <th className="px-3 py-2 font-semibold text-gray-600">Correct Answer</th>
                        <th className="px-3 py-2 font-semibold text-gray-600">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {classificationFields.map(({ key, label }) => {
                        const fieldEval = detail.fields?.[key] || { user: 0, correct: 0, isCorrect: true };
                        return (
                          <tr key={`${d.paymentId}-${key}`} className="border-t">
                            <td className="px-3 py-2">{label}</td>
                            <td className="px-3 py-2">{currencyFormatter.format(fieldEval.user)}</td>
                            <td className="px-3 py-2">{currencyFormatter.format(fieldEval.correct)}</td>
                            <td className="px-3 py-2">
                              {fieldEval.isCorrect ? (
                                <span className="inline-flex items-center text-green-700">
                                  <CheckCircle2 size={16} className="mr-1" /> Match
                                </span>
                              ) : (
                                <span className="inline-flex items-center text-amber-700">
                                  <XCircle size={16} className="mr-1" /> Mismatch
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            }
            return (
              <div className="mt-3 rounded-md border border-gray-100 bg-gray-50 px-3 py-3 text-sm text-gray-700 space-y-1">
                <p>
                  <strong>Your selection:</strong> {selectedLabel}
                </p>
                <p>
                  <strong>Correct classification:</strong> {correctLabel}
                </p>
                {detail.isCorrect ? (
                  <p className="text-green-600">Great job—your classification matches the answer key.</p>
                ) : (
                  <p className="text-amber-700">Review the guidance below to understand the expected classification.</p>
                )}
              </div>
            );
          };

          return (
            <li key={d.paymentId} className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="text-sm text-gray-600">
                  <div>
                    <strong className="font-medium">ID:</strong> {d.paymentId}
                  </div>
                  <div>
                    <strong className="font-medium">Payee:</strong> {d.payee}
                  </div>
                  <div>
                    <strong className="font-medium">Amount:</strong> {currencyFormatter.format(Number(d.amount) || 0)}
                  </div>
                </div>
                <div className="flex items-center gap-2">{statusBadge}</div>
              </div>
              {renderDetailContent()}
              {showExplanation ? (
                <div className="mt-3 border border-blue-100 bg-blue-50 text-blue-900 rounded-md px-3 py-2 text-sm">
                  <strong className="font-semibold">Explanation:</strong> {explanation}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  };

  if (isFixedAssetLayout) {
    return (
      <FixedAssetResults
        submission={submission}
        fixedAssetDraft={fixedAssetDraft}
        fixedAssetRisk={fixedAssetRisk}
        fixedAssetTotals={fixedAssetTotals}
        fixedAssetAdditions={fixedAssetAdditions}
        fixedAssetDisposals={fixedAssetDisposals}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-lg shadow-xl p-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">Submission Confirmed</h1>
        <p className="text-gray-600">
          Your testing selections for {caseTitle} have been recorded. You can review your answers below.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-2">Final Grade</h2>
        {gradeReady ? (
          <div>
            <p className="text-4xl font-extrabold text-gray-900">{gradeDisplay}%</p>
            {gradedAtText ? <p className="text-xs text-gray-500 mt-1">Graded on {gradedAtText}</p> : null}
          </div>
        ) : (
          <p className="text-sm text-gray-500">Grading in progress… please check back shortly.</p>
        )}
      </div>

      {seniorFeedback.length > 0 ? (
        <div className="rounded-lg border border-red-100 bg-white shadow-sm overflow-hidden">
          <div className="bg-red-50 px-4 py-3 border-b border-red-100 flex items-center">
            <span className="text-xl mr-2" role="img" aria-label="Review notes">
              📝
            </span>
            <h3 className="font-bold text-red-900">Virtual Senior Review Notes</h3>
          </div>
          <div className="divide-y divide-gray-100">
            {seniorFeedback.map((item) => (
              <div key={item.paymentId || item.payee} className="p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-gray-700">{item.payee || 'Unnamed item'}</span>
                  <span className="text-xs text-gray-400 uppercase tracking-wide">{item.paymentId}</span>
                </div>
                <ul className="list-disc pl-5 space-y-1">
                  {(item.notes || []).map((note, idx) => (
                    <li key={`${item.paymentId || 'item'}-${idx}`} className="text-sm text-red-700">
                      {note}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Results & Feedback</h2>
        {renderDisbursementResults()}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <Button variant="secondary" onClick={() => navigate('/trainee')}>
          Back to Cases
        </Button>
        <Button variant="secondary" onClick={() => navigate('/trainee/submission-history')}>
          View Submission History
        </Button>
      </div>
    </div>
  );
}
