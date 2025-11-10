"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import Image from "next/image";

export function Header() {
  const [uid, setUid] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((user) => {
      if (user) {
        setUid(user.uid);
        setEmail(user.email);
      } else {
        setUid(null);
        setEmail(null);
      }
    });
    return () => unsub();
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
    router.push("/login");
  };

  return (
    <header className="w-full bg-white border-b mb-4">
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg">
          <Image src="/logo.png" alt="Liga RO" width={32} height={32} />
          Liga GO RO
        </Link>


        <nav className="flex gap-2 flex-wrap">
          <Link href="/ginasios" className="px-3 py-1 rounded bg-slate-100 hover:bg-slate-200 text-sm">
            Ginásios
          </Link>
          <Link href="/jogadores" className="px-3 py-1 rounded bg-slate-100 hover:bg-slate-200 text-sm">
            Jogadores
          </Link>
          {uid && (
            <>
              <Link
                href={`/perfil/${uid}`}
                className="px-3 py-1 rounded bg-slate-100 hover:bg-slate-200 text-sm"
              >
                Meu perfil
              </Link>
              <Link
                href={`/equipes/${uid}`}
                className="px-3 py-1 rounded bg-slate-100 hover:bg-slate-200 text-sm"
              >
                Minhas equipes
              </Link>
            </>
          )}
          <Link href="/mapa" className="px-3 py-1 rounded bg-slate-100 hover:bg-slate-200 text-sm">
            Mapa
          </Link>
          <Link href="/trocas" className="px-3 py-1 rounded bg-slate-100 hover:bg-slate-200 text-sm">
            RTS
          </Link>
          <Link href="/loja" className="px-3 py-1 rounded bg-slate-100 hover:bg-slate-200 text-sm">
            Loja
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          {uid ? (
            <>
              <span className="text-xs text-slate-500 max-w-[140px] truncate">
                {email}
              </span>
              <button
                onClick={handleLogout}
                className="px-3 py-1 rounded bg-red-500 text-white text-sm"
              >
                Sair
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="px-3 py-1 rounded bg-blue-600 text-white text-sm"
            >
              Entrar
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
