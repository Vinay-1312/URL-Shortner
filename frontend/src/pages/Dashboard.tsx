import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { URLRecord } from "../types";

const STORAGE_KEY = "url_shortener_history";

function truncate(str: string, max: number) {
  return str.length > max ? str.slice(0, max) + "…" : str;
}

export default function Dashboard() {
  const [urls, setUrls] = useState<URLRecord[]>([]);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const history: URLRecord[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    setUrls(history);
  }, []);

  const handleCopy = (record: URLRecord) => {
    navigator.clipboard.writeText(record.shortUrl);
    setCopiedSlug(record.slug);
    setTimeout(() => setCopiedSlug(null), 2000);
  };

  const handleClear = () => {
    localStorage.removeItem(STORAGE_KEY);
    setUrls([]);
  };

  return (
    <div className="min-h-screen bg-slate-900 px-4 py-12">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">URL Dashboard</h1>
            <p className="text-slate-400 mt-1 text-sm">
              {urls.length} link{urls.length !== 1 ? "s" : ""} created
            </p>
          </div>
          <div className="flex gap-3">
            {urls.length > 0 && (
              <button
                onClick={handleClear}
                className="text-red-400 hover:text-red-300 border border-red-700 hover:border-red-500 text-sm px-4 py-2 rounded-lg transition-colors"
              >
                Clear All
              </button>
            )}
            <button
              onClick={() => navigate("/")}
              className="bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm px-5 py-2 rounded-lg transition-colors"
            >
              + Create New
            </button>
          </div>
        </div>

        {/* Empty state */}
        {urls.length === 0 ? (
          <div className="bg-slate-800 rounded-2xl p-16 text-center">
            <p className="text-slate-400 text-lg mb-4">No URLs shortened yet</p>
            <button
              onClick={() => navigate("/")}
              className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-3 rounded-lg transition-colors"
            >
              Shorten your first URL
            </button>
          </div>
        ) : (
          <div className="bg-slate-800 rounded-2xl shadow-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left text-slate-400 font-medium px-6 py-4">Original URL</th>
                  <th className="text-left text-slate-400 font-medium px-6 py-4">Short URL</th>
                  <th className="text-left text-slate-400 font-medium px-6 py-4 whitespace-nowrap">Created At</th>
                  <th className="text-left text-slate-400 font-medium px-6 py-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {urls.map((record, idx) => (
                  <tr
                    key={record.slug}
                    className={`border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors ${
                      idx === urls.length - 1 ? "border-b-0" : ""
                    }`}
                  >
                    <td className="px-6 py-4">
                      <span
                        title={record.longUrl}
                        className="text-slate-300 font-mono"
                      >
                        {truncate(record.longUrl, 50)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <a
                        href={record.shortUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 font-mono transition-colors"
                      >
                        {record.shortUrl}
                      </a>
                    </td>
                    <td className="px-6 py-4 text-slate-400 whitespace-nowrap">
                      {new Date(record.createdAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => handleCopy(record)}
                        className="bg-slate-700 hover:bg-slate-600 text-white text-xs font-medium px-3 py-1.5 rounded-md transition-colors"
                      >
                        {copiedSlug === record.slug ? "Copied!" : "Copy"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
