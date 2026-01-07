import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import LoginPage from './LoginPage';

const appCoreMocks = {};

jest.mock('../AppCore', () => {
  const React = require('react');
  const navigateMock = jest.fn();
  const showModalMock = jest.fn();
  const loginMock = jest.fn();

  appCoreMocks.navigateMock = navigateMock;
  appCoreMocks.showModalMock = showModalMock;
  appCoreMocks.loginMock = loginMock;

  return {
    Button: React.forwardRef(({ children, ...props }, ref) => (
      <button ref={ref} {...props}>
        {children}
      </button>
    )),
    Input: React.forwardRef(({ onChange, ...props }, ref) => <input ref={ref} onChange={onChange} {...props} />),
    useModal: () => ({ showModal: showModalMock }),
    useRoute: () => ({ route: '/login', navigate: navigateMock, query: {} }),
    useUser: () => ({ role: 'trainee', loadingRole: true }),
    useAuth: () => ({
      currentUser: null,
      userId: null,
      login: loginMock,
      logout: jest.fn(),
    }),
  };
});

describe('LoginPage', () => {
  let consoleWarnSpy;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy?.mockRestore?.();
    jest.useRealTimers();
  });

  test('does not hang if token claim lookup stalls', async () => {
    const neverResolves = new Promise(() => {});
    appCoreMocks.loginMock.mockResolvedValue({
      getIdTokenResult: () => neverResolves,
    });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'student@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled();

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      jest.advanceTimersByTime(8000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(appCoreMocks.navigateMock).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^sign in$/i })).not.toBeDisabled();
  });
});
