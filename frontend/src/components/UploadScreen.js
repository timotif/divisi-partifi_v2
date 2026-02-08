import { useRef } from 'react';
import { Music, Upload } from 'lucide-react';

const UploadScreen = ({ onUpload, uploading, error }) => {
  const fileInputRef = useRef(null);

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex items-center gap-2 mb-8">
            <Music className="w-6 h-6 text-blue-600" />
            <h1 className="text-2xl font-bold text-gray-800">Music Score Partitioner</h1>
          </div>

          <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={(e) => {
                if (e.target.files[0]) onUpload(e.target.files[0]);
              }}
            />
            <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 mb-4">Upload a PDF score to extract individual parts</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {uploading ? 'Processing...' : 'Select PDF Score'}
            </button>
            {error && <p className="mt-4 text-red-600">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default UploadScreen;
