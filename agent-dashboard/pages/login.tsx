import { useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";

export default function Login() {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  const handleSave = () => {
    if (key.trim()) {
      localStorage.setItem("apiKey", key.trim());
      setSaved(true);
      setTimeout(() => {
        router.push("/economy");
      }, 1000);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
      <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-2xl p-12 text-center max-w-[400px] w-full">
        <h1 className="text-3xl font-bold text-white mb-2">Monocle</h1>
        <p className="text-zinc-500 mb-8">Agent Economy Control Panel</p>

        <h2 className="text-white text-lg font-semibold mb-4">Enter API Key</h2>

        <div className="mb-6">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Paste your API key"
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
          />
          <p className="text-zinc-600 text-xs mt-2">Your API key from the backend .env file</p>
        </div>

        <button
          className="w-full py-3 bg-white text-zinc-900 font-semibold rounded-xl hover:bg-zinc-200 transition-colors"
          onClick={handleSave}
        >
          Login
        </button>

        {saved && (
          <p className="text-emerald-400 mt-4 text-sm">Saved! Redirecting to control panel...</p>
        )}

        <div className="mt-6 flex gap-4 justify-center">
          <Link href="/" className="text-zinc-500 text-sm hover:text-white transition-colors">Marketplace</Link>
          <Link href="/dashboard" className="text-zinc-500 text-sm hover:text-white transition-colors">Dashboard</Link>
          <Link href="/economy" className="text-zinc-500 text-sm hover:text-white transition-colors">Economy</Link>
        </div>
      </div>
    </div>
  );
}

