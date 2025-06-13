import { render, screen } from '@testing-library/react';
import App from './App';

test('shows login screen after initial load', async () => {
  render(<App />);
  const roleHeading = await screen.findByText(/select your role/i);
  expect(roleHeading).toBeInTheDocument();
});
