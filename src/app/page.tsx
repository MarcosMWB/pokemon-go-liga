import Link from "next/link";

const steps = [
  { number: "1", title: "Conheça os ginásios", text: "Veja os líderes, os tipos de batalha e as insígnias disponíveis na sua região.", href: "/ginasios/visitante", link: "Ver ginásios" },
  { number: "2", title: "Prepare sua equipe", text: "Crie sua conta e cadastre a equipe que vai usar nos desafios da temporada.", href: "/cadastro", link: "Criar minha conta" },
  { number: "3", title: "Desafie e conquiste", text: "Combine a batalha pelo site. Cada vitória pode render uma insígnia digital no seu perfil.", href: "/tutorials?t=desafios-ginasio", link: "Entender os desafios" },
];

export default function Home() {
  return (
    <div className="mx-auto max-w-5xl space-y-10 pb-8">
      <section className="rounded-2xl border border-blue-100 bg-white p-6 shadow-sm sm:p-10">
        <p className="mb-3 text-sm font-bold uppercase tracking-wide text-blue-800">Pokémon GO · Região Oceânica de Niterói</p>
        <h1 className="max-w-3xl text-3xl font-extrabold leading-tight text-slate-950 sm:text-5xl">Sua Liga Pokémon GO, em um só lugar</h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-700">
          Encontre ginásios, conheça os líderes e participe das batalhas da comunidade. Você pode explorar o site sem criar uma conta.
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <Link href="/ginasios/visitante" className="inline-flex min-h-12 items-center justify-center rounded-xl bg-blue-700 px-6 text-base font-bold text-white shadow-sm hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2">Ver ginásios</Link>
          <Link href="/tutorials?t=guia-iniciante" className="inline-flex min-h-12 items-center justify-center rounded-xl border-2 border-blue-700 bg-white px-6 text-base font-bold text-blue-900 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2">Como funciona? Ver guia rápido</Link>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-700">
          <span>Já tem conta?</span><Link className="min-h-10 inline-flex items-center font-bold text-blue-800 underline underline-offset-2" href="/login">Entrar</Link>
          <span aria-hidden="true">·</span><Link className="min-h-10 inline-flex items-center font-bold text-blue-800 underline underline-offset-2" href="/cadastro">Participar da Liga</Link>
        </div>
      </section>

      <section aria-labelledby="passos-heading">
        <h2 id="passos-heading" className="text-2xl font-bold text-slate-950 sm:text-3xl">Como começar</h2>
        <p className="mt-2 max-w-2xl text-base leading-7 text-slate-700">Não precisa conhecer todas as regras agora. Comece por aqui e o site orienta você no próximo passo.</p>
        <ol className="mt-5 grid gap-4 md:grid-cols-3">
          {steps.map((step) => <li key={step.number} className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-lg font-extrabold text-blue-900">{step.number}</span>
            <h3 className="mt-4 text-lg font-bold text-slate-950">{step.title}</h3>
            <p className="mt-2 flex-1 text-base leading-7 text-slate-700">{step.text}</p>
            <Link href={step.href} className="mt-4 inline-flex min-h-11 items-center font-bold text-blue-800 underline underline-offset-2">{step.link}</Link>
          </li>)}
        </ol>
      </section>

      <section aria-labelledby="recursos-heading" className="rounded-2xl bg-slate-900 p-6 text-white sm:p-8">
        <h2 id="recursos-heading" className="text-2xl font-bold">O que você encontra aqui</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Link href="/mapa" className="min-h-14 rounded-xl bg-white/10 p-4 hover:bg-white/15"><b>Mapa da região</b><span className="mt-1 block text-sm leading-6 text-slate-200">Localize os ginásios e veja quem representa a região.</span></Link>
          <Link href="/campeonato-ro" className="min-h-14 rounded-xl bg-white/10 p-4 hover:bg-white/15"><b>Great Plateau</b><span className="mt-1 block text-sm leading-6 text-slate-200">Acompanhe o campeonato e as disputas pelo título.</span></Link>
          <Link href="/trocas" className="min-h-14 rounded-xl bg-white/10 p-4 hover:bg-white/15"><b>Trocas (RTS)</b><span className="mt-1 block text-sm leading-6 text-slate-200">Encontre outros treinadores para combinar trocas.</span></Link>
          <Link href="/loja" className="min-h-14 rounded-xl bg-white/10 p-4 hover:bg-white/15"><b>Loja da comunidade</b><span className="mt-1 block text-sm leading-6 text-slate-200">Veja produtos e ofertas divulgados no site.</span></Link>
        </div>
      </section>
    </div>
  );
}
