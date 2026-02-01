import React, { useMemo, useState } from 'react';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { Button } from '../ui/Button';
import { useModal } from '../../AppCore';

const parseEmails = (raw) =>
  raw
    .split(/[,;\n]/g)
    .map((value) => value.trim())
    .filter(Boolean);

export default function InviteSeatsModal({ defaultSeats = 1 }) {
  const { hideModal } = useModal();
  const [seatCount, setSeatCount] = useState(defaultSeats);
  const [emails, setEmails] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const emailList = useMemo(() => parseEmails(emails), [emails]);

  const handleInvite = () => {
    if (emailList.length === 0) {
      return;
    }
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-gray-700">
          Invites queued for {emailList.length} seat{emailList.length === 1 ? '' : 's'}.
        </p>
        <Button onClick={hideModal}>Done</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="invite-seat-count" className="block text-xs font-medium text-gray-600">
          Seats to add
        </label>
        <Input
          id="invite-seat-count"
          type="number"
          min={1}
          value={seatCount}
          onChange={(event) => setSeatCount(Number(event.target.value) || 1)}
          className="mt-1 w-full"
        />
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
        <p className="mt-2 text-xs text-gray-500">
          We will create {seatCount} seat{seatCount === 1 ? '' : 's'} and send invites to the list above.
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={hideModal}>
          Cancel
        </Button>
        <Button onClick={handleInvite} disabled={emailList.length === 0}>
          Send invites
        </Button>
      </div>
    </div>
  );
}
