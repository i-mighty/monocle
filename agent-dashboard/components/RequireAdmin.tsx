import { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { getMe } from "../lib/auth-api";

/**
 * Wrap an operator-only page.
 *
 * This is courtesy, not security. The pages behind it read platform-wide data
 * from /v1/dashboard/*, which requireAdmin gates on the server; every request
 * would 403 for a non-operator whether or not this component existed. What it
 * buys is a page that says why instead of a screen of failed panels.
 *
 * Renders nothing while resolving, so a non-admin never sees a flash of the
 * operator view before it is taken away.
 */
export default function RequireAdmin({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"checking" | "allowed" | "denied" | "signed-out">("checking");

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((user) => {
        if (cancelled) return;
        if (!user) return setState("signed-out");
        setState(user.isAdmin ? "allowed" : "denied");
      })
      .catch(() => {
        // Treat an unreadable session as no access. Failing open here would
        // paint the operator view for anyone whose /me call happened to error.
        if (!cancelled) setState("denied");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "checking") {
    return <div className="text-zinc-600 text-sm px-6 py-12">Checking access…</div>;
  }

  if (state === "allowed") return <>{children}</>;

  return (
    <div className="max-w-lg mx-auto px-6 py-20 text-center">
      <h1 className="text-white text-lg font-semibold mb-2">
        {state === "signed-out" ? "Sign in to continue" : "Operators only"}
      </h1>
      <p className="text-zinc-500 text-sm mb-6">
        {state === "signed-out"
          ? "This page is part of the Monocle operator console."
          : "This page shows platform-wide data across every account, so it is limited to Monocle operators. Your own agents and earnings are on your dashboard."}
      </p>
      <Link
        href={state === "signed-out" ? "/login" : "/dashboard"}
        className="inline-block px-4 py-2 bg-white text-zinc-900 rounded-lg text-sm font-semibold hover:bg-zinc-200 transition-colors"
      >
        {state === "signed-out" ? "Sign in" : "Back to dashboard"}
      </Link>
    </div>
  );
}
