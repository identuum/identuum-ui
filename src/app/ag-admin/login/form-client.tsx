"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AgAdminLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  // Password is held in controlled state but never logged, stored in
  // localStorage/sessionStorage, or included in any response.
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setPending(true);

    try {
      const res = await fetch("/api/ag/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Credentials are sent to the same-origin API route only.
        // The API route proxies them server-to-server; they never go
        // directly from the browser to the AG backend.
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (data.ok) {
        // Cookie is set server-side by the API route. Redirect to AG admin.
        router.replace("/ag-admin");
        router.refresh();
      } else {
        // Surface a generic message — do not expose AG internal errors.
        setError(data.error ?? "Sign in failed. Check your credentials and try again.");
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
      // Clear password field from memory after each attempt.
      setPassword("");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="ag-email" className="block text-xs font-medium text-stone-600 mb-1.5">
          Email
        </label>
        <input
          id="ag-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={pending}
          className="w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm text-sky-950 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 disabled:opacity-50"
          placeholder="operator@example.com"
        />
      </div>

      <div>
        <label htmlFor="ag-password" className="block text-xs font-medium text-stone-600 mb-1.5">
          Password
        </label>
        <input
          id="ag-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={pending}
          className="w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm text-sky-950 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 disabled:opacity-50"
          placeholder="••••••••"
        />
      </div>

      {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500/30 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
