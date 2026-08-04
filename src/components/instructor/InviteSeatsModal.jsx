import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Textarea } from '../ui/Textarea';
import { Button } from '../ui/Button';
import { createTraineeInvitations, listOrganizationInvitations, revokeTraineeInvitation } from '../../services/invitationService';
import { fetchBillingSummary } from '../../services/billingService';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACTIVE_STATUSES = new Set(['pending', 'accepted']);

const parseEmails = (raw) =>
  Array.from(new Set(raw.split(/[,;\n]/g).map((value) => value.trim().toLowerCase()).filter(Boolean)));

export default function InviteSeatsModal({ orgId }) {
  const [emails, setEmails] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResults, setSendResults] = useState(null);
  const [invitations, setInvitations] = useState([]);
  const [seatCount, setSeatCount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [revokingId, setRevokingId] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [billing, invites] = await Promise.all([
        orgId ? fetchBillingSummary({ orgId }) : Promise.resolve(null),
        listOrganizationInvitations(),
      ]);
      setSeatCount(Number.isFinite(billing?.seatCount) ? billing.seatCount : null);
      setInvitations(invites);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const seatsUsed = useMemo(() => invitations.filter((invite) => ACTIVE_STATUSES.has(invite.status)).length, [invitations]);
  const seatsAvailable = seatCount === null ? null : Math.max(0, seatCount - seatsUsed);

  const parsedEmails = useMemo(() => parseEmails(emails), [emails]);
  const validEmails = useMemo(() => parsedEmails.filter((email) => EMAIL_RE.test(email)), [parsedEmails]);
  const invalidEmails = useMemo(() => parsedEmails.filter((email) => !EMAIL_RE.test(email)), [parsedEmails]);
  const overSeatLimit = seatsAvailable !== null && validEmails.length > seatsAvailable;

  const handleInvite = async () => {
    if (validEmails.length === 0 || overSeatLimit) return;
    setSending(true);
    setSendResults(null);
    try {
      const results = await createTraineeInvitations(validEmails);
      setSendResults(results);
      setEmails('');
      await loadData();
    } catch (error) {
      setSendResults([{ status: 'failed', message: error?.message || 'Unable to send invitations.' }]);
    } finally {
      setSending(false);
    }
  };

  const handleRevoke = async (invitationId) => {
    setRevokingId(invitationId);
    try {
      await revokeTraineeInvitation(invitationId);
      await loadData();
    } finally {
      setRevokingId(null);
    }
  };

  const pendingInvitations = invitations.filter((invite) => invite.status === 'pending');

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-medium text-gray-600 mb-1">Seats</p>
        <p className="text-sm text-gray-800">
          {loading
            ? 'Loading seat availability…'
            : seatsAvailable === null
            ? `${seatsUsed} invitation${seatsUsed === 1 ? '' : 's'} pending or accepted`
            : `${seatsAvailable} of ${seatCount} seat${seatCount === 1 ? '' : 's'} available`}
        </p>
      </div>

      <div>
        <label htmlFor="invite-emails" className="block text-xs font-medium text-gray-600">
          Invite emails
        </label>
        <Textarea
          id="invite-emails"
          rows={4}
          placeholder="name@firm.com, name2@firm.com"
          value={emails}
          onChange={(event) => setEmails(event.target.value)}
          className="mt-1 w-full"
        />
        {invalidEmails.length > 0 && (
          <p className="mt-2 text-xs text-red-600">Not a valid email, will be skipped: {invalidEmails.join(', ')}</p>
        )}
        {overSeatLimit && (
          <p className="mt-2 text-xs text-red-600">
            Only {seatsAvailable} seat{seatsAvailable === 1 ? '' : 's'} available — remove {validEmails.length - seatsAvailable} email{validEmails.length - seatsAvailable === 1 ? '' : 's'} or free up seats first.
          </p>
        )}
        <div className="mt-3 flex justify-end">
          <Button onClick={handleInvite} disabled={validEmails.length === 0 || overSeatLimit || sending}>
            {sending ? 'Sending…' : `Send ${validEmails.length || ''} invite${validEmails.length === 1 ? '' : 's'}`}
          </Button>
        </div>
        {sendResults && (
          <div className="mt-3 space-y-1">
            {sendResults.map((result, index) => {
              const toneClass =
                result.status === 'sent'
                  ? 'text-green-700'
                  : result.status === 'already_invited'
                  ? 'text-amber-700'
                  : 'text-red-700';
              const message =
                result.status === 'sent'
                  ? 'invitation sent'
                  : result.status === 'already_invited'
                  ? 'already has a pending or accepted invitation'
                  : result.message || 'failed to send';
              return (
                <p key={`${result.email || index}`} className={`text-xs ${toneClass}`}>
                  {result.email ? `${result.email}: ` : ''}{message}
                </p>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <p className="text-xs font-medium text-gray-600 mb-2">Pending invitations</p>
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : pendingInvitations.length === 0 ? (
          <p className="text-sm text-gray-500">No pending invitations.</p>
        ) : (
          <ul className="divide-y divide-gray-100 border border-gray-200 rounded-md">
            {pendingInvitations.map((invite) => (
              <li key={invite.id} className="flex items-center justify-between px-3 py-2">
                <span className="text-sm text-gray-800">{invite.emailNormalized}</span>
                <Button
                  variant="danger"
                  className="px-2 py-1 text-xs"
                  onClick={() => handleRevoke(invite.id)}
                  disabled={revokingId === invite.id}
                >
                  {revokingId === invite.id ? 'Revoking…' : 'Revoke'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
