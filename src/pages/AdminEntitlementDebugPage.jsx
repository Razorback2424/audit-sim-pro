import React, { useMemo, useState } from 'react';
import { Button, Input, useModal, useRoute, useUser } from '../AppCore';
import { fetchEntitlementDebug, reconcileBillingAccess } from '../services/billingService';

const formatTimestamp = (value) => {
  if (!value) return '—';
  try {
    if (typeof value.toDate === 'function') {
      return value.toDate().toLocaleString();
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
  } catch {
    return '—';
  }
};

const formatValue = (value) => (value === undefined || value === null || value === '' ? '—' : value);

export default function AdminEntitlementDebugPage() {
  const { navigate } = useRoute();
  const { showModal } = useModal();
  const { role, loadingRole } = useUser();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const isAdmin = role === 'admin' || role === 'owner';

  const lookupTarget = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return { targetUid: null, email: null };
    if (trimmed.includes('@')) {
      return { targetUid: null, email: trimmed };
    }
    return { targetUid: trimmed, email: null };
  }, [query]);

  const runLookup = async () => {
    if (!lookupTarget.targetUid && !lookupTarget.email) return;
    setError('');
    setLoading(true);
    try {
      const data = await fetchEntitlementDebug(lookupTarget);
      setResult(data || null);
    } catch (err) {
      console.error('[AdminEntitlementDebug] lookup failed', err);
      setError(err?.message || 'Unable to load entitlement data.');
    } finally {
      setLoading(false);
    }
  };

  const handleReconcile = async () => {
    if (!result?.uid) return;
    setReconciling(true);
    setError('');
    try {
      await reconcileBillingAccess({ targetUid: result.uid });
      await runLookup();
      showModal('Reconcile completed.', 'Entitlement updated');
    } catch (err) {
      console.error('[AdminEntitlementDebug] reconcile failed', err);
      setError(err?.message || 'Unable to reconcile entitlement.');
    } finally {
      setReconciling(false);
    }
  };

  if (loadingRole) {
    return <div className="p-6">Loading…</div>;
  }

  if (!isAdmin) {
    return <div className="p-6">Unauthorized.</div>;
  }

  const billing = result?.billing || null;

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Entitlement Debug</h1>
            <p className="text-sm text-gray-600">
              Read-only entitlement diagnostics and a safe reconcile action.
            </p>
          </div>
          <Button variant="secondary" onClick={() => navigate('/admin')}>
            &larr; Back to Dashboard
          </Button>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3 shadow-sm">
          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="UID or email"
              className="flex-1"
            />
            <Button onClick={runLookup} disabled={loading || (!lookupTarget.targetUid && !lookupTarget.email)}>
              {loading ? 'Searching…' : 'Lookup'}
            </Button>
          </div>
          {error ? <div className="text-sm text-rose-600">{error}</div> : null}
        </div>

        {result ? (
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-xs uppercase text-gray-400">UID</div>
                <div className="font-medium text-gray-900">{formatValue(result.uid)}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-400">Email</div>
                <div className="font-medium text-gray-900">{formatValue(result.email)}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-400">Status</div>
                <div className="font-medium text-gray-900">{formatValue(billing?.status)}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-400">Has Paid Access</div>
                <div className="font-medium text-gray-900">{billing?.status === 'active' ? 'Yes' : 'No'}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-400">Last Update Source</div>
                <div className="font-medium text-gray-900">{formatValue(billing?.lastEntitlementUpdateSource)}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-400">Last Update At</div>
                <div className="font-medium text-gray-900">{formatTimestamp(billing?.lastEntitlementUpdateAt)}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-400">Last Stripe Event</div>
                <div className="font-medium text-gray-900">
                  {formatValue(billing?.lastStripeEventType)} {billing?.lastStripeEventId ? `(${billing.lastStripeEventId})` : ''}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-400">Stripe Event At</div>
                <div className="font-medium text-gray-900">{formatTimestamp(billing?.lastStripeEventAt)}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-400">Stripe Customer</div>
                <div className="font-medium text-gray-900">{formatValue(billing?.stripeCustomerId)}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-400">Stripe Subscription</div>
                <div className="font-medium text-gray-900">{formatValue(billing?.stripeSubscriptionId)}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-400">Subscription Status</div>
                <div className="font-medium text-gray-900">{formatValue(billing?.stripeSubscriptionStatus)}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-400">Last Reconcile</div>
                <div className="font-medium text-gray-900">{formatTimestamp(billing?.lastReconcileAttemptAt)}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-400">Reconcile Result</div>
                <div className="font-medium text-gray-900">{formatValue(billing?.lastReconcileResult)}</div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
              <div className="text-xs text-gray-500">
                Reconcile re-reads Stripe and recomputes entitlement. No manual overrides.
              </div>
              <Button onClick={handleReconcile} disabled={reconciling || !result?.uid}>
                {reconciling ? 'Reconciling…' : 'Reconcile now'}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
