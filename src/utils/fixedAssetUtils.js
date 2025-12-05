export const buildEmptyFixedAssetDraft = () => ({
  leadScheduleTicks: {},
  scopingDecision: null,
  additionResponses: {},
  disposalResponses: {},
  analyticsResponse: {},
});

export const normalizeFixedAssetDraft = (rawDraft) => {
  if (!rawDraft || typeof rawDraft !== 'object') {
    return buildEmptyFixedAssetDraft();
  }
  return {
    leadScheduleTicks:
      rawDraft.leadScheduleTicks && typeof rawDraft.leadScheduleTicks === 'object'
        ? { ...rawDraft.leadScheduleTicks }
        : {},
    scopingDecision:
      rawDraft.scopingDecision && typeof rawDraft.scopingDecision === 'object'
        ? { ...rawDraft.scopingDecision }
        : null,
    additionResponses:
      rawDraft.additionResponses && typeof rawDraft.additionResponses === 'object'
        ? { ...rawDraft.additionResponses }
        : {},
    disposalResponses:
      rawDraft.disposalResponses && typeof rawDraft.disposalResponses === 'object'
        ? { ...rawDraft.disposalResponses }
        : {},
    analyticsResponse:
      rawDraft.analyticsResponse && typeof rawDraft.analyticsResponse === 'object'
        ? { ...rawDraft.analyticsResponse }
        : {},
  };
};

export const areFixedAssetDraftsEqual = (left, right) => {
  const a = normalizeFixedAssetDraft(left);
  const b = normalizeFixedAssetDraft(right);
  return (
    JSON.stringify(a.leadScheduleTicks) === JSON.stringify(b.leadScheduleTicks) &&
    JSON.stringify(a.scopingDecision) === JSON.stringify(b.scopingDecision) &&
    JSON.stringify(a.additionResponses) === JSON.stringify(b.additionResponses) &&
    JSON.stringify(a.disposalResponses) === JSON.stringify(b.disposalResponses) &&
    JSON.stringify(a.analyticsResponse) === JSON.stringify(b.analyticsResponse)
  );
};
