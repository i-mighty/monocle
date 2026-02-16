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
    <main className="login-page">
      <style jsx>{`
        .login-page {
          min-height: 100vh;
          background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .login-card {
          background: rgba(30, 27, 75, 0.8);
          padding: 48px;
          border-radius: 24px;
          border: 1px solid rgba(139, 92, 246, 0.2);
          text-align: center;
          max-width: 400px;
          width: 100%;
        }
        .brand {
          font-size: 32px;
          font-weight: 700;
          background: linear-gradient(135deg, #8b5cf6, #06b6d4);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          margin-bottom: 8px;
        }
        .subtitle {
          color: #94a3b8;
          margin-bottom: 32px;
        }
        h2 {
          color: #e2e8f0;
          font-size: 20px;
          margin-bottom: 16px;
        }
        .form-group {
          margin-bottom: 24px;
        }
        input {
          width: 100%;
          padding: 14px 18px;
          background: rgba(15, 23, 42, 0.8);
          border: 1px solid rgba(139, 92, 246, 0.3);
          border-radius: 12px;
          color: #e2e8f0;
          font-size: 14px;
        }
        input:focus {
          outline: none;
          border-color: #8b5cf6;
        }
        .btn-primary {
          width: 100%;
          padding: 14px 28px;
          background: linear-gradient(135deg, #8b5cf6, #6366f1);
          border: none;
          border-radius: 12px;
          color: white;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }
        .btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 20px rgba(139, 92, 246, 0.4);
        }
        .success {
          color: #4ade80;
          margin-top: 16px;
        }
        .links {
          margin-top: 24px;
          display: flex;
          gap: 16px;
          justify-content: center;
        }
        .links a {
          color: #a5b4fc;
          text-decoration: none;
          font-size: 14px;
        }
        .links a:hover {
          color: #c4b5fd;
        }
        .hint {
          color: #64748b;
          font-size: 12px;
          margin-top: 8px;
        }
      `}</style>
      
      <div className="login-card">
        <div className="brand">AgentPay</div>
        <p className="subtitle">Agent Economy Control Panel</p>
        
        <h2>Enter API Key</h2>
        
        <div className="form-group">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Paste your API key"
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
          <p className="hint">Your API key from the backend .env file</p>
        </div>
        
        <button className="btn-primary" onClick={handleSave}>
          Login
        </button>
        
        {saved && (
          <p className="success">✅ Saved! Redirecting to control panel...</p>
        )}
        
        <div className="links">
          <Link href="/">Marketplace</Link>
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/economy">Economy</Link>
        </div>
      </div>
    </main>
  );
}

