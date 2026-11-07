"use client";
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="id"><body style={{ fontFamily: "system-ui", padding: 32 }}>
      <h2 style={{ color: "#b91c1c" }}>Aplikasi mengalami kesalahan</h2>
      <p style={{ color: "#7f1d1d" }}>{error.message}</p>
      {error.digest && <p style={{ fontSize: 12, color: "#991b1b" }}>kode: {error.digest}</p>}
      <button onClick={reset} style={{ marginTop: 16, padding: "8px 16px", borderRadius: 12, background: "#1e3a8a", color: "#fff", border: 0 }}>Muat ulang</button>
    </body></html>
  );
}
