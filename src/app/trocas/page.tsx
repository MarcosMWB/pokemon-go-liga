// app/trocas/page.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { auth, db } from '@/lib/firebase'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { onAuthStateChanged, User } from 'firebase/auth'
import { PokemonSelect } from '@/components/PokemonSelect'
import type { Unsubscribe } from 'firebase/firestore'
import Image from 'next/image'

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
  friendCode?: string | null
  ofereco: string[]
  quero: string[]
  oferecoDetalhes?: Record<string, DetalhePokemon>
  queroDetalhes?: Record<string, DetalhePokemon>
  // NOVO: filtro por localização
  alcanceKm?: number | null
  encontroLat?: number | null
  encontroLng?: number | null
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

type Pokemon = { id: number; name: string }
type MeuSwipe = { id: string; ofertaAlvoId: string }

type ChatMsg = {
  id: string
  from: string
  text: string
  createdAt?: any
}

// NOVO: tipo auxiliar para cálculo de distância
type LocInfo = {
  alcanceKm?: number | null
  encontroLat?: number | null
  encontroLng?: number | null
}

// NOVO: distância em km entre duas coordenadas (haversine)
function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371 // km
  const toRad = (v: number) => (v * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// NOVO: verifica se A e B estão dentro do raio um do outro
function isWithinMutualRange(a: LocInfo, b: LocInfo): boolean {
  const latA = a.encontroLat
  const lngA = a.encontroLng
  const latB = b.encontroLat
  const lngB = b.encontroLng

  // Se faltar coordenada em qualquer um, não restringe por distância (compatibilidade com ofertas antigas)
  if (latA == null || lngA == null || latB == null || lngB == null) return true

  const dist = distanceKm(latA, lngA, latB, lngB)

  const rA = a.alcanceKm == null ? Infinity : a.alcanceKm
  const rB = b.alcanceKm == null ? Infinity : b.alcanceKm

  return dist <= rA && dist <= rB
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

  const [mostrarPorNecessidade, setMostrarPorNecessidade] = useState(false)

  const [chatOpen, setChatOpen] = useState(false)
  const [chatMatchId, setChatMatchId] = useState<string | null>(null)
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatOtherName, setChatOtherName] = useState<string>('Treinador')
  const [chatOtherFC, setChatOtherFC] = useState<string | null>(null)
  const [chatMyFC, setChatMyFC] = useState<string | null>(null)

  const [chatFilterLang, setChatFilterLang] = useState<'pt' | 'en'>('pt')
  const [chatOtherQuero, setChatOtherQuero] = useState<string[]>([])
  const [chatMyQuero, setChatMyQuero] = useState<string[]>([])

  const chatUnsubRef = useRef<Unsubscribe | null>(null)
  const matchUnsubRef = useRef<Unsubscribe | null>(null)
  const matchesListenerRef = useRef<Unsubscribe | null>(null)
  const chatInputRef = useRef<HTMLInputElement>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // NOVO: estado para alcance e ponto de encontro
  const [alcanceKm, setAlcanceKm] = useState<number | null>(null) // null = ilimitado
  const [encontroLat, setEncontroLat] = useState<number | null>(null)
  const [encontroLng, setEncontroLng] = useState<number | null>(null)
  const [geolocLoading, setGeolocLoading] = useState(false)
  const [geolocError, setGeolocError] = useState<string | null>(null)

  const renderPokemonChip = (nome: string, det?: DetalhePokemon, extraClass = '') => (
    <span
      key={nome}
      className={`px-2 py-1 rounded text-xs capitalize ${extraClass || 'bg-slate-200 text-slate-900'}`}
    >
      {nome}
      {det?.shiny ? ' ⭐' : ''}
      {det?.dynamax ? ' ✖' : ''}
      {det?.especial ? ' 🎟' : ''}
      {det?.nota ? ` (${det.nota})` : ''}
    </span>
  )

  const qrSrc = (data: string) =>
    `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(data)}`

  const buildPoGoFriendLinks = (fc: string) => {
    const native = `pokemongo://?dl_action=AddFriend&DlId=${encodeURIComponent(fc)}`
    const androidIntent = `intent://?dl_action=AddFriend&DlId=${encodeURIComponent(
      fc
    )}#Intent;scheme=pokemongo;package=com.nianticlabs.pokemongo;end`
    return { native, androidIntent }
  }

  // gmax agregados em UMA linha
  const buildFilters = (list: string[], lang: 'pt' | 'en'): string[] => {
    const extras =
      lang === 'pt'
        ? ' & !trocado & !sombroso & !mitíco & !4*'
        : ' & !traded & !shadow & !mythical & !4*'
    const giga = lang === 'pt' ? 'gigamax' : 'gigantamax'

    const normals: string[] = []
    const gmaxBases: string[] = []

    for (const raw of list || []) {
      const n = (raw || '').toLowerCase().trim()
      if (!n) continue
      if (/-gmax$/.test(n)) {
        const base = n.replace(/-gmax$/, '')
        if (base) gmaxBases.push(base)
      } else {
        normals.push(n)
      }
    }

    const out: string[] = []
    if (normals.length > 0) out.push(`${normals.join(', ')}${extras}`)
    if (gmaxBases.length > 0) out.push(`${gmaxBases.join(', ')} & ${giga}${extras}`)
    return out
  }

  const isAndroid =
    typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '')

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

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (current) => {
      if (!current) {
        router.replace('/login')
        return
      }
      setUser(current)
      await carregarTudo(current.uid)
      setLoading(false)
      attachMatchesListener(current.uid)
    })
    return () => {
      unsub()
      if (matchesListenerRef.current) matchesListenerRef.current()
    }
  }, [router])

  function attachMatchesListener(uid: string) {
    if (matchesListenerRef.current) matchesListenerRef.current()
    const qMatches = query(collection(db, 'trocas_matches'), where('users', 'array-contains', uid))
    matchesListenerRef.current = onSnapshot(qMatches, async (snap) => {
      const out: Match[] = await Promise.all(
        snap.docs.map(async (d) => {
          const data = d.data() as any
          const oferta1Doc = data.oferta1Id ? await getDoc(doc(db, 'trocas_ofertas', data.oferta1Id)) : null
          const oferta2Doc = await getDoc(doc(db, 'trocas_ofertas', data.oferta2Id))
          const o1 = oferta1Doc?.exists() ? (oferta1Doc.data() as any) : null
          const o2 = oferta2Doc.exists() ? (oferta2Doc.data() as any) : null

          const pokesQueOutroQuerDeMim =
            o1 && o2 ? (o1.ofereco || []).filter((p: string) => (o2.quero || []).includes(p)) : []
          const pokesQueEuQueroDoOutro =
            o1 && o2 ? (o2.ofereco || []).filter((p: string) => (o1.quero || []).includes(p)) : []

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

          return {
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
          } as Match
        })
      )
      setMatches(out)
    })
  }

  async function carregarTudo(uid: string) {
    const qMinhas = query(collection(db, 'trocas_ofertas'), where('userId', '==', uid))
    const minhasSnap = await getDocs(qMinhas)

    if (!minhasSnap.empty) {
      const d = minhasSnap.docs[0]
      const data = d.data() as any
      const mine: Oferta = {
        id: d.id,
        userId: data.userId,
        userName: data.userName,
        friendCode: data.friendCode ?? null,
        ofereco: data.ofereco || [],
        quero: data.quero || [],
        oferecoDetalhes: data.oferecoDetalhes || {},
        queroDetalhes: data.queroDetalhes || {},
        alcanceKm: typeof data.alcanceKm === 'number' ? data.alcanceKm : null,
        encontroLat: typeof data.encontroLat === 'number' ? data.encontroLat : null,
        encontroLng: typeof data.encontroLng === 'number' ? data.encontroLng : null,
      }
      setMinhaOferta(mine)
      setOfereco(mine.ofereco)
      setQuero(mine.quero)
      setOferecoDetalhes(mine.oferecoDetalhes || {})
      setQueroDetalhes(mine.queroDetalhes || {})
      setChatMyFC((mine.friendCode as string) || null)
      setAlcanceKm(mine.alcanceKm ?? null)
      setEncontroLat(mine.encontroLat ?? null)
      setEncontroLng(mine.encontroLng ?? null)
    } else {
      setMinhaOferta(null)
      setOfereco([])
      setQuero([])
      setOferecoDetalhes({})
      setQueroDetalhes({})
      setChatMyFC(null)
      setAlcanceKm(null)
      setEncontroLat(null)
      setEncontroLng(null)
    }

    const todasSnap = await getDocs(collection(db, 'trocas_ofertas'))
    const outrasTemp: Oferta[] = []
    for (const d of todasSnap.docs) {
      const data = d.data() as any
      if (data.userId === uid) continue

      let nome = data.userName as string | undefined
      let fc = (data.friendCode as string | null | undefined) ?? null

      if (!nome || !fc) {
        const uDoc = await getDoc(doc(db, 'usuarios', data.userId))
        if (uDoc.exists()) {
          const uData = uDoc.data() as any
          nome = nome || uData.nome || undefined
          fc = fc ?? (uData.friend_code || null)
        }
      }

      outrasTemp.push({
        id: d.id,
        userId: data.userId,
        userName: nome,
        friendCode: fc ?? null,
        ofereco: data.ofereco || [],
        quero: data.quero || [],
        oferecoDetalhes: data.oferecoDetalhes || {},
        queroDetalhes: data.queroDetalhes || {},
        alcanceKm: typeof data.alcanceKm === 'number' ? data.alcanceKm : null,
        encontroLat: typeof data.encontroLat === 'number' ? data.encontroLat : null,
        encontroLng: typeof data.encontroLng === 'number' ? data.encontroLng : null,
      })
    }
    setOutrasOfertas(outrasTemp)

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

    const qMatches = query(collection(db, 'trocas_matches'), where('users', 'array-contains', uid))
    const matchesSnap = await getDocs(qMatches)
    const lista: Match[] = []
    for (const d of matchesSnap.docs) {
      const data = d.data() as any

      const oferta1Doc = data.oferta1Id ? await getDoc(doc(db, 'trocas_ofertas', data.oferta1Id)) : null
      const oferta2Doc = await getDoc(doc(db, 'trocas_ofertas', data.oferta2Id))

      const o1 = oferta1Doc?.exists() ? (oferta1Doc.data() as any) : null
      const o2 = oferta2Doc.exists() ? (oferta2Doc.data() as any) : null

      const pokesQueOutroQuerDeMim =
        o1 && o2 ? (o1.ofereco || []).filter((p: string) => (o2.quero || []).includes(p)) : []
      const pokesQueEuQueroDoOutro =
        o1 && o2 ? (o2.ofereco || []).filter((p: string) => (o1.quero || []).includes(p)) : []

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

      const dentroDoAlcance = isWithinMutualRange(
        {
          alcanceKm,
          encontroLat,
          encontroLng,
        },
        of
      )

      return !!eleTemQueEuQuero && !!eleQuerQueEuTenho && dentroDoAlcance
    })
  }, [outrasOfertas, minhaOferta, alcanceKm, encontroLat, encontroLng])

  const ofertasPorNecessidade = useMemo(() => {
    if (!minhaOferta) return []
    return outrasOfertas.filter((of) => {
      const eleTemQueEuQuero = of.ofereco?.some((p) => minhaOferta.quero?.includes(p))
      const dentroDoAlcance = isWithinMutualRange(
        {
          alcanceKm,
          encontroLat,
          encontroLng,
        },
        of
      )
      return !!eleTemQueEuQuero && dentroDoAlcance
    })
  }, [outrasOfertas, minhaOferta, alcanceKm, encontroLat, encontroLng])

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

  // NOVO: pegar localização atual
  function handleUseCurrentLocation() {
    if (!navigator.geolocation) {
      setGeolocError('Seu navegador não permite pegar a localização automática.')
      return
    }
    setGeolocLoading(true)
    setGeolocError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setEncontroLat(pos.coords.latitude)
        setEncontroLng(pos.coords.longitude)
        setGeolocLoading(false)
      },
      () => {
        setGeolocError('Não foi possível obter sua localização.')
        setGeolocLoading(false)
      }
    )
  }

  async function salvarOferta() {
    if (!user) return

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
      alcanceKm,
      encontroLat,
      encontroLng,
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
    const qMatches = query(collection(db, 'trocas_matches'), where('users', 'array-contains', uid))
    const snap = await getDocs(qMatches)
    for (const d of snap.docs) {
      const data = d.data() as any
      const o1Doc = data.oferta1Id ? await getDoc(doc(db, 'trocas_ofertas', data.oferta1Id)) : null
      const o2Doc = await getDoc(doc(db, 'trocas_ofertas', data.oferta2Id))

      const o1 = o1Doc?.exists() ? (o1Doc.data() as any) : null
      const o2 = o2Doc.exists() ? (o2Doc.data() as any) : null

      let aindaBate = true
      if (o1 && o2) {
        const a = (o1.ofereco || []).some((p: string) => (o2.quero || []).includes(p))
        const b = (o2.ofereco || []).some((p: string) => (o1.quero || []).includes(p))
        const geoOk = isWithinMutualRange(
          {
            alcanceKm: typeof o1.alcanceKm === 'number' ? o1.alcanceKm : null,
            encontroLat: typeof o1.encontroLat === 'number' ? o1.encontroLat : null,
            encontroLng: typeof o1.encontroLng === 'number' ? o1.encontroLng : null,
          },
          {
            alcanceKm: typeof o2.alcanceKm === 'number' ? o2.alcanceKm : null,
            encontroLat: typeof o2.encontroLat === 'number' ? o2.encontroLat : null,
            encontroLng: typeof o2.encontroLng === 'number' ? o2.encontroLng : null,
          }
        )
        aindaBate = a && b && geoOk
      } else {
        aindaBate = false
      }

      if (!aindaBate) {
        await updateDoc(doc(db, 'trocas_matches', d.id), {
          invalid: true,
          updatedAt: serverTimestamp(),
        })
        await clearChat(d.id)
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

      const qReciproco = query(
        collection(db, 'trocas_swipes'),
        where('fromUserId', '==', oferta.userId),
        where('toUserId', '==', user.uid),
        where('canceled', '==', false)
      )
      const snap = await getDocs(qReciproco)
      const reciproco = !snap.empty

      if (reciproco) {
        // NOVO: checar raio dos dois antes de criar match
        const geoOk = isWithinMutualRange(
          {
            alcanceKm,
            encontroLat,
            encontroLng,
          },
          oferta
        )

        if (!geoOk) {
          alert('Este jogador está fora do seu raio de alcance configurado.')
        } else {
          const matchRef = await addDoc(collection(db, 'trocas_matches'), {
            users: [user.uid, oferta.userId],
            oferta1Id: minhaOferta ? minhaOferta.id : null,
            oferta2Id: oferta.id,
            createdAt: serverTimestamp(),
            invalid: false,
            seededBy: user.uid,
          })

          await seedFilterMessage(matchRef.id)

          await carregarTudo(user.uid)
          openChatByMatchId(matchRef.id)
        }
      }
    } else {
      await updateDoc(doc(db, 'trocas_swipes', jaCurti.id), {
        canceled: true,
        updatedAt: serverTimestamp(),
      })

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
          await clearChat(d.id)
        }
      }
    }

    await carregarTudo(user.uid!)
  }

  async function seedFilterMessage(matchId: string) {
    const texto = `Mensagens com o outro treinador:\n`
    await addDoc(collection(db, 'trocas_matches', matchId, 'mensagens'), {
      from: 'system',
      text: texto,
      createdAt: serverTimestamp(),
    })
  }

  async function openChatByMatchId(matchId: string) {
    if (!user) return
    if (chatUnsubRef.current) chatUnsubRef.current()
    if (matchUnsubRef.current) matchUnsubRef.current()

    setChatMatchId(matchId)
    setChatMsgs([])
    setChatInput('')
    setChatOpen(true)

    const mDoc = await getDoc(doc(db, 'trocas_matches', matchId))
    if (mDoc.exists()) {
      const mData = mDoc.data() as any
      const usersArr: string[] = mData.users || []
      const otherId = usersArr.find((u) => u !== user.uid) || null

      let myFC = chatMyFC
      if (!myFC && minhaOferta?.friendCode) myFC = minhaOferta.friendCode
      if (!myFC) {
        const meDoc = await getDoc(doc(db, 'usuarios', user.uid))
        if (meDoc.exists()) {
          const d = meDoc.data() as any
          myFC = d.friend_code || null
        }
      }
      setChatMyFC(myFC || null)

      let otherFC: string | null = null
      let otherName: string = 'Treinador'
      let otherQuero: string[] = []
      let myQuero: string[] = minhaOferta?.quero || []

      const myOfferId = mData.oferta1Id === minhaOferta?.id ? mData.oferta1Id : mData.oferta2Id
      if (myOfferId) {
        const myOfferDoc = await getDoc(doc(db, 'trocas_ofertas', myOfferId))
        if (myOfferDoc.exists()) {
          const od = myOfferDoc.data() as any
          myQuero = Array.isArray(od.quero) ? od.quero : myQuero
        }
      }

      if (otherId) {
        const otherOfertaId =
          mData.oferta1Id && minhaOferta && mData.oferta1Id !== minhaOferta.id
            ? mData.oferta1Id
            : mData.oferta2Id

        if (otherOfertaId) {
          const oDoc = await getDoc(doc(db, 'trocas_ofertas', otherOfertaId))
          if (oDoc.exists()) {
            const od = oDoc.data() as any
            otherFC = od.friendCode ?? null
            otherName = od.userName || otherName
            otherQuero = Array.isArray(od.quero) ? od.quero : []
          }
        }

        if (!otherFC || otherName === 'Treinador') {
          const uDoc = await getDoc(doc(db, 'usuarios', otherId))
          if (uDoc.exists()) {
            const ud = uDoc.data() as any
            otherFC = otherFC ?? ud.friend_code ?? null
            otherName = otherName === 'Treinador' ? (ud.nome || otherName) : otherName
          }
        }
      }

      setChatOtherFC(otherFC || null)
      setChatOtherName(otherName)
      setChatOtherQuero(otherQuero || [])
      setChatMyQuero(myQuero || [])
    }

    const msgsQ = query(
      collection(db, 'trocas_matches', matchId, 'mensagens'),
      orderBy('createdAt', 'asc')
    )
    chatUnsubRef.current = onSnapshot(msgsQ, (snap) => {
      const arr: ChatMsg[] = snap.docs.map((d) => {
        const x = d.data() as any
        return { id: d.id, from: x.from, text: x.text, createdAt: x.createdAt }
      })
      setChatMsgs(arr)
      setTimeout(() => {
        chatInputRef.current?.focus()
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
      }, 50)
    })

    matchUnsubRef.current = onSnapshot(doc(db, 'trocas_matches', matchId), async (d) => {
      if (d.exists()) {
        const inv = (d.data() as any).invalid
        if (inv) {
          await clearChat(matchId)
          closeChat()
          if (user) await carregarTudo(user.uid!)
        }
      }
    })
  }

  function closeChat() {
    if (chatUnsubRef.current) chatUnsubRef.current()
    if (matchUnsubRef.current) matchUnsubRef.current()
    setChatOpen(false)
    setChatMatchId(null)
    setChatMsgs([])
    setChatInput('')
    setChatOtherFC(null)
  }

  async function sendChatMessage() {
    if (!user || !chatMatchId || !chatInput.trim()) return
    await addDoc(collection(db, 'trocas_matches', chatMatchId, 'mensagens'), {
      from: user.uid,
      text: chatInput.trim(),
      createdAt: serverTimestamp(),
    })
    setChatInput('')
  }

  async function finalizeMatch() {
    if (!chatMatchId) return
    await updateDoc(doc(db, 'trocas_matches', chatMatchId), {
      invalid: true,
      updatedAt: serverTimestamp(),
    })
    await clearChat(chatMatchId)
    closeChat()
    if (user) await carregarTudo(user.uid)
  }

  async function clearChat(matchId: string) {
    const snap = await getDocs(collection(db, 'trocas_matches', matchId, 'mensagens'))
    const batchDeletes = snap.docs.map((d) =>
      deleteDoc(doc(db, 'trocas_matches', matchId, 'mensagens', d.id))
    )
    await Promise.all(batchDeletes)
  }

  // auto-scroll para a última mensagem
  useEffect(() => {
    if (!chatOpen) return
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [chatOpen])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [chatMsgs])

  if (loading) return <p className="p-6">Carregando...</p>

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-8 flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-slate-900">Regional Trading System – Trocas</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 1) Minha oferta */}
        <div className="bg-white rounded-lg shadow p-4 flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-slate-900">Minha oferta</h2>

          {/* Ofereço */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Ofereço</label>
            <PokemonSelect value={ofereco} onChange={handleOferecoChange} pokemonList={pokemonList} />
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
                          onClick={() => handleOferecoChange(ofereco.filter((p) => p !== name))}
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
                              setOferecoDetalhes((prev) => ({
                                ...prev,
                                [name]: { ...prev[name], shiny: e.target.checked },
                              }))
                            }
                          />
                          shiny
                        </label>
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={!!det.dynamax}
                            onChange={(e) =>
                              setOferecoDetalhes((prev) => ({
                                ...prev,
                                [name]: { ...prev[name], dynamax: e.target.checked },
                              }))
                            }
                          />
                          dynamax
                        </label>
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={!!det.especial}
                            onChange={(e) =>
                              setOferecoDetalhes((prev) => ({
                                ...prev,
                                [name]: { ...prev[name], especial: e.target.checked },
                              }))
                            }
                          />
                          especial / evento
                        </label>
                      </div>
                      {det.especial && (
                        <textarea
                          value={det.nota || ''}
                          onChange={(e) =>
                            setOferecoDetalhes((prev) => ({
                              ...prev,
                              [name]: { ...prev[name], nota: e.target.value },
                            }))
                          }
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

          {/* Quero */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Quero</label>
            <PokemonSelect value={quero} onChange={handleQueroChange} pokemonList={pokemonList} />
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
                              setQueroDetalhes((prev) => ({
                                ...prev,
                                [name]: { ...prev[name], shiny: e.target.checked },
                              }))
                            }
                          />
                          quero shiny
                        </label>
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={!!det.dynamax}
                            onChange={(e) =>
                              setQueroDetalhes((prev) => ({
                                ...prev,
                                [name]: { ...prev[name], dynamax: e.target.checked },
                              }))
                            }
                          />
                          quero dynamax
                        </label>
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={!!det.especial}
                            onChange={(e) =>
                              setQueroDetalhes((prev) => ({
                                ...prev,
                                [name]: { ...prev[name], especial: e.target.checked },
                              }))
                            }
                          />
                          quero de evento
                        </label>
                      </div>
                      {(det.especial || det.shiny || det.dynamax) && (
                        <textarea
                          value={det.nota || ''}
                          onChange={(e) =>
                            setQueroDetalhes((prev) => ({
                              ...prev,
                              [name]: { ...prev[name], nota: e.target.value },
                            }))
                          }
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

          {/* NOVO: Ponto de encontro e alcance */}
          <div className="border rounded-md p-3 bg-slate-50 mt-2 flex flex-col gap-3">
            <div>
              <p className="text-sm font-medium text-slate-700">Ponto de encontro</p>
              <p className="text-xs text-slate-500">
                Usado para filtrar trocas presenciais por distância. Você pode usar sua localização atual
                ou digitar as coordenadas manualmente.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleUseCurrentLocation}
                className="text-xs px-3 py-1 rounded bg-slate-800 text-white"
                disabled={geolocLoading}
              >
                {geolocLoading ? 'Buscando localização...' : 'Usar localização atual'}
              </button>
              {geolocError && <span className="text-xs text-red-500">{geolocError}</span>}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                step="0.000001"
                value={encontroLat ?? ''}
                onChange={(e) =>
                  setEncontroLat(e.target.value === '' ? null : parseFloat(e.target.value))
                }
                className="border rounded px-2 py-1 text-xs"
                placeholder="Latitude (ex.: -22.9100)"
              />
              <input
                type="number"
                step="0.000001"
                value={encontroLng ?? ''}
                onChange={(e) =>
                  setEncontroLng(e.target.value === '' ? null : parseFloat(e.target.value))
                }
                className="border rounded px-2 py-1 text-xs"
                placeholder="Longitude (ex.: -43.5600)"
              />
            </div>

            <p className="text-xs text-slate-500">
              {encontroLat != null && encontroLng != null
                ? `Ponto salvo: ${encontroLat.toFixed(5)}, ${encontroLng.toFixed(5)}`
                : 'Nenhum ponto de encontro salvo ainda.'}
            </p>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Alcance máximo
              </label>
              <select
                value={alcanceKm === null ? 'unlimited' : String(alcanceKm)}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === 'unlimited') {
                    setAlcanceKm(null)
                  } else {
                    const num = parseFloat(v)
                    setAlcanceKm(Number.isNaN(num) ? null : num)
                  }
                }}
                className="w-full border rounded px-2 py-1 text-sm"
              >
                <option value="unlimited">Ilimitado</option>
                <option value="100">100 km</option>
                <option value="50">50 km</option>
                <option value="25">25 km</option>
                <option value="10">10 km</option>
                <option value="5">5 km</option>
                <option value="1">1 km</option>
                <option value="0.3">300 m</option>
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                Para dar match, vocês precisam estar dentro do alcance configurado um do outro.
              </p>
            </div>
          </div>

          <button
            onClick={salvarOferta}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-md font-semibold"
          >
            {minhaOferta ? 'Atualizar oferta' : 'Criar oferta'}
          </button>
        </div>

        {/* 2) Ofertas compatíveis / Modo sugestão */}
        <div className="bg-white rounded-lg shadow p-4 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-slate-900">Ofertas compatíveis</h2>
            <button
              onClick={() => setMostrarPorNecessidade((v) => !v)}
              className={`text-xs px-3 py-1 rounded ${
                mostrarPorNecessidade ? 'bg-purple-600 text-white' : 'bg-slate-200 text-slate-800'
              }`}
            >
              {mostrarPorNecessidade ? 'Mostrar só matches reais' : 'Ver quem tem o que quero'}
            </button>
          </div>

          {!minhaOferta ? (
            <p className="text-sm text-slate-500">Crie sua oferta primeiro.</p>
          ) : (mostrarPorNecessidade ? ofertasPorNecessidade : ofertasCompativeis).length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma oferta encontrada.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {(mostrarPorNecessidade ? ofertasPorNecessidade : ofertasCompativeis).map((of) => {
                const jaCurti = meusSwipes.some((s) => s.ofertaAlvoId === of.id)
                const faltandoPraBater =
                  mostrarPorNecessidade && minhaOferta
                    ? of.quero.filter((p) => !minhaOferta.ofereco.includes(p))
                    : []

                return (
                  <div key={of.id} className="border rounded-md p-3 bg-slate-50 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-slate-800">{of.userName || 'Treinador'}</p>
                        {of.friendCode && <p className="text-xs text-slate-500">FC: {of.friendCode}</p>}
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
                          const det = of.oferecoDetalhes?.[p] || of.queroDetalhes?.[p] || undefined
                          return renderPokemonChip(p, det)
                        })}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs text-slate-500 mb-1">Quer:</p>
                      <div className="flex flex-wrap gap-2">
                        {of.quero?.map((p) => {
                          const det = of.queroDetalhes?.[p] || of.oferecoDetalhes?.[p] || undefined
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

                    {mostrarPorNecessidade && faltandoPraBater.length > 0 && (
                      <div className="bg-amber-50 border border-amber-200 rounded p-2">
                        <p className="text-xs text-amber-700 mb-1">
                          Pra dar match com esse jogador, você precisaria oferecer:
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {faltandoPraBater.map((p) => (
                            <span
                              key={p}
                              className="bg-amber-200 text-amber-900 px-2 py-1 rounded text-xs capitalize"
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 3) Matches */}
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
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-slate-800 font-semibold">Match entre:</p>
                        <p className="text-sm mb-2">
                          {m.userNames?.length ? m.userNames.join(' e ') : m.users.join(' e ')}
                        </p>
                      </div>
                      <button
                        className="text-xs px-3 py-1 rounded bg-slate-800 text-white"
                        onClick={() => openChatByMatchId(m.id)}
                      >
                        Abrir chat
                      </button>
                    </div>

                    <p className="text-xs text-slate-700 font-semibold mb-1">Ele tem para você:</p>
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

                    <p className="text-xs text-slate-700 font-semibold mb-1">Você tem para ele:</p>
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

      {/* ---------- DIALOG DE CHAT / ADD FRIEND ---------- */}
      {chatOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={closeChat} />
          <div className="relative bg-white w-full max-w-2xl rounded-xl shadow-xl p-4 md:p-6 max-h-[90vh] overflow-y-auto overscroll-contain">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Troca & Chat</h3>
                <p className="text-sm text-slate-600">
                  Conversa entre você e <span className="font-medium">{chatOtherName}</span>
                </p>
              </div>
              <button className="text-slate-500 hover:text-slate-800 text-sm" onClick={closeChat}>
                Fechar
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* FC do outro */}
              <div className="border rounded-lg p-3 md:col-span-2">
                {chatOtherFC ? (
                  <>
                    {(() => {
                      const { native, androidIntent } = buildPoGoFriendLinks(chatOtherFC!)
                      const deep = isAndroid ? androidIntent : native

                      return (
                        <div className="grid grid-cols-[1fr_auto] items-start gap-x-3 gap-y-1">
                          <div className="flex flex-col gap-1">
                            <p className="text-xs text-slate-500">Adicionar {chatOtherName}:</p>
                            <p className="text-sm font-semibold">
                              Código:{' '}
                              <button
                                onClick={() => navigator.clipboard?.writeText(chatOtherFC!)}
                                className="text-xs bg-slate-200 hover:bg-slate-300 px-2 py-1 rounded"
                              >
                                {chatOtherFC}
                              </button>
                            </p>
                            <a href={deep} className="text-blue-600 text-sm hover:underline">
                              Abrir no Pokémon GO
                            </a>
                          </div>

                          <Image
                            src={qrSrc(native)}
                            alt="QR para adicionar no Pokémon GO"
                            width={160}
                            height={160}
                            className="block w-40 h-40 border rounded self-start justify-self-end m-0"
                          />
                        </div>
                      )
                    })()}
                  </>
                ) : (
                  <p className="text-xs text-amber-600">O outro jogador não cadastrou FC.</p>
                )}
              </div>
            </div>

            {/* Filtros rápidos (PT/EN) – gmax agrupado em uma linha */}
            <div className="mt-4 border rounded-lg p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-800">Filtros rápidos</p>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-600">Idioma</label>
                  <select
                    value={chatFilterLang}
                    onChange={(e) => setChatFilterLang(e.target.value as 'pt' | 'en')}
                    className="border rounded px-2 py-1 text-xs"
                  >
                    <option value="pt">Português</option>
                    <option value="en">English</option>
                  </select>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Para você procurar o que o outro quer */}
                <div className="bg-slate-50 border rounded p-2">
                  <p className="text-xs text-slate-600 mb-1">
                    Para VOCÊ procurar o que {chatOtherName} quer:
                  </p>
                  {buildFilters(chatOtherQuero, chatFilterLang).length === 0 ? (
                    <p className="text-[11px] text-slate-500">Sem itens configurados.</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {buildFilters(chatOtherQuero, chatFilterLang).map((f, i) => (
                        <div className="flex items-start gap-2" key={`otherf-${i}`}>
                          <input
                            readOnly
                            className="flex-1 text-xs border rounded p-2 bg-white"
                            value={f}
                          />
                          <button
                            onClick={() => navigator.clipboard?.writeText(f)}
                            className="h-8 px-3 text-xs bg-slate-800 text-white rounded"
                          >
                            Copiar
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Para o outro procurar o que você quer */}
                <div className="bg-slate-50 border rounded p-2">
                  <p className="text-xs text-slate-600 mb-1">
                    Para {chatOtherName} procurar o que VOCÊ quer:
                  </p>
                  {buildFilters(chatMyQuero, chatFilterLang).length === 0 ? (
                    <p className="text-[11px] text-slate-500">Sem itens configurados.</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {buildFilters(chatMyQuero, chatFilterLang).map((f, i) => (
                        <div className="flex items-start gap-2" key={`myf-${i}`}>
                          <input
                            readOnly
                            className="flex-1 text-xs border rounded p-2 bg-white"
                            value={f}
                          />
                          <button
                            onClick={() => navigator.clipboard?.writeText(f)}
                            className="h-8 px-3 text-xs bg-slate-800 text-white rounded"
                          >
                            Copiar
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Mensagens (scroll interno + ancoragem no fim) */}
            <div
              ref={chatScrollRef}
              className="mt-4 border rounded-lg p-3 bg-slate-50 h-64 md:h-72 overflow-y-auto scroll-smooth"
              role="log"
              aria-live="polite"
            >
              {chatMsgs.length === 0 ? (
                <p className="text-xs text-slate-500">Nenhuma mensagem ainda.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {chatMsgs.map((m) => {
                    const mine = m.from === user?.uid
                    const system = m.from === 'system'
                    return (
                      <div
                        key={m.id}
                        className={`max-w-[85%] px-3 py-2 rounded ${
                          system
                            ? 'self-center bg-yellow-100 text-slate-800 border'
                            : mine
                            ? 'self-end bg-blue-600 text-white'
                            : 'self-start bg-white border'
                        }`}
                      >
                        <p className="text-xs whitespace-pre-wrap">{m.text}</p>
                      </div>
                    )
                  })}
                  <div ref={chatEndRef} />
                </div>
              )}
            </div>

            {/* Barra de envio sticky no rodapé do modal */}
            <div className="mt-3 sticky bottom-0 pt-2 bg-white">
              <div className="flex flex-col md:flex-row md:items-center gap-2 border-t pt-3">
                <input
                  ref={chatInputRef}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') sendChatMessage()
                  }}
                  className="flex-1 border rounded px-3 py-2 text-sm"
                  placeholder="Escreva uma mensagem..."
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={sendChatMessage}
                    className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded"
                  >
                    Enviar
                  </button>
                  <button
                    onClick={finalizeMatch}
                    className="bg-red-600 hover:bg-red-700 text-white text-sm px-4 py-2 rounded"
                    title="Finaliza a troca, invalida o match e apaga o chat"
                  >
                    Finalizar troca
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
