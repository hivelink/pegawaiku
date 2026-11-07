import Image from "next/image";
import Link from "next/link";

export function Logo({ href = "/", size = 32, wordmark = true }: { href?: string; size?: number; wordmark?: boolean }) {
  return (
    <Link href={href} className="flex items-center gap-2">
      <Image src="/brand/logo-mark.svg" alt="PegawaiKu" width={size} height={size} priority />
      {wordmark && (
        <span className="text-xl font-extrabold tracking-tight text-primary">
          Pegawai<span className="text-accent">Ku</span>
        </span>
      )}
    </Link>
  );
}
