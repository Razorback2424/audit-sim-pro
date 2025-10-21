import { Timestamp } from 'firebase/firestore';

/**
 * @param {unknown} value
 * @returns {value is Timestamp}
 */
export const isTimestamp = (value) => {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof value.toDate === 'function' &&
    typeof value.toMillis === 'function'
  );
};

/**
 * Convert supported inputs into a Date, otherwise null.
 * @param {unknown} value
 * @returns {Date | null}
 */
export const nullSafeDate = (value) => {
  if (!value) return null;
  if (isTimestamp(value)) {
    return value.toDate();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

/**
 * Provide "now" for Firestore comparisons and UI.
 * @returns {{ timestamp: Timestamp, date: Date }}
 */
export const getNow = () => {
  return {
    timestamp: Timestamp.now(),
    date: new Date(),
  };
};
