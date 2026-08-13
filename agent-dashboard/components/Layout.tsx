import Link from "next/link";
import { useRouter } from "next/router";
import { ReactNode, useEffect, useState } from "react";
import { getMe } from "../lib/auth-api";

interface LayoutProps {
  children: ReactNode;
  title?: string;
}

const NAV_LINKS = [
  { href: "/arena", label: "Arena" },
  { href: "/marketplace", label: "Marketplace" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/usage", label: "Usage" },
  { href: "/receipts", label: "Receipts" },
  { href: "/messaging", label: "Messaging" },
];

/**
 * Operator views: platform-wide data across every account. Shown only to
 * operators, and only as a matter of not advertising a door you cannot open —
 * requireAdmin on the backend is what actually keeps them out.
 */
const ADMIN_NAV_LINKS = [
  { href: "/analytics", label: "Analytics" },
  { href: "/admin", label: "Admin" },
];

export default function Layout({ children, title }: LayoutProps) {
  const router = useRouter();

  // Who is signed in, for the account affordance on the right of the nav. Left
  // null until it resolves so a signed-out visitor never sees a flash of somebody
  // else's identity, and a failure just hides the control rather than blocking
  // the page around it.
  const [email, setEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((u) => {
        if (cancelled) return;
        setEmail(u?.email ?? null);
        setIsAdmin(u?.isAdmin === true);
      })
      .catch(() => {
        /* signed out, or /me unreachable — the nav simply omits the account link */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#09090b] text-white font-sans">
      {/* Navbar */}
      <header className="border-b border-zinc-800/60">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-white">
            <svg viewBox="0 0 32 32" fill="none" className="w-6 h-6" aria-hidden="true">
              <circle cx="13" cy="14" r="9" stroke="currentColor" strokeWidth={2} />
              <circle cx="15.5" cy="14" r="2" fill="currentColor" />
              <path d="M 21 20 L 27 27" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
            </svg>
            Monocle
          </Link>
          <nav className="flex items-center gap-1">
            {[...NAV_LINKS, ...(isAdmin ? ADMIN_NAV_LINKS : [])].map((link) => {
              const isActive = router.pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3 py-1.5 rounded-md text-sm transition-colors duration-200 ${
                    isActive
                      ? "bg-zinc-800 text-white font-medium"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}

            {/* Account, held apart from the section links: it answers "who am I"
                rather than "where do I go". Absent when signed out. */}
            {email && (
              <Link
                href="/profile"
                title={email}
                className={`ml-3 pl-3 border-l border-zinc-800 max-w-[180px] truncate px-3 py-1.5 rounded-md text-sm transition-colors duration-200 ${
                  router.pathname === "/profile"
                    ? "bg-zinc-800 text-white font-medium"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {email}
              </Link>
            )}
          </nav>
        </div>
      </header>

      {/* Page title */}
      {title && (
        <div className="border-b border-zinc-800/60">
          <div className="max-w-7xl mx-auto px-6 py-6">
            <h1 className="text-2xl font-bold text-white">{title}</h1>
          </div>
        </div>
      )}

      {/* Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
