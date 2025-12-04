import React, { useState } from 'react';
import { Input, Select, Textarea } from '../../AppCore';
import StepIntro from './StepIntro';
import {
  ANSWER_KEY_FIELDS,
  ANSWER_KEY_LABELS,
  ANSWER_KEY_PLACEHOLDER,
  DEFAULT_ANSWER_KEY_CLASSIFICATION,
  buildSingleAnswerKey,
  extractAnswerKeyMeta,
  formatAnswerKeyLabel,
  isAnswerKeyReady,
} from '../../utils/caseFormHelpers';

export function AnswerKeyStep({ disbursements, onUpdate, classificationFields, answerKeyLabels, classificationOptions }) {
  const normalizedFields =
    Array.isArray(classificationFields) && classificationFields.length > 0
      ? classificationFields
      : ANSWER_KEY_FIELDS.map((key) => ({ key, label: ANSWER_KEY_LABELS[key] || key }));
  const normalizedLabels = answerKeyLabels || {};
  const normalizedOptions =
    Array.isArray(classificationOptions) && classificationOptions.length > 0
      ? classificationOptions
      : [
          { value: ANSWER_KEY_PLACEHOLDER, label: 'Choose classification…' },
          ...normalizedFields.map(({ key, label }) => ({
            value: key,
            label: label || ANSWER_KEY_LABELS[key] || key,
          })),
        ];

  return (
    <div className="space-y-6">
      <StepIntro
        title="Define the correct answer"
        items={[
          'Enter the correct totals for each classification per disbursement.',
          'Add a concise explanation so trainees understand the reasoning.',
          'Ensure the totals match the disbursement amount before submitting.',
        ]}
        helper="These answers power automated feedback. Every disbursement must be fully completed."
      />

      <div className="space-y-4">
        {disbursements.map((disbursement, index) => (
          <AnswerKeyCard
            key={disbursement._tempId}
            disbursement={disbursement}
            index={index}
            onUpdate={onUpdate}
            classificationFields={normalizedFields}
            answerKeyLabels={normalizedLabels}
            classificationOptions={normalizedOptions}
          />
        ))}
      </div>
    </div>
  );
}

