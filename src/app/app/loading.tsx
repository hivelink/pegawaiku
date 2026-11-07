export default function Loading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Memuat">
      <div className="h-40 rounded-3xl bg-slate-200" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="h-52 rounded-2xl bg-slate-100" />
        <div className="h-52 rounded-2xl bg-slate-100" />
        <div className="h-52 rounded-2xl bg-slate-100" />
      </div>
    </div>
  );
}
