

import React, { useEffect, useRef, useState } from 'react';
import { useAuth, Input, Button, useModal, useRoute } from '../AppCore';

const LoginPage = () => {
  const { currentUser, userId, login, logout } = useAuth();
  const { showModal } = useModal();
  const { route, navigate } = useRoute();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const emailRef = useRef(null);

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
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      // Redirect to ?next=... if provided on the hash route, otherwise to home
      const [, queryString] = (route || '').split('?');
      const params = new URLSearchParams(queryString || '');
      const rawNext = params.get('next');
      const next = rawNext && rawNext.startsWith('/') ? rawNext : '/';
      navigate(next);
    } catch (err) {
      // login already surfaces a modal, but keep a guard here in case
      showModal?.(`Sign-in failed: ${err?.message || 'Unknown error'}`, 'Authentication Error');
    } finally {
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
            <Button onClick={() => navigate('/')} variant="secondary" type="button">
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
    </div>
  );
};

export default LoginPage;
