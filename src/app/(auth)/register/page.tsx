import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { signUp, signInWithGoogle } from "../actions";

const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN === "1";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md p-8">
        <div className="flex justify-center"><Logo /></div>
        <h1 className="mt-6 text-center text-xl font-bold">Buat akun</h1>
        <p className="mt-1 text-center text-sm text-muted">Gratis 2 kredit untuk mencoba.</p>
        {sp.error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{sp.error}</p>}
        {GOOGLE_ENABLED && (
          <>
            <form action={signInWithGoogle} className="mt-6">
              <Button type="submit" variant="outline" className="w-full">Daftar dengan Google</Button>
            </form>
            <div className="my-4 text-center text-xs text-muted">atau</div>
          </>
        )}
        <form action={signUp} className={GOOGLE_ENABLED ? "space-y-3" : "mt-6 space-y-3"}>
          <Input name="full_name" placeholder="Nama lengkap" required />
          <Input name="email" type="email" placeholder="Email" required />
          <Input name="password" type="password" placeholder="Kata sandi (min. 6)" minLength={6} required />
          <Button type="submit" className="w-full">Daftar</Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted">
          Sudah punya akun? <Link href="/login" className="font-semibold text-primary">Masuk</Link>
        </p>
      </Card>
    </main>
  );
}
