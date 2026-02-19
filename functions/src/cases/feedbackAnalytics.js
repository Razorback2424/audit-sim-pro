const toCategory = (note = '') => {
  if (typeof note !== 'string') return '';
  const trimmed = note.trim();
  if (!trimmed) return '';
  const idx = trimmed.indexOf(':');
  if (idx > 0) return trimmed.slice(0, idx).trim();
  return trimmed.split(/\s+/).slice(0, 4).join(' ').trim();
};

const toSeverity = (note = '') => {
  const text = typeof note === 'string' ? note.trim().toLowerCase() : '';
  if (!text) return 'low';
  if (
    text.includes('error') ||
    text.includes('deficiency') ||
    text.includes('mismatch') ||
    text.includes('unrecorded liability') ||
    text.includes('critical')
  ) {
    return 'high';
  }
  if (text.includes('warning') || text.includes('review note') || text.includes('missing')) {
    return 'medium';
  }
  return 'low';
};

const buildFeedbackSignalProps = (virtualSeniorFeedback = []) => {
  const entries = Array.isArray(virtualSeniorFeedback) ? virtualSeniorFeedback : [];
  const categoryCounts = {};
  const severityCounts = { high: 0, medium: 0, low: 0 };
  let noteCount = 0;

  entries.forEach((entry) => {
    const notes = Array.isArray(entry?.notes) ? entry.notes : [];
    notes.forEach((note) => {
      if (typeof note !== 'string' || !note.trim()) return;
      noteCount += 1;
      const category = toCategory(note);
      const severity = toSeverity(note);
      if (category) {
        categoryCounts[category] = (categoryCounts[category] || 0) + 1;
      }
      severityCounts[severity] = (severityCounts[severity] || 0) + 1;
    });
  });

  const topCategory =
    Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const topSeverity =
    Object.entries(severityCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  return {
    noteCount,
    categoriesCount: Object.keys(categoryCounts).length,
    categoryCounts,
    severityCounts,
    topCategory,
    topSeverity,
  };
};

module.exports = {
  toCategory,
  toSeverity,
  buildFeedbackSignalProps,
};