export default function AnswerKeyCard({
  disbursement,
  index,
  onUpdate,
  classificationFields = [],
  answerKeyLabels = {},
  classificationOptions = [],
}) {
  const paymentLabel = disbursement.paymentId || `Disbursement ${index + 1}`;
  const answerKey = disbursement.answerKey || {};
  const mode = disbursement.answerKeyMode || 'single';
  const splitEnabled = mode === 'split';
  const classification = disbursement.answerKeySingleClassification || DEFAULT_ANSWER_KEY_CLASSIFICATION;
  const classificationChosen = classification && classification !== ANSWER_KEY_PLACEHOLDER;
  const normalizedFields =
    Array.isArray(classificationFields) && classificationFields.length > 0
      ? classificationFields
      : ANSWER_KEY_FIELDS.map((key) => ({ key, label: ANSWER_KEY_LABELS[key] || key }));
  const normalizedOptions =
    Array.isArray(classificationOptions) && classificationOptions.length > 0
      ? classificationOptions
      : [
          { value: ANSWER_KEY_PLACEHOLDER, label: 'Choose classification…' },
          ...normalizedFields.map(({ key, label }) => ({
            value: key,
            label: label || ANSWER_KEY_LABELS[key] || key,
          })),
        ];
  const classificationLabel = classificationChosen
    ? (answerKeyLabels && answerKeyLabels[classification]) ||
      formatAnswerKeyLabel(classification, classificationFields) ||
      classification
    : 'Choose classification';
  const amountNumber = Number(disbursement.amount || 0);
  const ready = isAnswerKeyReady(disbursement);
  const [expanded, setExpanded] = useState(false);

  const handleClassificationChange = (value) => {
    onUpdate(index, (current) => {
      const explanation = current.answerKey?.explanation || '';
      const meta = extractAnswerKeyMeta(current.answerKey);
      return {
        ...current,
        answerKeyMode: 'single',
        answerKeySingleClassification: value,
        answerKey: buildSingleAnswerKey(
          value && value !== ANSWER_KEY_PLACEHOLDER ? value : null,
          value && value !== ANSWER_KEY_PLACEHOLDER ? Number(current.amount || 0) : 0,
          explanation,
          meta
        ),
      };
    });
  };

  const handleSplitToggle = (checked) => {
    if (checked) {
      onUpdate(index, (current) => ({
        ...current,
        answerKeyMode: 'split',
      }));
    } else {
      onUpdate(index, (current) => {
        const existingClassification =
          current.answerKeySingleClassification && current.answerKeySingleClassification !== ANSWER_KEY_PLACEHOLDER
            ? current.answerKeySingleClassification
            : null;
        const fallbackClassification = existingClassification || ANSWER_KEY_PLACEHOLDER;
        const explanation = current.answerKey?.explanation || '';
        const meta = extractAnswerKeyMeta(current.answerKey);
        return {
          ...current,
          answerKeyMode: 'single',
          answerKeySingleClassification: fallbackClassification,
          answerKey: buildSingleAnswerKey(
            fallbackClassification && fallbackClassification !== ANSWER_KEY_PLACEHOLDER ? fallbackClassification : null,
            fallbackClassification && fallbackClassification !== ANSWER_KEY_PLACEHOLDER ? Number(current.amount || 0) : 0,
            explanation,
            meta
          ),
        };
      });
    }
  };

  const handleExplanationChange = (value) => {
    onUpdate(index, (current) => ({
      ...current,
      answerKey: {
        ...current.answerKey,
        explanation: value,
      },
    }));
  };

  const handleSplitFieldChange = (field, value) => {
    onUpdate(index, (current) => ({
      ...current,
      answerKey: {
        ...current.answerKey,
        [field]: value,
      },
    }));
  };

  const handleAssertionChange = (value) => {
    onUpdate(index, (current) => ({
      ...current,
      answerKey: {
        ...current.answerKey,
        assertion: value,
      },
    }));
  };

  const handleReasonChange = (value) => {
    onUpdate(index, (current) => ({
      ...current,
      answerKey: {
        ...current.answerKey,
        reason: value,
      },
    }));
  };

  const explanationPreview = String(answerKey.explanation || '').trim() || 'Not provided yet';
  const assertionPreview = String(answerKey.assertion || '').trim();
  const reasonPreview = String(answerKey.reason || '').trim();
  const statusBadgeClass = ready ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700';
  const statusText = ready ? 'READY' : 'INCOMPLETE';

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{paymentLabel}</p>
          <p className="text-xs text-gray-500">
            {disbursement.payee || 'Payee pending'} ·{' '}
            {disbursement.amount
              ? `$${Number(disbursement.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : 'Amount pending'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${statusBadgeClass}`}>
            {statusText}
          </span>
          <button
            type="button"
            className="inline-flex h-10 w-32 items-center justify-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? 'Hide details' : 'Edit details'}
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="space-y-4 border-t border-gray-100 p-4">
          <div className="flex flex-col gap-3 rounded-xl border border-blue-100 bg-blue-50/40 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2 text-sm">
              <label className="font-medium text-blue-900" htmlFor={`classification-${disbursement._tempId}`}>
                Classification
              </label>
              <Select
                id={`classification-${disbursement._tempId}`}
                value={classification}
                onChange={(event) => handleClassificationChange(event.target.value)}
                options={normalizedOptions}
                disabled={splitEnabled}
              />
              <p className="text-xs text-blue-700">
                {splitEnabled
                  ? 'Splitting enabled below'
                  : classificationChosen && amountNumber
                  ? `Entire amount of $${amountNumber.toLocaleString()} assigned to this classification.`
                  : 'Select the correct classification or enable split disbursement.'}
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm font-medium text-blue-800">
              <input
                type="checkbox"
                className="rounded border-blue-300 text-blue-600 focus:ring-blue-500"
                checked={splitEnabled}
                onChange={(event) => handleSplitToggle(event.target.checked)}
              />
              Split disbursement across classifications
            </label>
          </div>

          {splitEnabled ? (
            <div className="rounded-xl border border-gray-200 bg-white/90 p-4 shadow-sm">
              <p className="text-xs text-gray-500">
                Enter the portion allocated to each classification. Totals must equal the disbursement amount.
              </p>
              <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                {normalizedFields.map(({ key, label }) => (
                  <div key={key} className="flex flex-col text-sm">
                    <label className="mb-1 font-medium text-gray-700" htmlFor={`${disbursement._tempId}-${key}`}>
                      {(answerKeyLabels && answerKeyLabels[key]) || ANSWER_KEY_LABELS[key] || label || key}
                    </label>
                    <Input
                      id={`${disbursement._tempId}-${key}`}
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      value={answerKey?.[key] ?? ''}
                      onChange={(event) => handleSplitFieldChange(key, event.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor={`${disbursement._tempId}-explanation`}>
              Explanation shown to trainees
            </label>
            <Textarea
              id={`${disbursement._tempId}-explanation`}
              rows={splitEnabled ? 4 : 3}
              required
              value={answerKey?.explanation ?? ''}
              onChange={(event) => handleExplanationChange(event.target.value)}
              placeholder="Briefly explain why this allocation is correct."
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col text-sm font-medium text-gray-700">
              <label className="mb-1 text-xs uppercase tracking-wide text-gray-500" htmlFor={`${disbursement._tempId}-assertion`}>
                Expected assertion (for grading)
              </label>
              <Input
                id={`${disbursement._tempId}-assertion`}
                value={answerKey?.assertion ?? ''}
                onChange={(event) => handleAssertionChange(event.target.value)}
                placeholder="e.g., cutoff, existence, rights & obligations"
              />
            </div>
            <div className="flex flex-col text-sm font-medium text-gray-700">
              <label className="mb-1 text-xs uppercase tracking-wide text-gray-500" htmlFor={`${disbursement._tempId}-reason`}>
                Expected reason / trigger
              </label>
              <Input
                id={`${disbursement._tempId}-reason`}
                value={answerKey?.reason ?? ''}
                onChange={(event) => handleReasonChange(event.target.value)}
                placeholder="e.g., dated after year end, customer-owned inventory"
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="border-t border-gray-100 p-4">
          <div className="grid gap-4 text-sm text-gray-700 md:grid-cols-2">
            <div>
              <span className="text-xs uppercase tracking-wide text-gray-500">Classification</span>
              <p className={`mt-1 font-semibold ${splitEnabled ? 'text-blue-700' : classificationChosen ? 'text-gray-900' : 'text-amber-600'}`}>
                {splitEnabled ? 'Split across classifications' : classificationLabel}
              </p>
            </div>
            <div>
              <span className="text-xs uppercase tracking-wide text-gray-500">Explanation</span>
              <p className="mt-1 truncate text-gray-600">{explanationPreview}</p>
              <div className="mt-1 space-y-1 text-xs text-gray-500">
                {assertionPreview ? <p>Assertion: {assertionPreview}</p> : null}
                {reasonPreview ? <p>Reason: {reasonPreview}</p> : null}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
