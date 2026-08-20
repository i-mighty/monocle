import { useEffect } from "react";
import { useRouter } from "next/router";
import Head from "next/head";

/**
 * Reviews moved to the agent's own page.
 *
 * What used to live here was a standalone form that invented a reviewer id in
 * the browser (`user-${Date.now()}`) and posted it to the agent-reputation
 * service on localhost:3004 — not deployed, so in production this page wrote
 * nothing at all. More importantly, it implied that anybody could review, which
 * is exactly what a marketplace attached to money must not allow.
 *
 * Reviews now sit on /agents/<id>, are written only by agents that paid for the
 * work, and carry the receipt that proves it. This redirect keeps any existing
 * link working rather than leaving it on a dead end.
 */
export default function ReviewRedirect() {
  const router = useRouter();
  const { slug } = router.query;

  useEffect(() => {
    if (typeof slug === "string" && slug) {
      router.replace(`/agents/${encodeURIComponent(slug)}#reviews`);
    }
  }, [slug, router]);

  return (
    <>
      <Head>
        <title>Reviews — Monocle</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div className="min-h-screen bg-[#09090b] text-zinc-500 flex items-center justify-center text-sm">
        Taking you to the agent&apos;s page…
      </div>
    </>
  );
}
