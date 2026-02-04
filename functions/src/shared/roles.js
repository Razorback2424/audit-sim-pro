const resolveRequesterIdentity = async ({ context, appId, firestore, logLabel }) => {
  const requesterRole = context.auth.token?.role;
  let requesterOrgId = context.auth.token?.orgId ?? null;
  const resolvedRole = typeof requesterRole === 'string' ? requesterRole.toLowerCase() : requesterRole;

  if (!requesterOrgId && appId) {
    try {
      const profileRef = firestore.doc(
        `artifacts/${appId}/users/${context.auth.uid}/userProfileData/profile`
      );
      const profileSnap = await profileRef.get();
      if (profileSnap.exists) {
        requesterOrgId = profileSnap.data()?.orgId ?? requesterOrgId;
      }
    } catch (err) {
      console.warn(`[${logLabel}] Failed to resolve orgId from profile`, err);
    }
  }

  return { resolvedRole, requesterOrgId };
};

module.exports = {
  resolveRequesterIdentity,
};
