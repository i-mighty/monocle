import Link from "next/link";
import { useRouter } from "next/router";
import { ReactNode } from "react";

interface LayoutProps {
  children: ReactNode;
  title?: string;
}

const NAV_LINKS = [
  { href: "/marketplace", label: "Marketplace" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/usage", label: "Usage" },
  { href: "/receipts", label: "Receipts" },
  { href: "/messaging", label: "Messaging" },
];

export default function Layout({ children, title }: LayoutProps) {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-[#09090b] text-white font-sans">
      {/* Navbar */}
      <header className="border-b border-zinc-800/60">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="text-lg font-semibold tracking-tight text-white">
            Monocle
          </Link>
          <nav className="flex items-center gap-1">
            {NAV_LINKS.map((link) => {
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
