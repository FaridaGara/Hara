export function PageLoader({ label = "Yüklənir…" }: { label?: string }) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div role="status" className="space-y-4" aria-label={label}>
        <span className="sr-only">{label}</span>
        <div className="h-8 w-52 animate-pulse rounded-xl bg-white/10" />
        <div className="h-44 animate-pulse rounded-2xl bg-white/[0.07]" />
        <div className="h-24 animate-pulse rounded-2xl bg-white/[0.07]" />
      </div>
    </main>
  );
}

export function StatePanel({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-[#15151d] p-6 text-center">
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-white/55">
        {message}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </section>
  );
}

export function InlineError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-100"
    >
      {message}
    </p>
  );
}
