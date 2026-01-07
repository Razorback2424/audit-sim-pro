import React from 'react';
import { Button } from '../../../AppCore';
import { Send } from 'lucide-react';
import EvidenceList from '../evidence/EvidenceList';
import EvidenceViewer from '../evidence/EvidenceViewer';
import AuditItemCardFactory from '../AuditItemCardFactory';
import { STANDARD_ASSERTIONS } from '../../../constants/caseFormOptions';

export default function TwoPaneTestingStep({
  layoutConfig,
  testingIntro,
  selectedIds,
  selectedDisbursementDetails,
  renderReferenceDownloadsBanner,
  selectedEvidenceItems,
  viewerEvidenceItems,
  onSelectEvidence,
  activeEvidenceId,
  viewerEnabled,
  pdfViewerState,
  activeEvidenceLoading,
  activeEvidenceError,
  activeEvidenceUrl,
  handleViewDocument,
  isEvidenceWorkflowLinked,
  normalizeAllocationShape,
  classificationAmounts,
  createEmptyAllocation,
  computeAllocationTotals,
  classificationFields,
  splitAllocationHint,
  singleAllocationHint,
  isLocked,
  handleSplitToggle,
  handleSingleClassificationChange,
  handleSplitAmountChange,
  handleWorkspaceUpdate,
  handleNoteChange,
  workspaceNotes,
  handleRationaleSelection,
  setActiveStep,
  firstWorkflowStep,
  onBackToSelection,
  handleSubmitTesting,
  exceptionNoteRequiredIds,
  allClassified,
  deriveImmediateFeedbackForItem,
}) {
  const showEvidencePanels = layoutConfig.showEvidence !== false;
  const showWorkPanels = layoutConfig.showWork !== false;
  const showReferenceBanner = layoutConfig.hideReferenceBanner ? false : true;
  const showImmediateFeedback = layoutConfig.showImmediateFeedback !== false;
  const evidenceOnLeft =
    layoutConfig.evidencePosition === 'left' ||
    layoutConfig.evidencePosition === undefined ||
    layoutConfig.evidencePosition === null;

  const evidenceList = Array.isArray(viewerEvidenceItems) && viewerEvidenceItems.length > 0
    ? viewerEvidenceItems
    : selectedEvidenceItems;

  const missingDocuments = evidenceList.filter(
    (item) => !item?.hasLinkedDocument && !isEvidenceWorkflowLinked(item.paymentId)
  );
  const missingPaymentIds = Array.from(new Set(missingDocuments.map((item) => item?.paymentId || 'Unknown ID')));

  return (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-3">
        <div>
          <h2 className="text-2xl font-semibold text-gray-800">Step 2 — Classify Results</h2>
          <p className="text-sm text-gray-500">{testingIntro}</p>
        </div>
        {missingPaymentIds.length > 0 ? (
          <div className="border border-amber-300 bg-amber-50 text-amber-800 text-sm rounded-md px-4 py-3">
            <p className="font-semibold">Some documents are still missing.</p>
            <p className="mt-1">
              The following disbursements do not have support yet: <span className="font-medium">{missingPaymentIds.join(', ')}</span>.
            </p>
          </div>
        ) : null}
      </div>

      {selectedIds.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 text-sm text-gray-600">
          You do not have any disbursements selected. Return to the selection step to add them before testing.
          <div className="mt-4">
            <Button
              variant="secondary"
              onClick={onBackToSelection || (() => setActiveStep(firstWorkflowStep))}
            >
              Back to Selection
            </Button>
          </div>
        </div>
      ) : (
        <>
          {showReferenceBanner ? renderReferenceDownloadsBanner() : null}
          {showEvidencePanels ? (
            <div className="grid gap-6 md:grid-cols-2">
              {evidenceOnLeft ? (
                <>
                  <EvidenceList
                    items={evidenceList}
                    activeEvidenceId={activeEvidenceId}
                    onSelect={onSelectEvidence}
                    isEvidenceWorkflowLinked={isEvidenceWorkflowLinked}
                  />
                  <EvidenceViewer
                    items={evidenceList}
                    viewerEnabled={viewerEnabled}
                    activeEvidenceId={activeEvidenceId}
                    activeEvidenceLoading={activeEvidenceLoading}
                    activeEvidenceError={activeEvidenceError}
                    activeEvidenceUrl={activeEvidenceUrl}
                    onOpenDocument={handleViewDocument}
                  />
                </>
              ) : (
                <>
                  <EvidenceViewer
                    items={evidenceList}
                    viewerEnabled={viewerEnabled}
                    activeEvidenceId={activeEvidenceId}
                    activeEvidenceLoading={activeEvidenceLoading}
                    activeEvidenceError={activeEvidenceError}
                    activeEvidenceUrl={activeEvidenceUrl}
                    onOpenDocument={handleViewDocument}
                  />
                  <EvidenceList
                    items={evidenceList}
                    activeEvidenceId={activeEvidenceId}
                    onSelect={onSelectEvidence}
                    isEvidenceWorkflowLinked={isEvidenceWorkflowLinked}
                  />
                </>
              )}
            </div>
          ) : null}

          {showWorkPanels ? (
            <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 pointer-events-none">
              <h3 className="text-xl font-semibold text-gray-800 mb-4">Allocate Each Disbursement</h3>
              {exceptionNoteRequiredIds.length > 0 ? (
                <div className="mb-4 border border-amber-300 bg-amber-50 text-amber-800 text-sm rounded-md px-4 py-3">
                  <p className="font-semibold">Notes required for proposed adjustments.</p>
                  <p className="mt-1">
                    Add workpaper notes for: <span className="font-medium">{exceptionNoteRequiredIds.join(', ')}</span> before submitting.
                  </p>
                </div>
              ) : null}
              <div className="space-y-4">
                {selectedDisbursementDetails.map((item) => {
                  const allocation = normalizeAllocationShape(
                    classificationAmounts[item.paymentId] || createEmptyAllocation()
                  );
                  const totals = computeAllocationTotals(item, allocation);
                  const totalEntered = classificationFields.reduce((sum, { key }) => {
                    const value = totals[key];
                    return sum + (Number.isFinite(value) ? value : 0);
                  }, 0);
                  const amountNumber = Number(item.amount) || 0;
                  const totalsMatch = Math.abs(totalEntered - amountNumber) <= 0.01;
                  const itemId = item.id || item.paymentId;
                  const immediateFeedback = deriveImmediateFeedbackForItem(item);
                  const rationaleState = workspaceNotes[itemId] || {};
                  const reasonOptions = Array.isArray(item.errorReasons) ? item.errorReasons : [];

                  return (
                    <div key={itemId} className="space-y-2">
                      {showImmediateFeedback && immediateFeedback.length > 0 ? (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          {immediateFeedback.map((msg, idx) => (
                            <p key={`${itemId}-feedback-${idx}`}>{msg}</p>
                          ))}
                        </div>
                      ) : null}
                      <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-3 text-xs text-blue-900 space-y-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
                          Rationale (Assertion & Reason)
                        </p>
                        <label className="flex flex-col gap-1">
                          <span>Select assertion</span>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {STANDARD_ASSERTIONS.map((assertion) => {
                              const selected = (rationaleState.assertionSelection || '') === assertion;
                              return (
                                <button
                                  key={assertion}
                                  type="button"
                                  disabled={isLocked}
                                  aria-pressed={selected}
                                  onClick={() => handleRationaleSelection(itemId, 'assertionSelection', assertion)}
                                  className={`rounded-md border px-2 py-2 text-[12px] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 ${
                                    selected
                                      ? 'border-blue-500 bg-white text-blue-800 shadow-sm'
                                      : 'border-blue-200 bg-blue-50/50 text-blue-900 hover:bg-white'
                                  } ${isLocked ? 'opacity-60' : ''}`}
                                >
                                  {assertion}
                                </button>
                              );
                            })}
                            <button
                              type="button"
                              disabled={isLocked || !rationaleState.assertionSelection}
                              onClick={() => handleRationaleSelection(itemId, 'assertionSelection', '')}
                              className="rounded-md border border-blue-200 bg-transparent px-2 py-2 text-[12px] font-semibold text-blue-800 hover:bg-white disabled:opacity-50"
                            >
                              Clear
                            </button>
                          </div>
                        </label>
                        <label className="flex flex-col gap-1">
                          <span>Select reason</span>
                          <select
                            className="rounded-md border border-blue-200 p-1 text-sm"
                            value={rationaleState.reasonSelection || ''}
                            disabled={isLocked || reasonOptions.length === 0}
                            onChange={(event) => handleRationaleSelection(itemId, 'reasonSelection', event.target.value)}
                          >
                            <option value="">{reasonOptions.length ? 'Choose reason…' : 'No reasons configured'}</option>
                            {reasonOptions.map((reason) => (
                              <option key={reason} value={reason}>
                                {reason}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <AuditItemCardFactory
                        item={{ ...item, id: itemId }}
                        allocation={allocation}
                        classificationFields={classificationFields}
                        splitAllocationHint={splitAllocationHint}
                        singleAllocationHint={singleAllocationHint}
                        isLocked={isLocked}
                        onSplitToggle={handleSplitToggle}
                        onClassificationChange={handleSingleClassificationChange}
                        onSplitAmountChange={handleSplitAmountChange}
                        totalEntered={totalEntered}
                        totalsMatch={totalsMatch}
                        pdfViewerState={pdfViewerState}
                        onUpdate={handleWorkspaceUpdate}
                        onNoteChange={handleNoteChange}
                        workspaceState={workspaceNotes[itemId]}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
            <Button
              variant="secondary"
              onClick={onBackToSelection || (() => setActiveStep(firstWorkflowStep))}
              disabled={isLocked}
            >
              Back to Selection
            </Button>
            <Button onClick={handleSubmitTesting} disabled={isLocked || exceptionNoteRequiredIds.length > 0 || !allClassified}>
              <Send size={18} className="inline mr-2" /> Submit Responses
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
