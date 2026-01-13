import React from 'react';
import { Input, Textarea, Button } from '../../AppCore';
import { PlusCircle, Trash2 } from 'lucide-react';
import StepIntro from './StepIntro';

export default function InstructionStep({ instructionData }) {
  const { instruction, setInstruction } = instructionData;

  const updateNested = (parent, field, value) => {
    setInstruction((prev) => ({
      ...prev,
      [parent]: { ...(prev[parent] || {}), [field]: value },
    }));
  };

  const parseVideoSource = (value) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return { sourceId: '', url: '' };
    const urlMatch = trimmed.match(
      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{6,})/i
    );
    if (urlMatch) {
      return { sourceId: urlMatch[1], url: '' };
    }
    if (/^[A-Za-z0-9_-]{6,}$/.test(trimmed)) {
      return { sourceId: trimmed, url: '' };
    }
    return { sourceId: '', url: trimmed };
  };

  const handleVideoChange = (value) => {
    const { sourceId, url } = parseVideoSource(value);
    setInstruction((prev) => ({
      ...prev,
      visualAsset: { ...(prev.visualAsset || {}), type: 'VIDEO', source_id: sourceId, url },
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
        title="Instruction setup"
        items={[
          'Paste the training video link (or YouTube ID).',
          'Define the gate check question and answers.',
        ]}
      />

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-base font-semibold text-gray-800">Instruction Video</h3>
        <label className="block text-sm font-medium text-gray-700">YouTube link or ID</label>
        <Input
          value={instruction?.visualAsset?.source_id || instruction?.visualAsset?.url || ''}
          onChange={(e) => handleVideoChange(e.target.value)}
          placeholder="Paste a YouTube link or ID"
          className="mt-2"
        />
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-base font-semibold text-gray-800">Gate Check</h3>
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
