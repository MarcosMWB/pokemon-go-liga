// app/pp/page.tsx
'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { auth, db } from '@/lib/firebase'
import { onAuthStateChanged, User } from 'firebase/auth'
import {
  addDoc,
  collection,
  doc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'

type Usuario = {
  id: string
  nome: string
  pontosPresenca?: number
}

// PONTO PADRÃO (Campo Grande / West Shopping)
const DEFAULT_LAT = -22.941834
const DEFAULT_LNG = -43.057178

export default function PontosPresencaPage() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [busca, setBusca] = useState('')
  const [loadingUsuarios, setLoadingUsuarios] = useState(false)

  const [currentQrId, setCurrentQrId] = useState<string | null>(null)
  const [loadingQr, setLoadingQr] = useState(false)
  const [origin, setOrigin] = useState('')

  // localização usada para o QR atual
  const [currentQrLoc, setCurrentQrLoc] = useState<{ lat: number; lng: number } | null>(null)

  // inputs de ponto de encontro
  const [adminLatInput, setAdminLatInput] = useState<string>('')
  const [adminLngInput, setAdminLngInput] = useState<string>('')
  const [locMsg, setLocMsg] = useState<string>('')

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin)
    }
  }, [])

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u)
      if (!u) {
        setLoading(false)
        return
      }

      await Promise.all([loadUsuarios(), loadCurrentQr()])
      setLoading(false)
    })

    return () => unsub()
  }, [])

  async function loadUsuarios() {
    setLoadingUsuarios(true)
    const snap = await getDocs(collection(db, 'usuarios'))

    const list: Usuario[] = snap.docs.map((d) => {
      const data = d.data() as any
      return {
        id: d.id,
        nome: data.nome || data.friend_code || 'Treinador',
        pontosPresenca: data.pontosPresenca || 0,
      }
    })

    list.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    setUsuarios(list)
    setLoadingUsuarios(false)
  }

  async function loadCurrentQr() {
    setLoadingQr(true)
    const q = query(collection(db, 'pp_qr'), where('active', '==', true))
    const snap = await getDocs(q)

    if (!snap.empty) {
      const first = snap.docs[0]
      const data = first.data() as any
      const lat = typeof data.adminLat === 'number' ? data.adminLat : DEFAULT_LAT
      const lng = typeof data.adminLng === 'number' ? data.adminLng : DEFAULT_LNG

      setCurrentQrId(first.id)
      setCurrentQrLoc({ lat, lng })

      // Preenche inputs com a última localização usada
      setAdminLatInput(String(lat))
      setAdminLngInput(String(lng))
    } else {
      setCurrentQrId(null)
      setCurrentQrLoc(null)
      setAdminLatInput('')
      setAdminLngInput('')
    }

    setLoadingQr(false)
  }

  function parseCoordOrDefault(value: string, fallback: number): number {
    const n = parseFloat(value.replace(',', '.'))
    return Number.isFinite(n) ? n : fallback
  }

  function handleUseMyLocation() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocMsg('Seu navegador não suporta localização automática.')
      return
    }

    setLocMsg('Obtendo sua localização...')

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setAdminLatInput(String(pos.coords.latitude))
        setAdminLngInput(String(pos.coords.longitude))
        setLocMsg('Localização preenchida com sucesso.')
      },
      (err) => {
        console.error(err)
        setLocMsg('Não foi possível obter a localização: verifique permissões de localização.')
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }

  async function handleGenerateNewQr() {
    setLoadingQr(true)

    // 1) invalida qualquer QR ativo anterior
    const q = query(collection(db, 'pp_qr'), where('active', '==', true))
    const snap = await getDocs(q)
    await Promise.all(
      snap.docs.map((d) =>
        updateDoc(d.ref, {
          active: false,
          invalidatedAt: serverTimestamp(),
        })
      )
    )

    // 2) calcula localização para este QR (inputs ou padrão)
    const lat = parseCoordOrDefault(adminLatInput, DEFAULT_LAT)
    const lng = parseCoordOrDefault(adminLngInput, DEFAULT_LNG)

    // 3) cria novo QR com adminLat/adminLng
    const newRef = await addDoc(collection(db, 'pp_qr'), {
      active: true,
      createdAt: serverTimestamp(),
      adminLat: lat,
      adminLng: lng,
    })

    setCurrentQrId(newRef.id)
    setCurrentQrLoc({ lat, lng })
    setLoadingQr(false)
  }

  async function handleGrantPoint(usuario: Usuario) {
    if (!user) return

    const ok = window.confirm(`Dar 1 ponto de presença para ${usuario.nome}?`)
    if (!ok) return

    const userRef = doc(db, 'usuarios', usuario.id)
    await updateDoc(userRef, {
      pontosPresenca: increment(1),
    })

    await addDoc(collection(db, 'pp_logs'), {
      userId: usuario.id,
      adminId: user.uid,
      tipo: 'manual',
      createdAt: serverTimestamp(),
    })

    await loadUsuarios()
  }

  if (loading) {
    return <div className="p-6">Carregando...</div>
  }

  const qrUrl =
    currentQrId && origin ? `${origin}/pp/scan?qr=${encodeURIComponent(currentQrId)}`
    : ''

  const qrImg =
    qrUrl !== ''
      ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(
          qrUrl
        )}`
      : ''

  const filtrados = usuarios.filter((u) =>
    u.nome.toLowerCase().includes(busca.toLowerCase())
  )

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-8 flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-slate-900">Pontos de Presença (PP)</h1>

      {/* Bloco do QRCode + ponto de encontro */}
      <div className="bg-white rounded-lg shadow p-4 flex flex-col md:flex-row gap-4">
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-slate-900 mb-2">QR Code do evento</h2>
          <p className="text-sm text-slate-600 mb-2">
            Mostre este QR Code para os jogadores escanearem. Cada jogador ganha{' '}
            <strong>no máximo 1 ponto</strong> por QR. Ao gerar um novo QR, o anterior
            fica automaticamente inválido.
          </p>

          {/* Ponto de encontro */}
          <div className="mt-2 mb-3">
            <p className="text-sm font-semibold text-slate-800 mb-1">Ponto de encontro</p>
            <p className="text-xs text-slate-500 mb-2">
              Se você não preencher, será usado o ponto padrão
              (Lat: {DEFAULT_LAT}, Lng: {DEFAULT_LNG}).
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
              <input
                type="text"
                value={adminLatInput}
                onChange={(e) => setAdminLatInput(e.target.value)}
                placeholder={String(DEFAULT_LAT)}
                className="border rounded px-2 py-1 text-sm"
              />
              <input
                type="text"
                value={adminLngInput}
                onChange={(e) => setAdminLngInput(e.target.value)}
                placeholder={String(DEFAULT_LNG)}
                className="border rounded px-2 py-1 text-sm"
              />
            </div>

            <button
              type="button"
              onClick={handleUseMyLocation}
              className="text-xs px-3 py-1 rounded bg-slate-800 text-white hover:bg-slate-900"
            >
              Usar minha localização atual
            </button>

            {locMsg && (
              <p className="text-[11px] text-slate-500 mt-1">
                {locMsg}
              </p>
            )}

            {currentQrLoc && (
              <p className="text-[11px] text-slate-500 mt-1">
                Local salvo no QR atual:&nbsp;
                <span className="font-mono">
                  {currentQrLoc.lat.toFixed(6)}, {currentQrLoc.lng.toFixed(6)}
                </span>
              </p>
            )}
          </div>

          <button
            onClick={handleGenerateNewQr}
            disabled={loadingQr}
            className="inline-flex items-center justify-center px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-semibold"
          >
            {loadingQr ? 'Gerando...' : currentQrId ? 'Gerar novo QR Code' : 'Criar QR Code'}
          </button>

          {qrUrl && (
            <div className="mt-3 text-xs text-slate-500 break-all">
              URL de leitura: <span className="font-mono">{qrUrl}</span>
            </div>
          )}
        </div>

        <div className="w-full md:w-auto flex items-center justify-center">
          {qrImg ? (
            <Image
              src={qrImg}
              alt="QR Code de pontos de presença"
              width={240}
              height={240}
              className="border rounded bg-white"
            />
          ) : (
            <div className="w-60 h-60 border-dashed border-2 border-slate-300 rounded flex items-center justify-center text-sm text-slate-500 text-center p-4">
              Nenhum QR Code ativo. Clique em &quot;Criar QR Code&quot;.
            </div>
          )}
        </div>
      </div>

      {/* Bloco de busca e aplicação manual de pontos */}
      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-semibold text-slate-900 mb-3">Aplicar ponto manualmente</h2>
        <p className="text-xs text-slate-500 mb-3">
          Use quando o jogador participou do evento (check-in no Campfire, presença em raid,
          etc.) e você quer dar 1 PP manualmente.
        </p>

        <input
          type="text"
          placeholder="Buscar treinador..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="mb-4 w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
        />

        {loadingUsuarios ? (
          <p className="text-sm text-slate-500">Carregando lista de jogadores...</p>
        ) : filtrados.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum jogador encontrado.</p>
        ) : (
          <ul className="space-y-2 max-h-[420px] overflow-y-auto">
            {filtrados.map((u) => (
              <li
                key={u.id}
                className="flex items-center justify-between border rounded px-3 py-2 bg-slate-50"
              >
                <div>
                  <p className="text-sm font-medium text-slate-800">{u.nome}</p>
                  <p className="text-xs text-slate-500">
                    Pontos de presença: <strong>{u.pontosPresenca ?? 0}</strong>
                  </p>
                </div>
                <button
                  onClick={() => handleGrantPoint(u)}
                  className="text-xs px-3 py-1 rounded bg-green-600 hover:bg-green-700 text-white"
                >
                  +1 ponto
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
