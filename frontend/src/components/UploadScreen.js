import { useRef } from 'react';
import { Upload } from 'lucide-react';

const UploadScreen = ({ onUpload, uploading, error }) => {
  const fileInputRef = useRef(null);

  return (
    <div className="p-6 bg-surface-bg min-h-screen">
      <div className="max-w-2xl mx-auto">
        <div className="bg-surface-card rounded-md shadow-sm border border-surface-border p-6">
          <h1 className="text-xl font-semibold text-gray-700 mb-8">Partifi</h1>

          <div className="border border-dashed border-surface-border rounded-md p-12 text-center">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={(e) => {
                if (e.target.files[0]) onUpload(e.target.files[0]);
              }}
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
        </div>
      </div>
    </div>
  );
};

export default UploadScreen;
