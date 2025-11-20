'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { auth, db } from '@/lib/firebase'
import { onAuthStateChanged, User } from 'firebase/auth'
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'

// Mesmo ponto padrão da página /pp
const DEFAULT_LAT = -22.941834
const DEFAULT_LNG = -43.057178

type Status =
  | 'authLoading'
  | 'idle'
  | 'needLogin'
  | 'gettingLocation'
  | 'checking'
  | 'success'
  | 'alreadyGranted'
  | 'tooFar'
  | 'invalidQr'
  | 'noGeo'
  | 'error'

type Coords = { lat: number; lng: number }

function toRad(v: number) {
  return (v * Math.PI) / 180
}

function distanceInKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371 // km
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)

  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)

  const h =
    sinDLat * sinDLat +
    sinDLng * sinDLng * Math.cos(lat1) * Math.cos(lat2)

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
  return R * c
}

export default function ScanClient() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const qrId = searchParams.get('qr') ?? ''

  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<Status>('authLoading')
  const [message, setMessage] = useState<string>('Verificando login...')

  const [playerCoords, setPlayerCoords] = useState<Coords | null>(null)
  const [adminCoords, setAdminCoords] = useState<Coords | null>(null)
  const [distanceKm, setDistanceKm] = useState<number | null>(null)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u)

      if (!qrId) {
        setStatus('invalidQr')
        setMessage('Link de QR Code inválido.')
        return
      }

      if (!u) {
        setStatus('needLogin')
        setMessage('Você precisa estar logado para receber o ponto de presença.')
      } else {
        // usuário logado e QR com parâmetro
        setStatus('idle')
        setMessage('Clique no botão abaixo para validar sua presença.')
      }
    })

    return () => unsub()
  }, [qrId])

  async function handleValidate() {
    if (!qrId) {
      setStatus('invalidQr')
      setMessage('Link de QR Code inválido.')
      return
    }

    if (!user) {
      setStatus('needLogin')
      setMessage('Você precisa estar logado para receber o ponto de presença.')
      return
    }

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('noGeo')
      setMessage('Seu navegador não suporta localização automática. Ative o GPS ou tente outro dispositivo.')
      return
    }

    setStatus('gettingLocation')
    setMessage('Obtendo sua localização...')

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        setPlayerCoords({ lat, lng })

        try {
          setStatus('checking')
          setMessage('Validando QR Code e distância...')

          // 1) Carrega o QR
          const qrRef = doc(db, 'pp_qr', qrId)
          const qrSnap = await getDoc(qrRef)

          if (!qrSnap.exists()) {
            setStatus('invalidQr')
            setMessage('Este QR Code não é válido.')
            return
          }

          const data = qrSnap.data() as any

          if (!data.active) {
            setStatus('invalidQr')
            setMessage('Este QR Code já foi encerrado. Peça ao organizador um QR Code novo.')
            return
          }

          const adminLat =
            typeof data.adminLat === 'number' ? data.adminLat : DEFAULT_LAT
          const adminLng =
            typeof data.adminLng === 'number' ? data.adminLng : DEFAULT_LNG

          setAdminCoords({ lat: adminLat, lng: adminLng })

          // 2) Confere distância (≤ 1 km)
          const dist = distanceInKm(lat, lng, adminLat, adminLng)
          setDistanceKm(dist)

          if (dist > 1) {
            setStatus('tooFar')
            setMessage(
              'Você está muito longe do ponto de encontro. Para ganhar o ponto, precisa estar a até 1 km do organizador.'
            )
            return
          }

          // 3) Confere se já ganhou ponto com este QR
          const logsQ = query(
            collection(db, 'pp_logs'),
            where('userId', '==', user.uid),
            where('qrId', '==', qrId)
          )
          const logsSnap = await getDocs(logsQ)

          if (!logsSnap.empty) {
            setStatus('alreadyGranted')
            setMessage('Você já recebeu ponto de presença com este QR Code.')
            return
          }

          // 4) Registra log e incrementa ponto
          await addDoc(collection(db, 'pp_logs'), {
            userId: user.uid,
            qrId,
            tipo: 'qr',
            playerLat: lat,
            playerLng: lng,
            adminLat,
            adminLng,
            createdAt: serverTimestamp(),
          })

          await updateDoc(doc(db, 'usuarios', user.uid), {
            pontosPresenca: increment(1),
          })

          setStatus('success')
          setMessage('Ponto de presença registrado com sucesso!')
        } catch (err) {
          console.error(err)
          setStatus('error')
          setMessage('Ocorreu um erro ao validar o QR Code. Tente novamente em instantes.')
        }
      },
      (err) => {
        console.error(err)
        if (err.code === 1) {
          setMessage('Permissão de localização negada. Ative a localização para validar o QR Code.')
        } else {
          setMessage('Não foi possível obter sua localização. Verifique o GPS e tente novamente.')
        }
        setStatus('error')
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }

  const validating = status === 'gettingLocation' || status === 'checking'
  const canValidate =
    !!qrId &&
    !!user &&
    !validating &&
    status !== 'success' &&
    status !== 'alreadyGranted' &&
    status !== 'invalidQr'

  const isErrorStatus: boolean =
    status === 'needLogin' ||
    status === 'noGeo' ||
    status === 'tooFar' ||
    status === 'invalidQr' ||
    status === 'error'

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-8 flex items-center justify-center">
      <div className="w-full max-w-md bg-white rounded-xl shadow-lg p-6 flex flex-col gap-4">
        <h1 className="text-xl font-bold text-slate-900">
          Registrar Ponto de Presença
        </h1>

        <p className="text-sm text-slate-600">
          Esta página é usada para validar o QR Code do evento e registrar seu ponto
          de presença. É necessário estar próximo do organizador (até 1 km) e com a
          localização ativada.
        </p>

        {qrId ? (
          <p className="text-[11px] text-slate-400 break-all">
            ID do QR: <span className="font-mono">{qrId}</span>
          </p>
        ) : (
          <p className="text-[11px] text-red-500">
            Nenhum ID de QR Code encontrado na URL.
          </p>
        )}

        {/* Mensagem de status */}
        <div
          className={`text-sm rounded px-3 py-2 ${
            status === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : isErrorStatus
              ? 'bg-red-50 text-red-700 border border-red-200'
              : 'bg-slate-50 text-slate-700 border border-slate-200'
          }`}
        >
          {message}
        </div>

        {/* Info de distância, se disponível */}
        {playerCoords && adminCoords && distanceKm !== null && (
          <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded px-3 py-2">
            <p>
              Sua posição:{" "}
              <span className="font-mono">
                {playerCoords.lat.toFixed(6)}, {playerCoords.lng.toFixed(6)}
              </span>
            </p>
            <p>
              Ponto de encontro:{" "}
              <span className="font-mono">
                {adminCoords.lat.toFixed(6)}, {adminCoords.lng.toFixed(6)}
              </span>
            </p>
            <p>
              Distância aproximada:{" "}
              <span className="font-mono">
                {distanceKm.toFixed(3)} km
              </span>
            </p>
          </div>
        )}

        {/* Botão principal */}
        <button
          type="button"
          onClick={handleValidate}
          disabled={!canValidate}
          className={`w-full inline-flex items-center justify-center px-4 py-2 rounded text-sm font-semibold ${
            canValidate
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'bg-slate-300 text-slate-600 cursor-not-allowed'
          }`}
        >
          {validating
            ? 'Validando...'
            : status === 'success'
            ? 'Ponto registrado'
            : 'Validar presença agora'}
        </button>

        {/* Ação de login, se necessário */}
        {status === 'needLogin' && (
          <button
            type="button"
            onClick={() => {
              const redir =
                typeof window !== 'undefined'
                  ? window.location.pathname + window.location.search
                  : '/pp/scan'
              router.push(`/login?redirect=${encodeURIComponent(redir)}`)
            }}
            className="w-full inline-flex items-center justify-center px-4 py-2 rounded text-sm font-semibold bg-slate-800 hover:bg-slate-900 text-white"
          >
            Ir para tela de login
          </button>
        )}
      </div>
    </div>
  )
}
