import { useState } from 'react';
import { X } from 'lucide-react';

/**
 * Modal for splitting off a new setup version from this moment on.
 *
 * Deliberately not called "Save as": autosave has already written every edit
 * into the current version, so there is nothing pending to save elsewhere.
 * What the user is choosing is where *future* edits go — see
 * docs/adr/0001-save-as-moves-the-active-setup-version.md. The copy says so
 * plainly, because the document-editor reading ("my unsaved work moves to the
 * new file") is wrong here and quietly surprising.
 *
 * The caller owns the POST so it can adopt the canonical name the server
 * returns; this component only collects the name and surfaces failures.
 *
 * Props:
 *   currentVersion  string — the version being edited now, shown for context
 *   existingNames   string[] — for a hint only; the server owns the real check
 *   onSave          fn(name) -> Promise — rejects with an Error to display
 *   onClose         fn() — × / Cancel / backdrop click
 */
const NewVersionModal = ({ currentVersion, existingNames = [], onSave, onClose }) => {
  const [name, setName]     = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  // A hint, not a gate: the server normalizes the name before comparing, so
  // only it can say for certain whether the name is free.
  const looksTaken = existingNames.includes(name.trim());

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(name.trim());
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !saving) handleSave();
    if (e.key === 'Escape') onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onMouseDown={handleBackdrop}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <h2 className="text-sm font-semibold text-gray-800">Start a new version</h2>
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
            <label className="block text-xs text-gray-500 mb-1">Version name *</label>
            <input
              type="text"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. Reduced strings"
              className="w-full px-3 py-2 border border-surface-border rounded-md text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-accent"
            />
            {looksTaken && !error && (
              <p className="text-xs text-amber-600 mt-1">
                A version with this name already exists.
              </p>
            )}
          </div>

          <p className="text-xs text-gray-500">
            Everything up to now — including your most recent edits — stays in{' '}
            <strong>{currentVersion}</strong>. Changes you make{' '}
            <em>after</em> this point go into the new version.
          </p>
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
            disabled={saving || !name.trim()}
            className="px-4 py-1.5 bg-accent text-white rounded text-sm hover:bg-accent/80 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Starting…' : 'Start'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default NewVersionModal;
