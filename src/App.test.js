import { render, screen } from '@testing-library/react';
// Import App lazily within the test to avoid Firebase initialization at
// test suite load time. Firebase config is missing in the test environment
// so initializing during import would throw.

test.skip('shows login screen after initial load', async () => {
  const App = require('./App').default;
  render(<App />);
  const roleHeading = await screen.findByText(/select your role/i);
  expect(roleHeading).toBeInTheDocument();
});
