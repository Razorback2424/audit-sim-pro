import React, { useEffect, useState } from 'react';
import { createUserWithEmailAndPassword, getAuth } from 'firebase/auth';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Input, useAuth, useModal } from '../AppCore';
import { acceptTraineeInvitation, previewInvitation } from '../services/invitationService';

const INVALID_REASON_COPY = {
  not_found: 'This invitation link is invalid.',
  revoked: 'This invitation has been revoked by your organization.',
  already_used: 'This invitation has already been accepted.',
  expired: 'This invitation has expired. Ask your instructor to send a new one.',
  invalid: 'This invitation is no longer valid.',
};

export default function InviteAcceptancePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { showModal } = useModal();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(true);
  const [preview, setPreview] = useState(null);
  const token = params.get('token') || '';

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setPreview({ valid: false, reason: 'not_found' });
      setChecking(false);
      return undefined;
    }
    setChecking(true);
    previewInvitation(token)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((error) => {
        if (!cancelled) setPreview({ valid: false, reason: 'invalid', message: error?.message });
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const accept = async (event) => {
    event.preventDefault();
    if (!preview?.valid) return;
    if (!currentUser && (password.length < 6 || password !== confirm)) {
      return showModal('Enter a password (6+ characters) and confirm it.', 'Check your information');
    }
    setSubmitting(true);
    try {
      if (!currentUser) await createUserWithEmailAndPassword(getAuth(), preview.email, password);
      await acceptTraineeInvitation(token);
      await getAuth().currentUser?.getIdToken(true);
      navigate('/trainee', { replace: true });
    } catch (error) {
      showModal(error?.message || 'Unable to accept this invitation.', 'Invitation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const emailMismatch = Boolean(currentUser?.email) && preview?.valid && currentUser.email.toLowerCase() !== preview.email;

  return (
    <div className="max-w-md mx-auto mt-10 p-6 bg-white border border-gray-200 rounded-md shadow-sm">
      <h1 className="text-2xl font-semibold text-gray-900 mb-2">Accept your AuditSim invitation</h1>

      {checking ? (
        <p className="text-sm text-gray-600">Checking your invitation…</p>
      ) : !preview?.valid ? (
        <div className="space-y-4">
          <p className="text-sm text-red-700">{INVALID_REASON_COPY[preview?.reason] || INVALID_REASON_COPY.invalid}</p>
          <Link to="/login" className="text-sm text-blue-600 hover:underline">Go to sign in</Link>
        </div>
      ) : emailMismatch ? (
        <div className="space-y-4">
          <p className="text-sm text-red-700">
            You are signed in as {currentUser.email}, but this invitation was sent to {preview.email}. Sign out and try again with that account.
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-600 mb-6">
            {currentUser
              ? `Join your organization as ${preview.email}.`
              : `Create your trainee account for ${preview.email} to join the organization and receive assigned cases.`}
          </p>
          <form onSubmit={accept} className="space-y-4">
            {!currentUser && <>
              <Input type="password" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} required />
              <Input type="password" placeholder="Confirm password" value={confirm} onChange={(event) => setConfirm(event.target.value)} minLength={6} required />
            </>}
            <Button type="submit" disabled={submitting}>{submitting ? 'Accepting…' : 'Accept invitation'}</Button>
          </form>
        </>
      )}
    </div>
  );
}
