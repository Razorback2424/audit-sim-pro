import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const sanitizeParams = (params = {}) => {
  const cleaned = {};
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    cleaned[key] = Array.isArray(value) ? value.join(',') : String(value);
  });
  return cleaned;
};

export function useRoute() {
  const navigate = useNavigate();
  const location = useLocation();

  const query = useMemo(() => {
    const params = {};
    const search = new URLSearchParams(location.search);
    search.forEach((value, key) => {
      params[key] = value;
    });
    return params;
  }, [location.search]);

  const setQuery = useCallback(
    (updater, options = {}) => {
      const base = options.merge === false ? {} : { ...query };
      const updates = typeof updater === 'function' ? updater({ ...base }) : updater || {};
      const merged = options.merge === false ? sanitizeParams(updates) : sanitizeParams({ ...base, ...updates });
      const searchParams = new URLSearchParams();
      Object.entries(merged).forEach(([key, value]) => {
        searchParams.set(key, value);
      });
      const targetPath = options.path || location.pathname;
      const searchString = searchParams.toString();
      const hash =
        typeof options.hash === 'string'
          ? options.hash
          : options.keepHash === false
            ? ''
            : location.hash || '';
      const target = `${targetPath}${searchString ? `?${searchString}` : ''}${hash}`;
      navigate(target, { replace: !!options.replace });
    },
    [navigate, location.pathname, location.hash, query]
  );

  return {
    navigate,
    query,
    setQuery,
    path: location.pathname,
    route: `${location.pathname}${location.search}`,
  };
}
