const crypto = require('crypto');
const { functions, admin, callable } = require('./shared/firebaseAdmin');
const { resolveRequesterIdentity } = require('./shared/roles');

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const normalizeEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const hashToken = (value) => crypto.createHash('sha256').update(value).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');

const requireOrgManager = async ({ context, appId, firestore, logLabel }) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  const identity = await resolveRequesterIdentity({ context, appId, firestore, logLabel });
  if (!['admin', 'owner', 'instructor'].includes(identity.resolvedRole)) {
    throw new functions.https.HttpsError('permission-denied', 'Organization manager access required.');
  }
  if (!identity.requesterOrgId) {
    throw new functions.https.HttpsError('failed-precondition', 'Organization is not configured.');
  }
  return identity;
};

const getInviteBaseUrl = () => {
  const value = String(process.env.APP_BASE_URL || '').trim().replace(/\/$/, '');
  if (!value || /example\.(com|org|net)$/i.test(value)) {
    throw new Error('APP_BASE_URL is not configured for invitations.');
  }
  return value;
};

const sendInvitationEmail = async ({ email, inviteUrl, orgId }) => {
  const endpoint = String(process.env.INVITE_EMAIL_ENDPOINT || '').trim();
  const apiKey = String(process.env.INVITE_EMAIL_API_KEY || '').trim();
  if (!endpoint || !apiKey) throw new Error('Invitation email provider is not configured.');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: email,
      subject: 'You are invited to AuditSim Pro',
      text: `You have been invited to AuditSim Pro. Accept your invitation: ${inviteUrl}`,
      html: `<p>You have been invited to AuditSim Pro.</p><p><a href="${inviteUrl}">Accept your invitation</a></p>`,
      metadata: { orgId },
    }),
  });
  if (!response.ok) throw new Error(`Invitation email provider returned ${response.status}.`);
};

exports.createTraineeInvitations = callable.https.onCall(async (data, context) => {
  const appId = typeof data?.appId === 'string' ? data.appId.trim() : '';
  const emails = Array.isArray(data?.emails) ? data.emails.map(normalizeEmail).filter(Boolean) : [];
  if (!appId || emails.length === 0 || emails.length > 50) {
    throw new functions.https.HttpsError('invalid-argument', 'appId and 1-50 email addresses are required.');
  }

  const firestore = admin.firestore();
  const { requesterOrgId } = await requireOrgManager({ context, appId, firestore, logLabel: 'createTraineeInvitations' });
  const uniqueEmails = [...new Set(emails)];
  const billingSnap = await firestore.doc(`artifacts/${appId}/billing/orgs/${requesterOrgId}`).get();
  const seatLimit = Number(billingSnap.data()?.seatCount);
  const existingInvites = await firestore.collection(`artifacts/${appId}/organizations/${requesterOrgId}/invitations`)
    .where('status', 'in', ['pending', 'accepted']).get();
  const alreadyInvitedEmails = new Set(existingInvites.docs.map((doc) => doc.data()?.emailNormalized));
  const emailsToInvite = uniqueEmails.filter((email) => !alreadyInvitedEmails.has(email));

  if (Number.isFinite(seatLimit) && seatLimit >= 0) {
    if (existingInvites.size + emailsToInvite.length > seatLimit) {
      throw new functions.https.HttpsError('resource-exhausted', 'Not enough seats are available for these invitations.');
    }
  }
  const now = Date.now();
  const results = uniqueEmails
    .filter((email) => alreadyInvitedEmails.has(email))
    .map((email) => ({ email, status: 'already_invited' }));

  for (const email of emailsToInvite) {
    const invitationRef = firestore.collection(`artifacts/${appId}/organizations/${requesterOrgId}/invitations`).doc();
    const token = randomToken();
    const payload = {
      invitationId: invitationRef.id,
      orgId: requesterOrgId,
      emailNormalized: email,
      role: 'trainee',
      status: 'pending',
      tokenHash: hashToken(token),
      createdBy: context.auth.uid,
      createdAt: admin.firestore.Timestamp.fromMillis(now),
      expiresAt: admin.firestore.Timestamp.fromMillis(now + INVITE_TTL_MS),
    };
    try {
      await invitationRef.create(payload);
      const inviteUrl = `${getInviteBaseUrl()}/invite/accept?token=${encodeURIComponent(token)}`;
      await sendInvitationEmail({ email, inviteUrl, orgId: requesterOrgId });
      results.push({ email, invitationId: invitationRef.id, status: 'sent' });
    } catch (error) {
      await invitationRef.set({ status: 'send_failed', sendError: error.message }, { merge: true });
      results.push({ email, invitationId: invitationRef.id, status: 'failed', message: error.message });
    }
  }
  return { results };
});

