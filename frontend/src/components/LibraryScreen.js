import { useState, useEffect } from 'react';
import { BookOpen, Trash2, FolderOpen, ChevronDown, ChevronRight, Upload, Pencil, UserRound } from 'lucide-react';
import ComposerModal from './ComposerModal';

// Format a Unix timestamp as a human-readable relative string.
function formatRelative(ts) {
  if (!ts) return '';
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

// A single score card in the library list.
function ScoreCard({ score, onRestore, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState(
    score.setup_versions?.[0] || 'Default'
  );
  const [editingComposer, setEditingComposer] = useState(null);

  const hasVersions = score.setup_versions && score.setup_versions.length > 0;
  const hasGenerated = score.generated_parts && score.generated_parts.length > 0;

  const composerDisplay = score.composers?.length
    ? score.composers.map(c => c.name ? `${c.surname}, ${c.name}` : c.surname).join(' & ')
    : score.composer || '';

  // Use the first linked structured composer for the edit modal, if available
  const primaryComposer = score.composers?.[0] || null;

  return (
    <div className="border border-surface-border rounded-md bg-surface-card p-4">
      {/* Title row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-gray-800 truncate">{score.title}</h3>
          {composerDisplay && (
            <div className="flex items-center gap-1 mt-0.5">
              <p className="text-xs text-gray-500 truncate">{composerDisplay}</p>
              {primaryComposer && (
                <button
                  onClick={() => setEditingComposer(primaryComposer)}
                  className="shrink-0 text-gray-300 hover:text-accent transition-colors"
                  title="Edit composer"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
          <p className="text-xs text-gray-400 mt-0.5">
            {score.page_count} page{score.page_count !== 1 ? 's' : ''}
            {' · '}updated {formatRelative(score.updated_at)}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 shrink-0">
          {hasVersions && (
            <select
              value={selectedVersion}
              onChange={e => setSelectedVersion(e.target.value)}
              className="text-xs border border-surface-border rounded px-1.5 py-1 text-gray-600 bg-white max-w-[120px]"
              title="Select setup version to open"
            >
              {score.setup_versions.map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          )}

          <button
            onClick={() => onRestore(score.score_id, hasVersions ? selectedVersion : null)}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-accent text-white rounded text-xs hover:bg-accent/80 transition-colors"
            title="Open this score"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            Open
          </button>

          <button
            onClick={() => setConfirmDelete(true)}
            className="p-1.5 text-gray-400 hover:text-danger transition-colors rounded"
            title="Delete score"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-sm">
          <p className="text-red-700 mb-2">
            Delete <strong>{score.title}</strong>? This removes all setup versions and generated PDFs.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => { onDelete(score.score_id); setConfirmDelete(false); }}
              className="px-3 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700 transition-colors"
            >
              Delete
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-3 py-1 border border-surface-border rounded text-xs text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Expand / collapse extra details */}
      {(hasVersions || hasGenerated) && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="mt-2 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {hasVersions && `${score.setup_versions.length} setup version${score.setup_versions.length !== 1 ? 's' : ''}`}
          {hasVersions && hasGenerated && ' · '}
          {hasGenerated && `${score.generated_parts.length} generated part${score.generated_parts.length !== 1 ? 's' : ''}`}
        </button>
      )}

      {expanded && (
        <div className="mt-2 pl-4 border-l-2 border-surface-border text-xs text-gray-500 space-y-1">
          {hasVersions && (
            <p>
              <span className="text-gray-400">Versions: </span>
              {score.setup_versions.join(', ')}
            </p>
          )}
          {hasGenerated && (
            <p>
              <span className="text-gray-400">Parts: </span>
              {score.generated_parts.join(', ')}
            </p>
          )}
        </div>
      )}

      {/* Composer edit modal */}
      {editingComposer && (
        <ComposerModal
          mode="edit"
          composer={editingComposer}
          onSave={() => setEditingComposer(null)}
          onClose={() => setEditingComposer(null)}
        />
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Composers tab
// ---------------------------------------------------------------------------

function ComposersTab() {
  const [composers, setComposers] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [editing, setEditing]     = useState(null);   // composer object being edited
  const [creating, setCreating]   = useState(false);  // new composer modal open

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/composers');
      if (!res.ok) throw new Error(`Failed to load composers: ${res.status}`);
      const data = await res.json();
      setComposers(data.composers || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSaved = (composerObj) => {
    setEditing(null);
    setCreating(false);
    // Refresh the list to reflect saved changes
    load();
  };

  if (loading) return <div className="text-center text-gray-400 py-12 text-sm">Loading…</div>;

  if (error) return (
    <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-danger">{error}</div>
  );

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-gray-400">{composers.length} composer{composers.length !== 1 ? 's' : ''}</p>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded text-xs hover:bg-accent/80 transition-colors"
        >
          <UserRound className="w-3.5 h-3.5" />
          Add composer
        </button>
      </div>

      {composers.length === 0 ? (
        <div className="text-center text-gray-400 py-12">
          <UserRound className="w-10 h-10 mx-auto mb-3 text-gray-200" />
          <p className="text-sm">No composers yet.</p>
          <p className="text-xs mt-1">They're added automatically when you upload a score.</p>
        </div>
      ) : (
        <div className="divide-y divide-surface-border">
          {composers.map(c => (
            <div key={c.composer_id} className="flex items-center justify-between py-2.5 gap-3">
              <div className="min-w-0">
                <span className="text-sm text-gray-800">
                  {c.name ? `${c.surname}, ${c.name}` : c.surname}
                </span>
                {(c.period || c.nationality) && (
                  <span className="ml-2 text-xs text-gray-400">
                    {[c.period, c.nationality].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>
              <button
                onClick={() => setEditing(c)}
                className="shrink-0 p-1 text-gray-300 hover:text-accent transition-colors rounded"
                title="Edit composer"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <ComposerModal
          mode="edit"
          composer={editing}
          onSave={handleSaved}
          onClose={() => setEditing(null)}
        />
      )}

      {creating && (
        <ComposerModal
          mode="create"
          onSave={handleSaved}
          onSkip={() => setCreating(false)}
          onClose={() => setCreating(false)}
        />
      )}
    </>
  );
}


// ---------------------------------------------------------------------------
// Library screen — top level
// ---------------------------------------------------------------------------

const LibraryScreen = ({ scores, loading, error, onRestore, onDelete, onUpload }) => {
  const [tab, setTab] = useState('scores'); // 'scores' | 'composers'

  return (
    <div className="p-6 bg-surface-bg min-h-screen">
      <div className="max-w-2xl mx-auto">
        <div className="bg-surface-card rounded-md shadow-sm border border-surface-border p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-gray-400" />
              <h1 className="text-xl font-semibold text-gray-700">Library</h1>
            </div>
            <button
              onClick={onUpload}
              className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-md text-sm hover:bg-accent/80 transition-colors"
            >
              <Upload className="w-4 h-4" />
              Upload New Score
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mb-5 border-b border-surface-border">
            {[
              { id: 'scores',    label: 'Scores' },
              { id: 'composers', label: 'Composers' },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={[
                  'px-4 py-2 text-sm -mb-px border-b-2 transition-colors',
                  tab === t.id
                    ? 'border-accent text-accent font-medium'
                    : 'border-transparent text-gray-500 hover:text-gray-700',
                ].join(' ')}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {tab === 'scores' && (
            <>
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-danger">
                  {error}
                </div>
              )}
              {loading ? (
                <div className="text-center text-gray-400 py-12 text-sm">Loading…</div>
              ) : scores.length === 0 ? (
                <div className="text-center text-gray-400 py-12">
                  <BookOpen className="w-10 h-10 mx-auto mb-3 text-gray-200" />
                  <p className="text-sm">No scores saved yet.</p>
                  <p className="text-xs mt-1">Upload a PDF score to get started.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {scores.map(score => (
                    <ScoreCard
                      key={score.score_id}
                      score={score}
                      onRestore={onRestore}
                      onDelete={onDelete}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'composers' && <ComposersTab />}
        </div>
      </div>
    </div>
  );
};

export default LibraryScreen;
