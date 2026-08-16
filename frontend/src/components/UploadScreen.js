import { useRef, useState } from 'react';
import { Upload, BookOpen } from 'lucide-react';
import TitleInput from './TitleInput';
import ComposerInput from './ComposerInput';
import Changelog from './Changelog';

const UploadScreen = ({ onUpload, uploading, error, onOpenLibrary }) => {
  const fileInputRef = useRef(null);
  const [title, setTitle] = useState('');
  const [composer, setComposer] = useState('');
  const [composerObj, setComposerObj] = useState(null); // { composer_id, displayName } | null

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!title) setTitle(file.name.replace(/\.pdf$/i, ''));
    onUpload({ file, title: title || file.name.replace(/\.pdf$/i, ''), composerObj });
  };

  return (
    <div className="p-6 bg-surface-bg min-h-screen">
      <div className="max-w-5xl mx-auto flex flex-col lg:flex-row gap-6 lg:items-start">
        <div className="flex-1 bg-surface-card rounded-md shadow-sm border border-surface-border p-6">
          <h1 className="text-xl font-semibold text-gray-700 mb-8">Divisi</h1>

          <div className="space-y-3 mb-6">
            <TitleInput value={title} onChange={setTitle} />
            <ComposerInput
              value={composer}
              onChange={setComposer}
              onSelect={setComposerObj}
            />
          </div>

          <div className="border border-dashed border-surface-border rounded-md p-12 text-center">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={handleFileChange}
            />
            <Upload className="w-10 h-10 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 mb-4 text-sm">Upload a PDF score to extract individual parts</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="px-5 py-2.5 bg-accent text-white rounded-md hover:bg-accent/80 disabled:opacity-50 transition-colors text-sm"
            >
              {uploading ? 'Processing...' : 'Select PDF Score'}
            </button>
            {error && <p className="mt-4 text-danger text-sm">{error}</p>}
          </div>

          {onOpenLibrary && (
            <div className="mt-6 text-center">
              <button
                onClick={onOpenLibrary}
                className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-accent transition-colors"
              >
                <BookOpen className="w-4 h-4" />
                Browse saved scores
              </button>
            </div>
          )}
        </div>

        <Changelog />
      </div>
    </div>
  );
};

export default UploadScreen;
