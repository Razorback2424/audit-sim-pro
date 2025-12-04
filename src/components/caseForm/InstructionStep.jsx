import React from 'react';
import { Input, Select, Textarea, Button } from '../../AppCore';
import { PlusCircle, Trash2 } from 'lucide-react';
import StepIntro from './StepIntro';

export default function InstructionStep({ instructionData }) {
  const { instruction, setInstruction } = instructionData;

  const update = (field, value) => {
    setInstruction((prev) => ({ ...prev, [field]: value }));
  };

  const updateNested = (parent, field, value) => {
    setInstruction((prev) => ({
      ...prev,
      [parent]: { ...(prev[parent] || {}), [field]: value },
    }));
  };

  const updateOption = (index, field, value) => {
    setInstruction((prev) => {
      const currentOptions = Array.isArray(prev.gateCheck?.options) ? prev.gateCheck.options : [];
      const newOptions = [...currentOptions];
      newOptions[index] = { ...(newOptions[index] || {}), [field]: value };
      return {
        ...prev,
        gateCheck: { ...(prev.gateCheck || {}), options: newOptions },
      };
    });
  };

  const addOption = () => {
    setInstruction((prev) => ({
      ...prev,
      gateCheck: {
        ...(prev.gateCheck || {}),
        options: [
          ...(Array.isArray(prev.gateCheck?.options) ? prev.gateCheck.options : []),
          { id: `opt${Date.now()}`, text: '', correct: false, feedback: '' },
        ],
      },
    }));
  };

  const removeOption = (index) => {
    setInstruction((prev) => ({
      ...prev,
      gateCheck: {
        ...(prev.gateCheck || {}),
        options: (Array.isArray(prev.gateCheck?.options) ? prev.gateCheck.options : []).filter(
          (_, i) => i !== index
        ),
      },
    }));
  };

  const options = Array.isArray(instruction?.gateCheck?.options)
    ? instruction.gateCheck.options
    : [];

  return (
    <div className="space-y-8">
      <StepIntro
        title="Configure the Briefing Room"
        items={[
          'Set the context: Why does this audit task matter?',
          'Define the Golden Rule (Heuristic) the trainee must learn.',
          'Set the Gate Question that blocks entry until mastered.',
        ]}
      />

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-base font-semibold text-gray-800">Module Identity</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">Instruction Title</label>
            <Input
              value={instruction?.title || ''}
              onChange={(e) => update('title', e.target.value)}
              placeholder="e.g. Search for Unrecorded Liabilities"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Module Code</label>
            <Input
              value={instruction?.moduleCode || ''}
              onChange={(e) => update('moduleCode', e.target.value)}
              placeholder="e.g. SURL-101"
            />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-base font-semibold text-gray-800">The Hook (Context)</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Headline</label>
            <Input
              value={instruction?.hook?.headline || ''}
              onChange={(e) => updateNested('hook', 'headline', e.target.value)}
              placeholder="e.g. The Silent Profit Killer"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Risk Statement</label>
            <Input
              value={instruction?.hook?.risk || ''}
              onChange={(e) => updateNested('hook', 'risk', e.target.value)}
              placeholder="e.g. Risk of Material Misstatement (Completeness)"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Body Text</label>
            <Textarea
              value={instruction?.hook?.body || ''}
              onChange={(e) => updateNested('hook', 'body', e.target.value)}
              rows={3}
              placeholder="Explain the 'Why'..."
            />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-base font-semibold text-gray-800">Visual Asset</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">Asset Type</label>
            <Select
              value={instruction?.visualAsset?.type || 'VIDEO'}
              onChange={(e) => updateNested('visualAsset', 'type', e.target.value)}
              options={[
                { value: 'VIDEO', label: 'YouTube Video' },
                { value: 'IMAGE', label: 'Image URL' },
              ]}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Source ID / URL</label>
            <Input
              value={instruction?.visualAsset?.source_id || instruction?.visualAsset?.url || ''}
              onChange={(e) => updateNested('visualAsset', 'source_id', e.target.value)}
              placeholder={
                (instruction?.visualAsset?.type || 'VIDEO') === 'VIDEO'
                  ? 'YouTube ID (e.g. dQw4w9WgXcQ)'
                  : 'https://...'
              }
            />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-base font-semibold text-gray-800">The Golden Rule</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Rule Text</label>
            <Textarea
              value={instruction?.heuristic?.rule_text || ''}
              onChange={(e) => updateNested('heuristic', 'rule_text', e.target.value)}
              placeholder="e.g. Service Date is King. Ignore the Invoice Date."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Reminder / Tip</label>
            <Input
              value={instruction?.heuristic?.reminder || ''}
              onChange={(e) => updateNested('heuristic', 'reminder', e.target.value)}
              placeholder="Short tip shown during the sim"
            />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-base font-semibold text-gray-800">Gate Check (Protocol Quiz)</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Question</label>
            <Textarea
              value={instruction?.gateCheck?.question || ''}
              onChange={(e) => updateNested('gateCheck', 'question', e.target.value)}
              placeholder="Scenario question to test understanding..."
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">Options</label>
            {options.map((opt, idx) => (
              <div key={opt?.id || idx} className="flex items-start gap-2 rounded border bg-gray-50 p-2">
                <input
                  type="radio"
                  name="correctOption"
                  checked={!!opt?.correct}
                  onChange={() => {
                    const newOptions = options.map((o, i) => ({ ...(o || {}), correct: i === idx }));
                    updateNested('gateCheck', 'options', newOptions);
                  }}
                  className="mt-3 h-4 w-4 text-blue-600"
                />
                <div className="flex-1 space-y-2">
                  <Input
                    value={opt?.text || ''}
                    onChange={(e) => updateOption(idx, 'text', e.target.value)}
                    placeholder="Option text"
                  />
                  <Input
                    value={opt?.feedback || ''}
                    onChange={(e) => updateOption(idx, 'feedback', e.target.value)}
                    placeholder="Feedback if selected"
                    className="text-xs"
                  />
                </div>
                <Button
                  variant="secondary"
                  onClick={() => removeOption(idx)}
                  type="button"
                  className="text-red-500"
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            ))}
            <Button variant="secondary" onClick={addOption} type="button" className="text-sm">
              <PlusCircle size={14} className="mr-1" /> Add Option
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">Success Message</label>
              <Input
                value={instruction?.gateCheck?.success_message || ''}
                onChange={(e) => updateNested('gateCheck', 'success_message', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Failure Message</label>
              <Input
                value={instruction?.gateCheck?.failure_message || ''}
                onChange={(e) => updateNested('gateCheck', 'failure_message', e.target.value)}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
