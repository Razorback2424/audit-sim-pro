import React, { useEffect, useState } from 'react';
import { Button, useModal, useRoute } from '../AppCore';
import InstructionStep from '../components/caseForm/InstructionStep';
import { getCaseRecipe } from '../generation/recipeRegistry';
import { createRecipe, fetchRecipe, updateRecipe } from '../services/recipeService';

const toTrimmedString = (value) =>
  typeof value === 'string' ? value.trim() : value === null || value === undefined ? '' : String(value);

export default function RecipeFormPage({ params }) {
  const { recipeId } = params || {};
  const isEditing = Boolean(recipeId);
  const { navigate } = useRoute();
  const { showModal } = useModal();

  const [moduleId, setModuleId] = useState('');
  const [title, setTitle] = useState('');
  const [moduleTitle, setModuleTitle] = useState('');
  const [pathId, setPathId] = useState('');
  const [tier, setTier] = useState('foundations');
  const [auditArea, setAuditArea] = useState('');
  const [primarySkill, setPrimarySkill] = useState('');
  const [recipeVersion, setRecipeVersion] = useState(1);
  const [isActive, setIsActive] = useState(true);
  const [workflow, setWorkflow] = useState({ steps: ['instruction', 'selection', 'testing', 'results'], gateScope: 'once' });
  const [generationConfig, setGenerationConfig] = useState({});
  const [instruction, setInstruction] = useState({
    title: '',
    moduleCode: '',
    version: 1,
    hook: { headline: '', risk: '', body: '' },
    visualAsset: { type: 'VIDEO', source_id: '', alt: '' },
    heuristic: { rule_text: '', reminder: '' },
    gateCheck: {
      question: '',
      success_message: '',
      failure_message: '',
      options: [
        { id: 'opt1', text: '', correct: false, feedback: '' },
        { id: 'opt2', text: '', correct: true, feedback: '' },
      ],
    },
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isEditing) return;
    setLoading(true);
    fetchRecipe(recipeId)
      .then((recipe) => {
        if (!recipe) {
          try {
            const coded = getCaseRecipe(recipeId);
            setModuleId(recipeId);
            setTitle(coded.label || '');
            setModuleTitle(coded.moduleTitle || coded.label || '');
            setPathId(coded.pathId || '');
            setTier(coded.tier || 'foundations');
            setAuditArea(coded.auditArea || '');
            setPrimarySkill(coded.primarySkill || '');
            setRecipeVersion(coded.version || 1);
            setWorkflow(coded.workflow || { steps: ['instruction', 'selection', 'testing', 'results'], gateScope: 'once' });
            setGenerationConfig(coded.generationConfig || {});
          } catch (error) {
            console.error('Recipe metadata missing:', error);
            setModuleId(recipeId);
          }
          return;
        }
        setModuleId(recipe.moduleId || recipe.id);
        setTitle(recipe.title || '');
        setModuleTitle(recipe.moduleTitle || '');
        setPathId(recipe.pathId || '');
        setTier(recipe.tier || 'foundations');
        setAuditArea(recipe.auditArea || '');
        setPrimarySkill(recipe.primarySkill || '');
        setRecipeVersion(recipe.recipeVersion || 1);
        setIsActive(recipe.isActive !== false);
        setInstruction((prev) => recipe.instruction || prev);
        setWorkflow(recipe.workflow || { steps: ['instruction', 'selection', 'testing', 'results'], gateScope: 'once' });
        setGenerationConfig(recipe.generationConfig || {});
      })
      .catch((error) => {
        console.error('Failed to load recipe:', error);
        showModal('Unable to load recipe.', 'Error');
      })
      .finally(() => setLoading(false));
  }, [isEditing, recipeId, showModal]);

  useEffect(() => {
    setInstruction((prev) => ({ ...prev, version: recipeVersion }));
  }, [recipeVersion]);

  const handleSave = async (event) => {
    event.preventDefault();
    const trimmedModuleId = toTrimmedString(moduleId);
    if (!trimmedModuleId) {
      showModal('Module ID is required.', 'Validation Error');
      return;
    }
    if (!toTrimmedString(title) && !toTrimmedString(moduleTitle)) {
      showModal('Add a title for this recipe.', 'Validation Error');
      return;
    }
    if (!toTrimmedString(pathId)) {
      showModal('Path ID is required.', 'Validation Error');
      return;
    }
    if (!toTrimmedString(auditArea)) {
      showModal('Audit area is required.', 'Validation Error');
      return;
    }

    const payload = {
      moduleId: trimmedModuleId,
      title: toTrimmedString(title) || toTrimmedString(moduleTitle),
      moduleTitle: toTrimmedString(moduleTitle) || toTrimmedString(title),
      pathId: toTrimmedString(pathId),
      tier,
      auditArea: toTrimmedString(auditArea),
      primarySkill: toTrimmedString(primarySkill),
      instruction: { ...instruction, version: recipeVersion },
      workflow,
      generationConfig,
      recipeVersion: recipeVersion,
      isActive: Boolean(isActive),
    };

    setLoading(true);
    try {
      if (isEditing) {
        await updateRecipe(recipeId, payload);
        showModal('Recipe updated successfully.', 'Success');
      } else {
        const result = await createRecipe(payload);
        if (!result.created && result.existingId) {
          showModal('Recipe already exists. Opening existing recipe.', 'Recipe Exists');
          navigate(`/admin/edit-recipe/${result.existingId}`);
          return;
        }
        showModal('Recipe created successfully.', 'Success');
        navigate(`/admin/edit-recipe/${trimmedModuleId}`);
      }
    } catch (error) {
      console.error('Failed to save recipe:', error);
      showModal(error?.message || 'Unable to save recipe.', 'Error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">
              {isEditing ? 'Edit Recipe Details' : 'Create Recipe'}
            </h1>
            <p className="text-sm text-gray-600">
              Update the instructional video and gate check.
            </p>
          </div>
          <Button variant="secondary" onClick={() => navigate('/admin')}>
            Back to dashboard
          </Button>
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <InstructionStep instructionData={{ instruction, setInstruction }} />
          </section>

          <div className="flex items-center justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => navigate('/admin')}>
              Cancel
            </Button>
            <Button type="submit" isLoading={loading}>
              {isEditing ? 'Save details' : 'Create recipe'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
