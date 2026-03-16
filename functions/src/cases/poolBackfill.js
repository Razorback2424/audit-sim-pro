const shouldQueuePoolReplenishment = (remainingCount) =>
  Number.isFinite(Number(remainingCount)) && Number(remainingCount) <= 2;

const queuePoolReplenishmentJob = async ({ firestore, admin, appId, moduleId, requestedBy, orgId }) => {
  if (!firestore || !admin || !appId || !moduleId) return null;
  const jobRef = firestore.doc(`artifacts/${appId}/private/data/case_pool_jobs/${moduleId}`);

  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    const current = snap.exists ? snap.data() || {} : {};
    const currentStatus = typeof current.status === 'string' ? current.status.trim().toLowerCase() : '';

    if (currentStatus === 'queued' || currentStatus === 'processing') {
      tx.set(
        jobRef,
        {
          requestedAt: admin.firestore.FieldValue.serverTimestamp(),
          requestedBy: requestedBy || current.requestedBy || null,
          orgId: orgId || current.orgId || null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          requestCount: Number.isFinite(Number(current.requestCount))
            ? Number(current.requestCount) + 1
            : 1,
        },
        { merge: true }
      );
      return { queued: false, status: currentStatus };
    }

    tx.set(
      jobRef,
      {
        moduleId,
        appId,
        status: 'queued',
        requestedBy: requestedBy || null,
        orgId: orgId || null,
        requestedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: current.createdAt || admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        requestCount: Number.isFinite(Number(current.requestCount))
          ? Number(current.requestCount) + 1
          : 1,
        lastError: admin.firestore.FieldValue.delete(),
      },
      { merge: true }
    );
    return { queued: true, status: 'queued' };
  });
};

module.exports = {
  queuePoolReplenishmentJob,
  shouldQueuePoolReplenishment,
};
