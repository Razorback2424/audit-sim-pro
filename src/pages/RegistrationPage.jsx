

import React, { useEffect, useRef, useState } from 'react';
import { useAuth, useUser, useModal, Input, Button, useRoute } from '../AppCore';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';

const RegistrationPage = () => {
  const { currentUser } = useAuth();
  const { setRole } = useUser();
  const { showModal } = useModal();
  const { navigate, route, query } = useRoute();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [role, setSelectedRole] = useState('admin'); // allow choosing owner/admin/trainee for testing
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const plan = typeof query?.plan === 'string' ? query.plan.trim().toLowerCase() : '';

  const emailRef = useRef(null);

  useEffect(() => {
    if (emailRef.current) emailRef.current.focus();
  }, []);

  useEffect(() => {
    if (plan === 'individual') {
      setSelectedRole('trainee');
    }
  }, [plan]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmedEmail = (email || '').trim();
    if (!trimmedEmail || !password || !confirm) {
      showModal?.('Please fill out all fields.', 'Missing information');
      return;
    }
    if (password.length < 6) {
      showModal?.('Password must be at least 6 characters.', 'Weak password');
      return;
    }
    if (password !== confirm) {
      showModal?.('Passwords do not match.', 'Confirmation mismatch');
      return;
    }
    if (role !== 'admin' && role !== 'owner' && role !== 'trainee') {
      showModal?.('Please choose a role.', 'Missing role');
      return;
    }

    setSubmitting(true);
    try {
      const auth = getAuth();
      const cred = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
      const user = cred.user;
      // Create the role document via existing helper (writes to Firestore: roles/{uid})
      await setRole(role, user);
      showModal?.('Account created successfully. You are now signed in.', 'Success');
      // Respect any ?next=... redirect in the current hash route
      const [, queryString] = (route || '').split('?');
      const params = new URLSearchParams(queryString || '');
      const next = params.get('next');
      if (next) {
        navigate(next);
      } else if (plan === 'individual') {
        navigate('/checkout?plan=individual');
      } else {
        navigate('/home');
      }
    } catch (err) {
      console.error('Registration error:', err);
      showModal?.(`Registration failed: ${err?.message || 'Unknown error'}`, 'Registration Error');
    } finally {
      setSubmitting(false);
    }
  };

  if (currentUser) {
    return (
      <div className="max-w-md mx-auto mt-10 p-6 bg-white border border-gray-200 rounded-md shadow-sm">
        <h1 className="text-xl font-semibold text-gray-800 mb-2">Already signed in</h1>
        <p className="text-sm text-gray-600 mb-4">
          You are already signed in. Use the app or sign out before creating a new account.
        </p>
        <div className="flex gap-2">
        <Button type="button" onClick={() => navigate('/home')}>Go to app</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-10 p-6 bg-white border border-gray-200 rounded-md shadow-sm">
      <h1 className="text-2xl font-semibold text-gray-800 mb-1">Create your account</h1>
      <p className="text-sm text-gray-500 mb-6">
        {plan === 'individual'
          ? 'Register to unlock individual access.'
          : 'Register with email and password, and choose your role.'}
      </p>

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
              autoComplete="new-password"
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

        <div>
          <label htmlFor="confirm" className="block text-xs font-medium text-gray-700">Confirm Password</label>
          <Input
            id="confirm"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="••••••••"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mt-1 w-full"
            required
            minLength={6}
          />
        </div>

        {plan === 'individual' ? null : (
          <div>
            <span className="block text-xs font-medium text-gray-700 mb-1">Choose role</span>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-gray-800">
                <input
                  type="radio"
                  name="role"
                  value="owner"
                  checked={role === 'owner'}
                  onChange={() => setSelectedRole('owner')}
                />
                <span>Owner</span>
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-800">
                <input
                  type="radio"
                  name="role"
                  value="admin"
                  checked={role === 'admin'}
                  onChange={() => setSelectedRole('admin')}
                />
                <span>Administrator / Instructor</span>
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-800">
                <input
                  type="radio"
                  name="role"
                  value="trainee"
                  checked={role === 'trainee'}
                  onChange={() => setSelectedRole('trainee')}
                />
                <span>Auditor Trainee</span>
              </label>
            </div>
          </div>
        )}

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>

      <div className="mt-6 text-xs text-gray-400">
        <p>
          Already have an account?{' '}
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="underline text-blue-600 hover:text-blue-700"
          >
            Sign in
          </button>.
        </p>
      </div>
    </div>
  );
};

export default RegistrationPage;
