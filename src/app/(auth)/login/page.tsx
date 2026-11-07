import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { signIn, signInWithGoogle } from "../actions";

const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN === "1";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; message?: string; next?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md p-8">
        <div className="flex justify-center"><Logo /></div>
        <h1 className="mt-6 text-center text-xl font-bold">Masuk ke PegawaiKu</h1>
        {sp.message && <p className="mt-3 rounded-lg bg-sky-50 p-3 text-sm text-primary">{sp.message}</p>}
        {sp.error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{sp.error}</p>}
        {GOOGLE_ENABLED && (
          <>
            <form action={signInWithGoogle} className="mt-6">
              <Button type="submit" variant="outline" className="w-full">Lanjutkan dengan Google</Button>
            </form>
            <div className="my-4 text-center text-xs text-muted">atau</div>
          </>
        )}
        <form action={signIn} className={GOOGLE_ENABLED ? "space-y-3" : "mt-6 space-y-3"}>
          <input type="hidden" name="next" value={sp.next ?? "/app"} />
          <Input name="email" type="email" placeholder="Email" required />
          <Input name="password" type="password" placeholder="Kata sandi" required />
          <Button type="submit" className="w-full">Masuk</Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted">
          Belum punya akun? <Link href="/register" className="font-semibold text-primary">Daftar</Link>
        </p>
      </Card>
    </main>
  );
}
