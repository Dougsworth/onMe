export function DeviceFrame({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 hidden md:block bg-[radial-gradient(ellipse_at_top,#0a0a0a,#000)]"
      />
      <div className="md:flex md:min-h-dvh md:items-center md:justify-center md:p-6">
        <div className="min-h-dvh w-full bg-background md:relative md:min-h-0 md:h-[844px] md:max-h-[calc(100dvh-48px)] md:w-[390px] md:overflow-hidden md:rounded-[44px] md:border-[10px] md:border-zinc-900 md:shadow-[0_30px_80px_-20px_rgba(163,255,0,0.08)]">
          {children}
        </div>
      </div>
    </>
  );
}
