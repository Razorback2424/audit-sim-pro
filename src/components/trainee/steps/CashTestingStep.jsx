import React from 'react';
import { Button } from '../../../AppCore';
import { Send } from 'lucide-react';
import CashReconciliationWorkbench from '../workspaces/CashReconciliationWorkbench';

export default function CashTestingStep({
  testingIntro,
  cashOutstandingList,
  cashCutoffList,
  cashArtifacts,
  cashContext,
  classificationAmounts,
  cashLinkMap,
  cashAdjustments,
  cashSummaryDraft,
  onUpdateStatus,
  onLinkChange,
  onVarianceChange,
  onProposeAdjustment,
  onSummaryChange,
  onBack,
  onSubmit,
  canSubmit = true,
  isLocked,
}) {
  return (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-3">
        <div>
          <h2 className="text-2xl font-semibold text-gray-800">Step 2 — Classify Results</h2>
          <p className="text-sm text-gray-500">{testingIntro}</p>
        </div>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4">
        <CashReconciliationWorkbench
          ledgerItems={cashOutstandingList}
          cutoffItems={cashCutoffList}
          artifacts={cashArtifacts}
          cashContext={cashContext}
          classificationAmounts={classificationAmounts}
          links={cashLinkMap}
          adjustments={cashAdjustments}
          summaryDraft={cashSummaryDraft}
          onUpdateStatus={onUpdateStatus}
          onLinkChange={onLinkChange}
          onVarianceChange={onVarianceChange}
          onProposeAdjustment={onProposeAdjustment}
          onSummaryChange={onSummaryChange}
          isLocked={isLocked}
        />
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <Button variant="secondary" onClick={onBack} disabled={isLocked}>
          Back to Selection
        </Button>
        <Button onClick={onSubmit} disabled={isLocked || !canSubmit}>
          <Send size={18} className="inline mr-2" /> Submit Responses
        </Button>
      </div>
    </div>
  );
}
