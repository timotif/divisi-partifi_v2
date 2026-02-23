import { useState } from 'react';
import { X } from 'lucide-react';
import ComposerInput from './ComposerInput';

/**
 * Modal for editing a composition (score metadata).
 *
 * Props:
 *   score    object — pre-filled values: { score_id, title, composer, composer_id? }
 *   onSave   fn({ title, composer, composer_id }) — called after successful save
 *   onClose  fn()  — called on × / Escape / backdrop click
 */
const ScoreModal = ({ score, onSave, onClose }) => {
  const [title, setTitle]               = useState(score.title    || '');
  const [composerText, setComposerText] = useState(score.composer || '');
  const [composerId, setComposerId]     = useState(score.composer_id || null);
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState(null);

  const handleComposerSelect = (sel) => {
    if (sel) {
      setComposerId(sel.composer_id);
      setComposerText(sel.displayName);
    } else {
      setComposerId(null);
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    setSaving(true);
    setError(null);

    try {
      const body = { title: title.trim(), composer: composerText };
      if (composerId) body.composer_id = composerId;

      const res = await fetch(`/api/scores/${score.score_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Update failed');
      }
      onSave({ title: title.trim(), composer: composerText, composer_id: composerId });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onMouseDown={handleBackdrop}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <h2 className="text-sm font-semibold text-gray-800">Edit composition</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          {error && (
            <p className="text-xs text-danger bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </p>
          )}

          <div>
            <label className="block text-xs text-gray-500 mb-1">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border border-surface-border rounded-md text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Composer</label>
            <ComposerInput
              value={composerText}
              onChange={setComposerText}
              onSelect={handleComposerSelect}
              initialLocked={!!score.composer_id}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-surface-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 border border-surface-border rounded text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 bg-accent text-white rounded text-sm hover:bg-accent/80 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ScoreModal;
