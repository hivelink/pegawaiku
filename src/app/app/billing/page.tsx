import { getContext } from "@/lib/context";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatCredit, formatRupiah } from "@/lib/utils";
import { redeemVoucher } from "../actions";

const RATE = Number(process.env.NEXT_PUBLIC_IDR_PER_CREDIT ?? 17000);
const NOMINALS = [50000, 100000, 200000, 500000, 1000000];

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const { supabase, org } = await getContext();
  if (!org) return null;
  const { data: tx } = await supabase.from("credit_transactions").select("*").eq("org_id", org.id).order("created_at", { ascending: false }).limit(30);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-primary">Billing</h1>
        <p className="text-sm text-muted">1 kredit = 1 USD · dipakai per pesan agent sesuai jumlah token.</p>
      </div>
      {sp.ok && <p className="rounded-lg bg-sky-50 p-3 text-sm text-primary">Voucher berhasil ditukar.</p>}
      {sp.error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{sp.error}</p>}

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="p-6">
          <div className="text-xs uppercase tracking-wide text-muted">Saldo</div>
          <div className="text-4xl font-extrabold text-primary">{formatCredit(org.credit_balance)}</div>
          <div className="text-sm text-muted">kredit tersedia</div>
          <div className="mt-4 text-xs text-muted">Kurs {formatRupiah(RATE)} / kredit</div>
        </Card>
        <Card className="p-6">
          <div className="font-bold">Redeem voucher</div>
          <form action={redeemVoucher} className="mt-3 flex gap-2">
            <Input name="code" placeholder="KODE-VOUCHER" required />
            <Button type="submit">Redeem</Button>
          </form>
          <p className="mt-2 text-xs text-muted">Untuk uji coba lokal tersedia kode <code>PEGAWAIKU-TRIAL</code> (5 kredit).</p>
        </Card>
        <Card className="p-6">
          <div className="font-bold">Top up</div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {NOMINALS.map((n) => (
              <div key={n} className="rounded-xl border border-border p-3 text-center">
                <div className="text-sm font-semibold">{formatRupiah(n)}</div>
                <div className="text-xs text-muted">{(n / RATE).toFixed(2)} cr</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">Pembayaran otomatis (Midtrans/Xendit) belum dipasang. Untuk sementara, buat voucher di tabel <code>vouchers</code> setelah menerima pembayaran manual.</p>
        </Card>
      </div>

      <Card className="p-6">
        <div className="font-bold">Riwayat transaksi</div>
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted"><tr><th className="py-1">Tanggal</th><th>Jenis</th><th>Catatan</th><th className="text-right">Kredit</th></tr></thead>
          <tbody>
            {(tx ?? []).map((t) => (
              <tr key={t.id} className="border-t border-border">
                <td className="py-2">{new Date(t.created_at).toLocaleString("id-ID")}</td>
                <td>{t.kind}</td>
                <td className="text-muted">{t.note}</td>
                <td className={`text-right font-semibold ${Number(t.amount) < 0 ? "text-red-600" : "text-emerald-600"}`}>{Number(t.amount) > 0 ? "+" : ""}{formatCredit(t.amount)}</td>
              </tr>
            ))}
            {(tx ?? []).length === 0 && <tr><td colSpan={4} className="py-3 text-muted">Belum ada transaksi.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
