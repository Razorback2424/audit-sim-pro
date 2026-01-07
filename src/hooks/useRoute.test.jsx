import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { useRoute } from './useRoute';

function Harness({ initialQuery = {}, options = {} }) {
  const { setQuery } = useRoute();
  const location = useLocation();
  return (
    <div>
      <div data-testid="route">{`${location.pathname}${location.search}${location.hash}`}</div>
      <button type="button" onClick={() => setQuery(initialQuery, options)}>
        Apply
      </button>
    </div>
  );
}

test('setQuery preserves hash by default', async () => {
  render(
    <MemoryRouter initialEntries={['/admin#cases']}>
      <Routes>
        <Route path="/admin" element={<Harness initialQuery={{ status: 'draft' }} />} />
      </Routes>
    </MemoryRouter>
  );

  await userEvent.click(screen.getByRole('button', { name: /apply/i }));
  expect(screen.getByTestId('route').textContent).toBe('/admin?status=draft#cases');
});

test('setQuery can drop hash when keepHash is false', async () => {
  render(
    <MemoryRouter initialEntries={['/admin#cases']}>
      <Routes>
        <Route
          path="/admin"
          element={<Harness initialQuery={{ status: 'draft' }} options={{ keepHash: false }} />}
        />
      </Routes>
    </MemoryRouter>
  );

  await userEvent.click(screen.getByRole('button', { name: /apply/i }));
  expect(screen.getByTestId('route').textContent).toBe('/admin?status=draft');
});
