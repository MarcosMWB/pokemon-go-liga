"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { signOut, User } from "firebase/auth";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { doc, getDoc } from "firebase/firestore";

export function Header() {
  const [uid, setUid] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [isSuper, setIsSuper] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (current: User | null) => {
      if (current) {
        setUid(current.uid);
        setEmail(current.email);
        try {
          const sup = await getDoc(doc(db, "superusers", current.uid));
          setIsSuper(sup.exists());
        } catch {
          setIsSuper(false);
        }
      } else {
        setUid(null);
        setEmail(null);
        setIsSuper(false);
      }
    });
    return () => unsub();
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
    router.push("/login");
    setMenuOpen(false);
  };

  const logoHref = isSuper ? "/dev" : "/";
  const ginLink = uid ? "/ginasios" : "/ginasios/visitante";

  return (
    <header className="w-full bg-white border-b mb-4 sticky top-0 z-40">
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-4 px-4 py-3">
        {/* logo (admin -> /dev | demais -> /) */}
        <Link href={logoHref} className="flex items-center gap-2 font-bold text-lg">
          <Image src="/logo.png" alt="Liga Oceanica" width={32} height={32} />
          Liga Oceânica{" "}
          <sub>
            <span className="text-xs text-gray-500">(PRE-ALPHA)</span>
          </sub>
        </Link>

        {/* menu desktop */}
        <nav className="hidden md:flex gap-2 flex-wrap">
          <Link
            href={ginLink}
            className="px-3 py-1 rounded bg-slate-100 hover:bg-slate-200 text-sm"
          >
            Ginásios
          </Link>
          <Link
            href="/jogadores"
            className="px-3 py-1 rounded bg-slate-100 hover:bg-slate-200 text-sm"
          >
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
          <Link
            href="/mapa"
            className="px-3 py-1 rounded bg-slate-100 hover:bg-slate-200 text-sm"
          >
            Mapa
          </Link>
          <Link
            href="/trocas"
            className="px-3 py-1 rounded bg-slate-100 hover:bg-slate-200 text-sm"
          >
            RTS
          </Link>
          <Link
            href="/loja"
            className="px-3 py-1 rounded bg-slate-100 hover:bg-slate-200 text-sm"
          >
            Loja
          </Link>
        </nav>

        {/* área de auth desktop */}
        <div className="hidden md:flex items-center gap-2">
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

        {/* botão mobile */}
        <button
          onClick={() => setMenuOpen((p) => !p)}
          className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded bg-slate-100"
          aria-label="Abrir menu"
        >
          <span className="w-5 h-[2px] bg-slate-900 block relative">
            <span className="w-5 h-[2px] bg-slate-900 block absolute -top-2 left-0" />
            <span className="w-5 h-[2px] bg-slate-900 block absolute top-2 left-0" />
          </span>
        </button>
      </div>

      {/* menu mobile */}
      {menuOpen && (
        <div className="md:hidden bg-white border-t">
          <nav className="flex flex-col gap-1 px-4 py-3">
            <Link
              href={ginLink}
              onClick={() => setMenuOpen(false)}
              className="px-3 py-2 rounded bg-slate-100 text-sm"
            >
              Ginásios
            </Link>
            <Link
              href="/jogadores"
              onClick={() => setMenuOpen(false)}
              className="px-3 py-2 rounded bg-slate-100 text-sm"
            >
              Jogadores
            </Link>
            {uid && (
              <>
                <Link
                  href={`/perfil/${uid}`}
                  onClick={() => setMenuOpen(false)}
                  className="px-3 py-2 rounded bg-slate-100 text-sm"
                >
                  Meu perfil
                </Link>
                <Link
                  href={`/equipes/${uid}`}
                  onClick={() => setMenuOpen(false)}
                  className="px-3 py-2 rounded bg-slate-100 text-sm"
                >
                  Minhas equipes
                </Link>
              </>
            )}
            <Link
              href="/mapa"
              onClick={() => setMenuOpen(false)}
              className="px-3 py-2 rounded bg-slate-100 text-sm"
            >
              Mapa
            </Link>
            <Link
              href="/trocas"
              onClick={() => setMenuOpen(false)}
              className="px-3 py-2 rounded bg-slate-100 text-sm"
            >
              RTS
            </Link>
            <Link
              href="/loja"
              onClick={() => setMenuOpen(false)}
              className="px-3 py-2 rounded bg-slate-100 text-sm"
            >
              Loja
            </Link>

            <div className="pt-2 border-t mt-2">
              {uid ? (
                <button
                  onClick={handleLogout}
                  className="w-full px-3 py-2 rounded bg-red-500 text-white text-sm text-left"
                >
                  Sair
                </button>
              ) : (
                <Link
                  href="/login"
                  onClick={() => setMenuOpen(false)}
                  className="block w-full px-3 py-2 rounded bg-blue-600 text-white text-sm"
                >
                  Entrar
                </Link>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}