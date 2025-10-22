export const CLASSIFICATION_FIELDS = [
  { key: 'properlyIncluded', label: 'Properly Included' },
  { key: 'properlyExcluded', label: 'Properly Excluded' },
  { key: 'improperlyIncluded', label: 'Improperly Included' },
  { key: 'improperlyExcluded', label: 'Improperly Excluded' },
];

export const createEmptyClassification = () => {
  const template = {};
  CLASSIFICATION_FIELDS.forEach(({ key }) => {
    template[key] = '';
  });
  return template;
};