exports.revokeTraineeInvitation = callable.https.onCall(async (data, context) => {
  const appId = typeof data?.appId === 'string' ? data.appId.trim() : '';
  const invitationId = typeof data?.invitationId === 'string' ? data.invitationId.trim() : '';
  if (!appId || !invitationId) throw new functions.https.HttpsError('invalid-argument', 'appId and invitationId are required.');

  const firestore = admin.firestore();
  const { requesterOrgId } = await requireOrgManager({ context, appId, firestore, logLabel: 'revokeTraineeInvitation' });
  const invitationRef = firestore.doc(`artifacts/${appId}/organizations/${requesterOrgId}/invitations/${invitationId}`);
  const snapshot = await invitationRef.get();
  if (!snapshot.exists) throw new functions.https.HttpsError('not-found', 'Invitation not found.');
  if (snapshot.data()?.status !== 'pending') {
    throw new functions.https.HttpsError('failed-precondition', 'Only pending invitations can be revoked.');
  }
  await invitationRef.update({
    status: 'revoked',
    revokedBy: context.auth.uid,
    revokedAt: admin.firestore.FieldValue.serverTimestamp(),
    tokenHash: admin.firestore.FieldValue.delete(),
  });
  return { revoked: true };
});

// Unauthenticated: lets the acceptance page validate a token and show the target
// email before the visitor creates an account, so a bad/expired link never leaves
// behind an orphaned Firebase Auth user with no invitation to redeem.
exports.previewInvitation = callable.https.onCall(async (data) => {
  const appId = typeof data?.appId === 'string' ? data.appId.trim() : '';
  const token = typeof data?.token === 'string' ? data.token.trim() : '';
  if (!appId || !token) throw new functions.https.HttpsError('invalid-argument', 'appId and token are required.');

  const firestore = admin.firestore();
  const snapshot = await firestore.collectionGroup('invitations').where('tokenHash', '==', hashToken(token)).limit(10).get();
  const invitationDoc = snapshot.docs.find((doc) => doc.ref.path.startsWith(`artifacts/${appId}/organizations/`));
  if (!invitationDoc) return { valid: false, reason: 'not_found' };

  const invitation = invitationDoc.data() || {};
  if (invitation.status === 'revoked') return { valid: false, reason: 'revoked', email: invitation.emailNormalized };
  if (invitation.status === 'accepted') return { valid: false, reason: 'already_used', email: invitation.emailNormalized };
  if (invitation.expiresAt?.toMillis?.() <= Date.now()) return { valid: false, reason: 'expired', email: invitation.emailNormalized };
  if (invitation.status !== 'pending') return { valid: false, reason: 'invalid', email: invitation.emailNormalized };
  return { valid: true, email: invitation.emailNormalized };
});

exports.acceptTraineeInvitation = callable.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in before accepting an invitation.');
  const appId = typeof data?.appId === 'string' ? data.appId.trim() : '';
  const token = typeof data?.token === 'string' ? data.token.trim() : '';
  if (!appId || !token) throw new functions.https.HttpsError('invalid-argument', 'appId and token are required.');

  const firestore = admin.firestore();
  const snapshot = await firestore.collectionGroup('invitations').where('tokenHash', '==', hashToken(token)).limit(10).get();
  const invitationDoc = snapshot.docs.find((doc) => doc.ref.path.startsWith(`artifacts/${appId}/organizations/`));
  if (!invitationDoc) throw new functions.https.HttpsError('not-found', 'Invitation is invalid or expired.');
  const invitationRef = invitationDoc.ref;
  const invitation = invitationDoc.data() || {};
  const email = normalizeEmail(context.auth.token?.email);
  if (invitation.status !== 'pending' || invitation.expiresAt?.toMillis?.() <= Date.now() || email !== invitation.emailNormalized) {
    throw new functions.https.HttpsError('failed-precondition', 'Invitation is no longer valid for this account.');
  }

  const userRef = firestore.doc(`artifacts/${appId}/users/${context.auth.uid}/userProfileData/profile`);
  await firestore.runTransaction(async (transaction) => {
    const current = await transaction.get(invitationRef);
    if (!current.exists || current.data()?.status !== 'pending') {
      throw new functions.https.HttpsError('already-exists', 'Invitation has already been accepted.');
    }
    transaction.set(userRef, {
      email,
      role: 'trainee',
      orgId: invitation.orgId,
      lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.update(invitationRef, {
      status: 'accepted',
      acceptedBy: context.auth.uid,
      acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
      tokenHash: admin.firestore.FieldValue.delete(),
    });
  });

  const user = await admin.auth().getUser(context.auth.uid);
  await admin.auth().setCustomUserClaims(context.auth.uid, {
    ...(user.customClaims || {}),
    role: 'trainee',
    orgId: invitation.orgId,
  });
  return { accepted: true, orgId: invitation.orgId };
});

exports.listOrganizationInvitations = callable.https.onCall(async (data, context) => {
  const appId = typeof data?.appId === 'string' ? data.appId.trim() : '';
  if (!appId) throw new functions.https.HttpsError('invalid-argument', 'appId is required.');
  const firestore = admin.firestore();
  const { requesterOrgId } = await requireOrgManager({ context, appId, firestore, logLabel: 'listOrganizationInvitations' });
  const snapshot = await firestore.collection(`artifacts/${appId}/organizations/${requesterOrgId}/invitations`).orderBy('createdAt', 'desc').limit(100).get();
  return { invitations: snapshot.docs.map((doc) => {
    const data = { ...doc.data() };
    delete data.tokenHash;
    return { id: doc.id, ...data };
  }) };
});
