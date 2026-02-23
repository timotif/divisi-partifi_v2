import { useState } from 'react';
import { X } from 'lucide-react';
import StaticAutocompleteInput from './StaticAutocompleteInput';
import { NATIONALITIES, PERIODS } from '../musicMetadata';

/**
 * Modal for creating or editing a composer.
 *
 * Props:
 *   mode         "create" | "edit"
 *   composer     object — pre-fill values (edit mode); in create mode, only
 *                surname/name are pre-filled from the split text
 *   onSave       fn({ composer_id, displayName }) — called after successful save
 *   onSkip       fn()  — create mode only: skip enrichment, lock with split text
 *   onClose      fn()  — called on × / Escape / backdrop click
 *
 * Create mode fields: surname, name, dob, dod
 * Edit mode fields:   all of the above + nationality, period, gender,
 *                     imslp_url, wikipedia_url, notes
 */
const ComposerModal = ({ mode, composer = {}, onSave, onSkip, onClose }) => {
  const isEdit = mode === 'edit';

  const [fields, setFields] = useState({
    surname:       composer.surname       || '',
    name:          composer.name          || '',
    dob:           composer.dob           || '',
    dod:           composer.dod           || '',
    nationality:   composer.nationality   || '',
    period:        composer.period        || '',
    gender:        composer.gender        || '',
    imslp_url:     composer.imslp_url     || '',
    wikipedia_url: composer.wikipedia_url || '',
    notes:         composer.notes         || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  const set = (key) => (e) => setFields(prev => ({ ...prev, [key]: e.target.value }));

  const handleSave = async () => {
    if (!fields.surname.trim()) {
      setError('Surname is required.');
      return;
    }
    setSaving(true);
    setError(null);

    try {
      let composer_id, displayName;

      if (isEdit) {
        const res = await fetch(`/api/composers/${composer.composer_id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fields),
        });
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error || 'Update failed');
        }
        composer_id = composer.composer_id;
        displayName = fields.name.trim()
          ? `${fields.surname.trim()}, ${fields.name.trim()}`
          : fields.surname.trim();
      } else {
        const res = await fetch('/api/composers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fields),
        });
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error || 'Create failed');
        }
        const data = await res.json();
        composer_id = data.composer_id;
        displayName = fields.name.trim()
          ? `${fields.surname.trim()}, ${fields.name.trim()}`
          : fields.surname.trim();
      }

      onSave({ composer_id, displayName, ...fields });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Close on backdrop click
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
          <h2 className="text-sm font-semibold text-gray-800">
            {isEdit ? 'Edit composer' : 'New composer'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto space-y-3 flex-1">
          {error && (
            <p className="text-xs text-danger bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </p>
          )}

          {/* Always-visible fields */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Surname *" value={fields.surname} onChange={set('surname')} />
            <Field label="Name"      value={fields.name}    onChange={set('name')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Born"  value={fields.dob} onChange={set('dob')} placeholder="e.g. 1685" />
            <Field label="Died"  value={fields.dod} onChange={set('dod')} placeholder="e.g. 1750" />
          </div>

          {/* Edit-mode extra fields */}
          {isEdit && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Nationality</label>
                  <StaticAutocompleteInput
                    items={NATIONALITIES}
                    value={fields.nationality}
                    onChange={(v) => setFields(prev => ({ ...prev, nationality: v }))}
                    placeholder="e.g. German"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Period</label>
                  <StaticAutocompleteInput
                    items={PERIODS}
                    value={fields.period}
                    onChange={(v) => setFields(prev => ({ ...prev, period: v }))}
                    placeholder="e.g. Baroque"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Gender</label>
                <select
                  value={fields.gender}
                  onChange={set('gender')}
                  className="w-full px-3 py-2 border border-surface-border rounded-md text-sm text-gray-700 focus:outline-none focus:border-accent"
                >
                  <option value="">—</option>
                  <option value="M">M</option>
                  <option value="F">F</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <Field label="IMSLP URL"     value={fields.imslp_url}     onChange={set('imslp_url')} />
              <Field label="Wikipedia URL" value={fields.wikipedia_url} onChange={set('wikipedia_url')} />

              <div>
                <label className="block text-xs text-gray-500 mb-1">Notes</label>
                <textarea
                  value={fields.notes}
                  onChange={set('notes')}
                  rows={3}
                  className="w-full px-3 py-2 border border-surface-border rounded-md text-sm text-gray-700 focus:outline-none focus:border-accent resize-none"
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-surface-border">
          {!isEdit && onSkip && (
            <button
              onClick={onSkip}
              className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              Skip
            </button>
          )}
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

// Small labelled text input helper
function Field({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder || ''}
        className="w-full px-3 py-2 border border-surface-border rounded-md text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-accent"
      />
    </div>
  );
}

export default ComposerModal;
