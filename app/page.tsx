import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-between px-6 pb-10 pt-24 safe-bottom">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-neon" />
          OnMe
        </div>
        <h1 className="text-balance text-5xl font-semibold leading-[1.05] tracking-tight">
          Try anything on.
          <br />
          See it on <span className="text-neon">you</span>.
        </h1>
        <p className="mt-5 max-w-[280px] text-balance text-sm text-muted-foreground">
          Tap any post. Watch, ring, chain, or fit — rendered on your wrist,
          neck, finger, or ear. Cop or Drop.
        </p>
      </div>

      <div className="w-full">
        <Link
          href="/onboarding"
          className="flex h-14 w-full items-center justify-center rounded-full bg-neon text-base font-semibold text-black transition active:scale-[0.98]"
        >
          Get Started
        </Link>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Takes under a minute.
        </p>
      </div>
    </main>
  );
}
