

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth, Input, Button, useModal, useRoute, useUser } from '../AppCore';

const LoginPage = () => {
  const { currentUser, userId, login, logout } = useAuth();
  const { showModal } = useModal();
  const { route, navigate, query } = useRoute();
  const { role, loadingRole } = useUser();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [debugEvents, setDebugEvents] = useState([]);

  const emailRef = useRef(null);

  const debugEnabled = query?.debugAuth === '1';

  const pushDebug = (message, meta) => {
    if (!debugEnabled) return;
    const entry = {
      ts: new Date().toISOString(),
      message,
      meta: meta && typeof meta === 'object' ? meta : undefined,
    };
    setDebugEvents((prev) => [...prev.slice(-49), entry]);
    // Mirror to console for easy copy/paste from DevTools.
    console.info('[LoginDebug]', message, entry.meta || '');
  };

  const dashboardPath = useMemo(() => {
    if (role === 'admin') return '/admin';
    if (role === 'instructor') return '/instructor';
    if (role === 'trainee') return '/trainee';
    return '/home';
  }, [role]);

  useEffect(() => {
    if (!currentUser) return;
    if (loadingRole) return;
    navigate(dashboardPath, { replace: true });
  }, [currentUser, loadingRole, dashboardPath, navigate]);

  useEffect(() => {
    // Autofocus the email field when page loads
    if (emailRef.current) {
      emailRef.current.focus();
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      showModal?.('Please enter both email and password.', 'Missing information');
      return;
    }
    pushDebug('submit:start', { email: email.trim(), hasPassword: Boolean(password) });
    setSubmitting(true);
    try {
      pushDebug('auth:login:calling');
      const user = await login(email.trim(), password);
      pushDebug('auth:login:resolved', { uid: user?.uid ?? null, email: user?.email ?? null });
      let claimedRole = null;
      try {
        pushDebug('auth:token:refresh:start');
        const token = await Promise.race([
          user.getIdTokenResult(true),
          new Promise((_, reject) =>
            setTimeout(
              () =>
                reject(
                  Object.assign(new Error('Timed out while confirming your session. Please try again.'), {
                    code: 'auth/token-timeout',
                  })
                ),
              8000
            )
          ),
        ]);
        claimedRole = token?.claims?.role || null;
        pushDebug('auth:token:refresh:resolved', { claimedRole });
      } catch (tokenErr) {
        pushDebug('auth:token:refresh:failed', { code: tokenErr?.code ?? null, message: tokenErr?.message ?? String(tokenErr) });
        console.warn('Could not read role claim on login:', tokenErr);
      }
      const resolvedRole = (claimedRole || (!loadingRole ? role : null) || '').toLowerCase();
      const immediateDashboard =
        resolvedRole === 'admin'
          ? '/admin'
          : resolvedRole === 'instructor'
            ? '/instructor'
            : resolvedRole === 'trainee'
              ? '/trainee'
              : '/home';
      // Redirect to ?next=... if provided on the hash route, otherwise to home
      const [, queryString] = (route || '').split('?');
      const params = new URLSearchParams(queryString || '');
      const rawNext = params.get('next');
      const sanitizedNext = rawNext && rawNext !== '/' && rawNext.startsWith('/') ? rawNext : null;
      const next = sanitizedNext || immediateDashboard;
      pushDebug('navigate', { next, resolvedRole, claimedRole, loadingRole, role });
      navigate(next, { replace: true });
    } catch (err) {
      pushDebug('submit:failed', { code: err?.code ?? null, message: err?.message ?? String(err) });
      // login already surfaces a modal, but keep a guard here in case
      if (err?.code === 'auth/timeout' || err?.code === 'auth/token-timeout') {
        showModal?.(err.message, 'Sign-in taking too long');
      } else {
        showModal?.(`Sign-in failed: ${err?.message || 'Unknown error'}`, 'Authentication Error');
      }
    } finally {
      pushDebug('submit:finally');
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      showModal?.('You have been signed out.', 'Signed out');
    } catch (err) {
      showModal?.(`Error signing out: ${err?.message || 'Unknown error'}`, 'Error');
    }
  };

  return (
    <div className="max-w-md mx-auto mt-10 p-6 bg-white border border-gray-200 rounded-md shadow-sm">
      <h1 className="text-2xl font-semibold text-gray-800 mb-1">Sign in</h1>
      <p className="text-sm text-gray-500 mb-6">
        Use your email and password to continue.
      </p>

      {currentUser ? (
        <div className="mb-6 p-3 bg-green-50 border border-green-200 rounded">
          <p className="text-sm text-green-700">
            You are signed in as <span className="font-medium">{currentUser.email || userId}</span>.
          </p>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => navigate(dashboardPath)} variant="secondary" type="button">
              Go to app
            </Button>
            <Button onClick={handleLogout} variant="danger" type="button">
              Sign out
            </Button>
          </div>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="email" className="block text-xs font-medium text-gray-700">Email</label>
          <Input
            id="email"
            ref={emailRef}
            type="email"
            autoComplete="username"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full"
            required
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-xs font-medium text-gray-700">Password</label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full pr-20"
              required
              minLength={6}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-700"
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <div className="mt-6 text-xs text-gray-400">
        <p>
          Need access? Ask an admin to create an account in Firebase Auth and grant you admin role at
          <code className="mx-1">roles/&lt;your-uid&gt;</code>.
        </p>
      </div>

      {debugEnabled ? (
        <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Login debug trace</div>
            <button
              type="button"
              className="text-xs text-blue-700 hover:underline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(JSON.stringify(debugEvents, null, 2));
                  showModal?.('Copied debug trace to clipboard.', 'Copied');
                } catch (e) {
                  console.warn('Clipboard write failed', e);
                }
              }}
            >
              Copy
            </button>
          </div>
          <div className="mt-2 max-h-40 overflow-auto rounded bg-white p-2 font-mono text-[11px]">
            {debugEvents.length === 0 ? (
              <div className="text-slate-500">No events yet.</div>
            ) : (
              debugEvents.map((entry) => (
                <div key={`${entry.ts}-${entry.message}`} className="whitespace-pre">
                  {entry.ts} {entry.message}
                  {entry.meta ? ` ${JSON.stringify(entry.meta)}` : ''}
                </div>
              ))
            )}
          </div>
          <div className="mt-2 text-[11px] text-slate-500">
            Tip: also run <span className="font-mono">localStorage.debugAuth = '1'</span> in the console to enable deeper provider logs.
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default LoginPage;
