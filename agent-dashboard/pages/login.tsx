import { useState } from "react";

export default function Login() {
  const [key, setKey] = useState("");

  return (
    <main style={{ padding: 24 }}>
      <h2>Your API Key</h2>
      <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste API key" />
      <button onClick={() => localStorage.setItem("apiKey", key)}>Save</button>
    </main>
  );
}

