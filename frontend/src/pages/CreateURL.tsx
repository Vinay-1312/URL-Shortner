import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { ShortenResponse, URLRecord } from "../types";

const STORAGE_KEY = "url_shortener_history";

export default function CreateURL() {
  const [longUrl, setLongUrl] = useState("");
  const [result, setResult] = useState<ShortenResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);

    try {
      const { data } = await axios.post<ShortenResponse>("/api/shorten", { longUrl });
      setResult(data);

      // Persist to localStorage
      const history: URLRecord[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      const record: URLRecord = {
        slug: data.slug,
        shortUrl: data.shortUrl,
        longUrl,
        createdAt: data.createdAt,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify([record, ...history]));
    } catch (err: any) {
      setError(err.response?.data?.error || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (result) {
      navigator.clipboard.writeText(result.shortUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-xl">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold text-white mb-2">URL Shortener</h1>
          <p className="text-slate-400">Paste your long URL and get a short link instantly</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-slate-800 rounded-2xl p-6 shadow-xl">
          <label className="block text-slate-300 text-sm font-medium mb-2">
            Long URL
          </label>
          <div className="flex gap-3">
            <input
              type="url"
              value={longUrl}
              onChange={(e) => setLongUrl(e.target.value)}
              placeholder="https://example.com/very/long/url..."
              required
              className="flex-1 bg-slate-700 text-white placeholder-slate-500 border border-slate-600 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              type="submit"
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-semibold px-6 py-3 rounded-lg text-sm transition-colors"
            >
              {loading ? "Shortening…" : "Shorten"}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="mt-4 bg-red-900/40 border border-red-700 text-red-400 rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="mt-5 bg-slate-700/60 border border-slate-600 rounded-lg p-4">
              <p className="text-slate-400 text-xs uppercase tracking-wider mb-2">Your short URL</p>
              <div className="flex items-center gap-3">
                <a
                  href={result.shortUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-blue-400 font-mono text-sm hover:text-blue-300 truncate"
                >
                  {result.shortUrl}
                </a>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="bg-slate-600 hover:bg-slate-500 text-white text-xs font-medium px-3 py-1.5 rounded-md transition-colors whitespace-nowrap"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          )}
        </form>

        {/* Footer nav */}
        <div className="text-center mt-6">
          <button
            onClick={() => navigate("/dashboard")}
            className="text-slate-400 hover:text-slate-200 text-sm transition-colors"
          >
            View all shortened URLs →
          </button>
        </div>
      </div>
    </div>
  );
}
