// app/trocas/page.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { auth, db } from '@/lib/firebase'
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
  serverTimestamp,
} from 'firebase/firestore'
import { onAuthStateChanged, User } from 'firebase/auth'
import { PokemonSelect } from '@/components/PokemonSelect'

type DetalhePokemon = {
  shiny?: boolean
  dynamax?: boolean
  especial?: boolean
  nota?: string
}

type Oferta = {
  id: string
  userId: string
  userName?: string
  friendCode?: string
  ofereco: string[]
  quero: string[]
  oferecoDetalhes?: Record<string, DetalhePokemon>
  queroDetalhes?: Record<string, DetalhePokemon>
}

type Match = {
  id: string
  users: string[]
  oferta1Id: string | null
  oferta2Id: string
  userNames?: string[]
  pokesQueEuQueroDoOutro?: string[]
  pokesQueOutroQuerDeMim?: string[]
  invalid?: boolean
  oferta1Detalhes?: Record<string, DetalhePokemon>
  oferta2Detalhes?: Record<string, DetalhePokemon>
}

type Pokemon = {
  id: number
  name: string
}

type MeuSwipe = {
  id: string
  ofertaAlvoId: string
}

export default function TrocasPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const [minhaOferta, setMinhaOferta] = useState<Oferta | null>(null)
  const [ofereco, setOfereco] = useState<string[]>([])
  const [oferecoDetalhes, setOferecoDetalhes] = useState<Record<string, DetalhePokemon>>({})
  const [quero, setQuero] = useState<string[]>([])
  const [queroDetalhes, setQueroDetalhes] = useState<Record<string, DetalhePokemon>>({})

  const [outrasOfertas, setOutrasOfertas] = useState<Oferta[]>([])
  const [matches, setMatches] = useState<Match[]>([])
  const [pokemonList, setPokemonList] = useState<Pokemon[]>([])
  const [meusSwipes, setMeusSwipes] = useState<MeuSwipe[]>([])

  // helper pra sempre exibir shiny/evento
  const renderPokemonChip = (
    nome: string,
    det?: DetalhePokemon,
    extraClass = ''
  ) => (
    <span
      key={nome}
      className={`px-2 py-1 rounded text-xs capitalize ${extraClass || 'bg-slate-200 text-slate-900'
        }`}
    >
      {nome}
      {det?.shiny ? ' ⭐' : ''}
      {det?.dynamax ? ' ✖' : ''}
      {det?.especial ? ' 🎟' : ''}
      {det?.nota ? ` (${det.nota})` : ''}
    </span>
  )

  // carregar pokémon da API
  useEffect(() => {
    async function loadPokemon() {
      try {
        const res = await fetch('https://pokeapi.co/api/v2/pokemon?limit=2000&offset=0')
        const data = await res.json()
        const list: Pokemon[] = data.results.map((item: any, idx: number) => ({
          id: idx + 1,
          name: item.name,
        }))
        setPokemonList(list)
      } catch {
        setPokemonList([])
      }
    }
    loadPokemon()
  }, [])

  // auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (current) => {
      if (!current) {
        router.replace('/login')
        return
      }
      setUser(current)
      await carregarTudo(current.uid)
      setLoading(false)
    })
    return () => unsub()
  }, [router])

  async function carregarTudo(uid: string) {
    // minha oferta
    const qMinhas = query(collection(db, 'trocas_ofertas'), where('userId', '==', uid))
    const minhasSnap = await getDocs(qMinhas)

    if (!minhasSnap.empty) {
      const d = minhasSnap.docs[0]
      const data = d.data() as any
      setMinhaOferta({
        id: d.id,
        userId: data.userId,
        userName: data.userName,
        friendCode: data.friendCode,
        ofereco: data.ofereco || [],
        quero: data.quero || [],
        oferecoDetalhes: data.oferecoDetalhes || {},
        queroDetalhes: data.queroDetalhes || {},
      })
      setOfereco(data.ofereco || [])
      setQuero(data.quero || [])
      setOferecoDetalhes(data.oferecoDetalhes || {})
      setQueroDetalhes(data.queroDetalhes || {})
    } else {
      setMinhaOferta(null)
      setOfereco([])
      setQuero([])
      setOferecoDetalhes({})
      setQueroDetalhes({})
    }

    // outras ofertas
    const todasSnap = await getDocs(collection(db, 'trocas_ofertas'))
    const outrasTemp: Oferta[] = []
    for (const d of todasSnap.docs) {
      const data = d.data() as any
      if (data.userId === uid) continue

      let nome = data.userName as string | undefined
      let fc = data.friendCode as string | undefined

      // se não tem denormalizado, busca no usuarios/{id}
      if (!nome || !fc) {
        const uDoc = await getDoc(doc(db, 'usuarios', data.userId))
        if (uDoc.exists()) {
          const uData = uDoc.data() as any
          nome = nome || uData.nome || undefined
          fc = fc || uData.friend_code || undefined
        }
      }

      outrasTemp.push({
        id: d.id,
        userId: data.userId,
        userName: nome,
        friendCode: fc,
        ofereco: data.ofereco || [],
        quero: data.quero || [],
        oferecoDetalhes: data.oferecoDetalhes || {},
        queroDetalhes: data.queroDetalhes || {},
      })
    }
    setOutrasOfertas(outrasTemp)

    // meus swipes
    const qSwipes = query(
      collection(db, 'trocas_swipes'),
      where('fromUserId', '==', uid),
      where('canceled', '==', false)
    )
    const swipesSnap = await getDocs(qSwipes)
    setMeusSwipes(
      swipesSnap.docs.map((d) => {
        const data = d.data() as any
        return { id: d.id, ofertaAlvoId: data.ofertaAlvoId }
      })
    )

    // matches
    const qMatches = query(
      collection(db, 'trocas_matches'),
      where('users', 'array-contains', uid)
    )
    const matchesSnap = await getDocs(qMatches)
    const lista: Match[] = []
    for (const d of matchesSnap.docs) {
      const data = d.data() as any

      const oferta1Doc = data.oferta1Id
        ? await getDoc(doc(db, 'trocas_ofertas', data.oferta1Id))
        : null
      const oferta2Doc = await getDoc(doc(db, 'trocas_ofertas', data.oferta2Id))

      const o1 = oferta1Doc?.exists() ? (oferta1Doc.data() as any) : null
      const o2 = oferta2Doc.exists() ? (oferta2Doc.data() as any) : null

      const pokesQueOutroQuerDeMim =
        o1 && o2
          ? (o1.ofereco || []).filter((p: string) => (o2.quero || []).includes(p))
          : []
      const pokesQueEuQueroDoOutro =
        o1 && o2
          ? (o2.ofereco || []).filter((p: string) => (o1.quero || []).includes(p))
          : []

      let userNames: string[] = []
      if (Array.isArray(data.users)) {
        const prom = data.users.map(async (uId: string) => {
          const uDoc = await getDoc(doc(db, 'usuarios', uId))
          if (uDoc.exists()) {
            const uData = uDoc.data() as any
            return uData.nome || uData.friend_code || 'Treinador'
          }
          return 'Treinador'
        })
        userNames = await Promise.all(prom)
      }

      lista.push({
        id: d.id,
        users: data.users || [],
        oferta1Id: data.oferta1Id ?? null,
        oferta2Id: data.oferta2Id,
        userNames,
        pokesQueEuQueroDoOutro,
        pokesQueOutroQuerDeMim,
        invalid: data.invalid || false,
        oferta1Detalhes: o1?.oferecoDetalhes || {},
        oferta2Detalhes: o2?.oferecoDetalhes || {},
      })
    }
    setMatches(lista)
  }

  const ofertasCompativeis = useMemo(() => {
    if (!minhaOferta) return []
    return outrasOfertas.filter((of) => {
      const eleTemQueEuQuero = of.ofereco?.some((p) => minhaOferta.quero?.includes(p))
      const eleQuerQueEuTenho = minhaOferta.ofereco?.some((p) => of.quero?.includes(p))
      return !!eleTemQueEuQuero && !!eleQuerQueEuTenho
    })
  }, [outrasOfertas, minhaOferta])

  const handleOferecoChange = (lista: string[]) => {
    setOfereco(lista)
    setOferecoDetalhes((prev) => {
      const next = { ...prev }
      Object.keys(next).forEach((name) => {
        if (!lista.includes(name)) delete next[name]
      })
      lista.forEach((name) => {
        if (!next[name]) next[name] = {}
      })
      return next
    })
  }

  const handleQueroChange = (lista: string[]) => {
    setQuero(lista)
    setQueroDetalhes((prev) => {
      const next = { ...prev }
      Object.keys(next).forEach((name) => {
        if (!lista.includes(name)) delete next[name]
      })
      lista.forEach((name) => {
        if (!next[name]) next[name] = {}
      })
      return next
    })
  }

  async function salvarOferta() {
    if (!user) return

    // pegar nome e friendcode do usuario pra salvar junto
    let nome = user.displayName || undefined
    let friendCode: string | undefined
    const uDoc = await getDoc(doc(db, 'usuarios', user.uid))
    if (uDoc.exists()) {
      const uData = uDoc.data() as any
      nome = uData.nome || nome
      friendCode = uData.friend_code
    }

    const base = {
      userId: user.uid,
      userName: nome || user.email || 'Treinador',
      friendCode: friendCode || null,
      ofereco,
      quero,
      oferecoDetalhes,
      queroDetalhes,
      updatedAt: serverTimestamp(),
    }

    if (minhaOferta) {
      await updateDoc(doc(db, 'trocas_ofertas', minhaOferta.id), base)
    } else {
      await addDoc(collection(db, 'trocas_ofertas'), {
        ...base,
        createdAt: serverTimestamp(),
      })
    }

    await revalidarMatches(user.uid)
    await carregarTudo(user.uid)
  }

  async function revalidarMatches(uid: string) {
    const qMatches = query(
      collection(db, 'trocas_matches'),
      where('users', 'array-contains', uid)
    )
    const snap = await getDocs(qMatches)
    for (const d of snap.docs) {
      const data = d.data() as any
      const o1Doc = data.oferta1Id
        ? await getDoc(doc(db, 'trocas_ofertas', data.oferta1Id))
        : null
      const o2Doc = await getDoc(doc(db, 'trocas_ofertas', data.oferta2Id))

      const o1 = o1Doc?.exists() ? (o1Doc.data() as any) : null
      const o2 = o2Doc.exists() ? (o2Doc.data() as any) : null

      let aindaBate = true
      if (o1 && o2) {
        const a = (o1.ofereco || []).some((p: string) => (o2.quero || []).includes(p))
        const b = (o2.ofereco || []).some((p: string) => (o1.quero || []).includes(p))
        aindaBate = a && b
      } else {
        aindaBate = false
      }

      if (!aindaBate) {
        await updateDoc(doc(db, 'trocas_matches', d.id), {
          invalid: true,
          updatedAt: serverTimestamp(),
        })
      }
    }
  }

  async function handleLike(oferta: Oferta) {
    if (!user) return

    const jaCurti = meusSwipes.find((s) => s.ofertaAlvoId === oferta.id)

    if (!jaCurti) {
      await addDoc(collection(db, 'trocas_swipes'), {
        fromUserId: user.uid,
        toUserId: oferta.userId,
        ofertaAlvoId: oferta.id,
        canceled: false,
        createdAt: serverTimestamp(),
      })

      const q = query(
        collection(db, 'trocas_swipes'),
        where('fromUserId', '==', oferta.userId),
        where('toUserId', '==', user.uid),
        where('canceled', '==', false)
      )
      const snap = await getDocs(q)
      const reciproco = !snap.empty

      if (reciproco) {
        await addDoc(collection(db, 'trocas_matches'), {
          users: [user.uid, oferta.userId],
          oferta1Id: minhaOferta ? minhaOferta.id : null,
          oferta2Id: oferta.id,
          createdAt: serverTimestamp(),
          invalid: false,
        })
      }
    } else {
      await updateDoc(doc(db, 'trocas_swipes', jaCurti.id), {
        canceled: true,
        updatedAt: serverTimestamp(),
      })

      // derruba match de 1 lado só
      const qMatches = query(
        collection(db, 'trocas_matches'),
        where('users', 'array-contains', user.uid)
      )
      const snapM = await getDocs(qMatches)
      for (const d of snapM.docs) {
        const data = d.data() as any
        if (Array.isArray(data.users) && data.users.includes(oferta.userId)) {
          await updateDoc(doc(db, 'trocas_matches', d.id), {
            invalid: true,
            updatedAt: serverTimestamp(),
          })
        }
      }
    }

    await carregarTudo(user.uid!)
  }

  const updateOferecoDetalhe = (
    nome: string,
    campo: 'shiny' | 'dynamax' | 'especial' | 'nota',
    valor: boolean | string
  ) => {
    setOferecoDetalhes((prev) => ({
      ...prev,
      [nome]: {
        ...prev[nome],
        [campo]: valor,
      },
    }))
  }

  const updateQueroDetalhe = (
    nome: string,
    campo: 'shiny' | 'dynamax' | 'especial' | 'nota',
    valor: boolean | string
  ) => {
    setQueroDetalhes((prev) => ({
      ...prev,
      [nome]: {
        ...prev[nome],
        [campo]: valor,
      },
    }))
  }

  if (loading) return <p className="p-6">Carregando...</p>

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-8 flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-slate-900">Regional Trading System – Trocas</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 1) minha oferta */}
        <div className="bg-white rounded-lg shadow p-4 flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-slate-900">Minha oferta</h2>

          {/* ofereço */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Ofereço
            </label>
            <PokemonSelect
              value={ofereco}
              onChange={handleOferecoChange}
              pokemonList={pokemonList}
            />
            {ofereco.length > 0 && (
              <div className="mt-3 flex flex-col gap-3">
                {ofereco.map((name) => {
                  const det = oferecoDetalhes[name] || {}
                  return (
                    <div key={name} className="border rounded-md p-2 bg-slate-50">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold capitalize text-sm">
                          {name}
                          {det.shiny ? ' ⭐' : ''}
                          {det.dynamax ? ' ✖' : ''}
                          {det.especial ? ' 🎟' : ''}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            handleOferecoChange(ofereco.filter((p) => p !== name))
                          }
                          className="text-xs text-red-500 hover:underline"
                        >
                          remover
                        </button>
                      </div>
                      <div className="flex gap-4 items-center mt-1">
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={!!det.shiny}
                            onChange={(e) =>
                              updateOferecoDetalhe(name, 'shiny', e.target.checked)
                            }
                          />
                          shiny
                        </label>
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={!!det.dynamax}
                            onChange={(e) =>
                              updateOferecoDetalhe(name, 'dynamax', e.target.checked)
                            }
                          />
                          dynamax
                        </label>
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={!!det.especial}
                            onChange={(e) =>
                              updateOferecoDetalhe(name, 'especial', e.target.checked)
                            }
                          />
                          especial / evento
                        </label>
                      </div>
                      {det.especial && (
                        <textarea
                          value={det.nota || ''}
                          onChange={(e) => updateOferecoDetalhe(name, 'nota', e.target.value)}
                          className="mt-2 w-full border rounded px-2 py-1 text-xs"
                          placeholder="ex.: evento halloween..."
                          rows={2}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* quero */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Quero
            </label>
            <PokemonSelect
              value={quero}
              onChange={handleQueroChange}
              pokemonList={pokemonList}
            />
            {quero.length > 0 && (
              <div className="mt-3 flex flex-col gap-3">
                {quero.map((name) => {
                  const det = queroDetalhes[name] || {}
                  return (
                    <div key={name} className="border rounded-md p-2 bg-slate-50">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold capitalize text-sm">
                          {name}
                          {det.shiny ? ' ⭐' : ''}
                          {det.dynamax ? ' ✖' : ''}
                          {det.especial ? ' 🎟' : ''}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleQueroChange(quero.filter((p) => p !== name))}
                          className="text-xs text-red-500 hover:underline"
                        >
                          remover
                        </button>
                      </div>
                      <div className="flex gap-4 items-center mt-1">
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={!!det.shiny}
                            onChange={(e) =>
                              updateQueroDetalhe(name, 'shiny', e.target.checked)
                            }
                          />
                          quero shiny
                        </label>
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={!!det.dynamax}
                            onChange={(e) =>
                              updateQueroDetalhe(name, 'dynamax', e.target.checked)
                            }
                          />
                          quero dynamax
                        </label>
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={!!det.especial}
                            onChange={(e) =>
                              updateQueroDetalhe(name, 'especial', e.target.checked)
                            }
                          />
                          quero de evento
                        </label>
                      </div>
                      {(det.especial || det.shiny || det.dynamax) && (
                        <textarea
                          value={det.nota || ''}
                          onChange={(e) => updateQueroDetalhe(name, 'nota', e.target.value)}
                          className="mt-2 w-full border rounded px-2 py-1 text-xs"
                          placeholder="ex.: com fundo x..."
                          rows={2}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <button
            onClick={salvarOferta}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-md font-semibold"
          >
            {minhaOferta ? 'Atualizar oferta' : 'Criar oferta'}
          </button>
        </div>

        {/* 2) ofertas compatíveis */}
        <div className="bg-white rounded-lg shadow p-4 flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-slate-900">Ofertas compatíveis</h2>
          {!minhaOferta ? (
            <p className="text-sm text-slate-500">Crie sua oferta primeiro.</p>
          ) : ofertasCompativeis.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma oferta compatível agora.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {ofertasCompativeis.map((of) => {
                const jaCurti = meusSwipes.some((s) => s.ofertaAlvoId === of.id)
                return (
                  <div key={of.id} className="border rounded-md p-3 bg-slate-50 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-slate-800">
                          {of.userName || 'Treinador'}
                        </p>
                        {of.friendCode && (
                          <p className="text-xs text-slate-500">FC: {of.friendCode}</p>
                        )}
                      </div>
                      <button
                        onClick={() => handleLike(of)}
                        className={
                          jaCurti
                            ? 'text-sm bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded'
                            : 'text-sm bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded'
                        }
                      >
                        {jaCurti ? 'Cancelar' : 'Gostei'}
                      </button>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 mb-1">Oferece:</p>
                      <div className="flex flex-wrap gap-2">
                        {of.ofereco?.map((p) => {
                          const det =
                            of.oferecoDetalhes?.[p] ||
                            of.queroDetalhes?.[p] || // fallback: se o cara marcou no lugar “errado” ainda mostra
                            undefined

                          return (
                            <span
                              key={p}
                              className="bg-slate-200 text-slate-900 px-2 py-1 rounded text-xs capitalize"
                            >
                              {p}
                              {det?.shiny ? ' ⭐' : ''}
                              {det?.dynamax ? ' ✖' : ''}
                              {det?.especial ? ' 🎟' : ''}
                              {det?.nota ? ` (${det.nota})` : ''}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 mb-1">Quer:</p>
                      <div className="flex flex-wrap gap-2">
                        {of.quero?.map((p) => {
                          // tenta pegar dos dois, igual no "oferece"
                          const det =
                            of.queroDetalhes?.[p] ||
                            of.oferecoDetalhes?.[p] ||
                            undefined

                          return (
                            <span
                              key={p}
                              className="bg-indigo-100 text-indigo-900 px-2 py-1 rounded text-xs capitalize"
                            >
                              {p}
                              {det?.shiny ? ' ⭐' : ''}
                              {det?.dynamax ? ' ✖' : ''}
                              {det?.especial ? ' 🎟' : ''}
                              {det?.nota ? ` (${det.nota})` : ''}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 3) matches */}
        <div className="bg-white rounded-lg shadow p-4 flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-slate-900">Matches</h2>
          {matches.filter((m) => !m.invalid).length === 0 ? (
            <p className="text-sm text-slate-500">Nenhum match válido no momento.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {matches
                .filter((m) => !m.invalid)
                .map((m) => (
                  <div key={m.id} className="border rounded-md p-3 bg-green-50">
                    <p className="text-sm text-slate-800 font-semibold">Match entre:</p>
                    <p className="text-sm mb-2">
                      {m.userNames?.length ? m.userNames.join(' e ') : m.users.join(' e ')}
                    </p>

                    <p className="text-xs text-slate-700 font-semibold mb-1">
                      Ele tem para você:
                    </p>
                    {m.pokesQueEuQueroDoOutro && m.pokesQueEuQueroDoOutro.length > 0 ? (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {m.pokesQueEuQueroDoOutro.map((p) =>
                          renderPokemonChip(
                            p,
                            m.oferta2Detalhes?.[p] || m.oferta1Detalhes?.[p],
                            'bg-white text-green-700'
                          )
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 mb-2">nenhum listado</p>
                    )}

                    <p className="text-xs text-slate-700 font-semibold mb-1">
                      Você tem para ele:
                    </p>
                    {m.pokesQueOutroQuerDeMim && m.pokesQueOutroQuerDeMim.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {m.pokesQueOutroQuerDeMim.map((p) =>
                          renderPokemonChip(
                            p,
                            m.oferta1Detalhes?.[p] || m.oferta2Detalhes?.[p],
                            'bg-white text-green-700'
                          )
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">nenhum listado</p>
                    )}
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
