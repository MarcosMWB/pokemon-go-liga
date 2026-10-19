"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { signOut, User } from "firebase/auth";
import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";

const links = [
  { href: "/ginasios", guestHref: "/ginasios/visitante", label: "Ginásios" },
  { href: "/mapa", label: "Mapa da região" },
  { href: "/campeonato-ro", label: "Campeonato" },
  { href: "/trocas", label: "Trocas (RTS)" },
  { href: "/loja", label: "Loja" },
  { href: "/jogadores", label: "Jogadores" },
  { href: "/tutorials", label: "Ajuda e tutoriais" },
];

export function Header() {
  const [uid, setUid] = useState<string | null>(null);
  const [isSuper, setIsSuper] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (current: User | null) => {
      setUid(current?.uid ?? null);
      if (!current) {
        setIsSuper(false);
        return;
      }
      try {
        const sup = await getDoc(doc(db, "superusers", current.uid));
        setIsSuper(sup.exists());
      } catch {
        setIsSuper(false);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  useEffect(() => {
    if (!uid) {
      setUnreadNotifications(0);
      return;
    }
    const q = query(collection(db, "notificacoes", uid, "itens"), where("lida", "==", false));
    return onSnapshot(q, (snapshot) => setUnreadNotifications(snapshot.size), () => setUnreadNotifications(0));
  }, [uid]);

  async function handleLogout() {
    await signOut(auth);
    setMenuOpen(false);
    router.push("/login");
  }

  function linkClass(href: string, mobile = false) {
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return [
      "flex min-h-11 items-center rounded-lg px-3 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700",
      mobile ? "w-full text-base" : "text-sm",
      active ? "bg-blue-100 text-blue-900" : "bg-slate-50 text-slate-800 hover:bg-slate-100",
    ].join(" ");
  }

  const logoHref = isSuper ? "/dev" : "/";

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white shadow-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
        <Link href={logoHref} className="flex min-h-11 min-w-0 items-center gap-2 rounded-md text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700" aria-label="Liga Oceânica — início">
          <Image src="/logo.png" alt="" width={36} height={36} priority />
          <span className="truncate text-base font-bold sm:text-lg">Liga Oceânica</span>
        </Link>

        <nav aria-label="Navegação principal" className="hidden items-center gap-1 2xl:flex">
          {links.map((item) => {
            const href = item.href === "/ginasios" && !uid ? item.guestHref! : item.href;
            return <Link key={item.href} href={href} className={linkClass(item.href)} aria-current={pathname === href ? "page" : undefined}>{item.label}</Link>;
          })}
          {uid && <>
            <Link href={`/perfil/${uid}`} className={linkClass("/perfil")}>Meu perfil</Link>
            <Link href={`/equipes/${uid}`} className={linkClass("/equipes")}>Minha equipe</Link>
            <Link href="/notificacoes" className={linkClass("/notificacoes")} aria-label={`Notificações${unreadNotifications ? `, ${unreadNotifications} não lidas` : ""}`}>
              Avisos{unreadNotifications > 0 ? ` (${unreadNotifications})` : ""}
            </Link>
          </>}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden items-center gap-2 2xl:flex">
            {uid ? <button onClick={handleLogout} className="min-h-11 rounded-lg bg-red-50 px-3 text-sm font-semibold text-red-800 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700">Sair</button> : <>
              <Link href="/login" className="inline-flex min-h-11 items-center rounded-lg px-3 font-semibold text-blue-800 hover:bg-blue-50">Entrar</Link>
              <Link href="/cadastro" className="inline-flex min-h-11 items-center rounded-lg bg-blue-700 px-4 font-semibold text-white hover:bg-blue-800">Criar conta</Link>
            </>}
          </div>
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 2xl:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
            aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span aria-hidden="true" className="text-lg leading-none">{menuOpen ? "×" : "☰"}</span>
            <span>{menuOpen ? "Fechar" : "Menu"}</span>
          </button>
        </div>
      </div>

      <div id="mobile-navigation" hidden={!menuOpen} className="max-h-[calc(100dvh-4rem)] overflow-y-auto border-t border-slate-200 bg-white px-4 pb-6 pt-4 shadow-lg sm:px-6 2xl:hidden">
        <nav aria-label="Menu principal" className="mx-auto max-w-2xl space-y-5">
          <section aria-labelledby="menu-explorar">
            <h2 id="menu-explorar" className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-slate-500">Explorar a Liga</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {links.map((item) => {
                const href = item.href === "/ginasios" && !uid ? item.guestHref! : item.href;
                return <Link key={item.href} href={href} className={linkClass(item.href, true)} aria-current={pathname === href ? "page" : undefined}>{item.label}</Link>;
              })}
            </div>
          </section>
          {uid ? <section aria-labelledby="menu-conta">
            <h2 id="menu-conta" className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-slate-500">Minha conta</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Link href={`/perfil/${uid}`} className={linkClass("/perfil", true)}>Meu perfil</Link>
              <Link href={`/equipes/${uid}`} className={linkClass("/equipes", true)}>Minha equipe</Link>
              <Link href="/notificacoes" className={linkClass("/notificacoes", true)} aria-label={`Notificações${unreadNotifications ? `, ${unreadNotifications} não lidas` : ""}`}>
                Notificações{unreadNotifications > 0 ? ` (${unreadNotifications} não lidas)` : ""}
              </Link>
              <button onClick={handleLogout} className="min-h-11 rounded-lg bg-red-50 px-3 text-left font-semibold text-red-800 hover:bg-red-100">Sair da conta</button>
            </div>
          </section> : <section className="grid grid-cols-1 gap-2 border-t border-slate-200 pt-4 sm:grid-cols-2">
            <Link href="/login" className="flex min-h-12 items-center justify-center rounded-lg border border-blue-700 px-4 font-semibold text-blue-800 hover:bg-blue-50">Já tenho uma conta · Entrar</Link>
            <Link href="/cadastro" className="flex min-h-12 items-center justify-center rounded-lg bg-blue-700 px-4 font-semibold text-white hover:bg-blue-800">Quero participar · Criar conta</Link>
          </section>}
          <p className="rounded-lg bg-blue-50 p-3 text-sm leading-6 text-blue-950">Novo por aqui? Abra <Link href="/tutorials?t=guia-iniciante" className="font-bold underline underline-offset-2">Ajuda e tutoriais</Link> para ver como começar.</p>
        </nav>
      </div>
    </header>
  );
}
