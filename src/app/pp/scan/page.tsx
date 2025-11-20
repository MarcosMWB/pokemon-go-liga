// app/pp/scan/page.tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { auth, db } from '@/lib/firebase'
import { onAuthStateChanged, User } from 'firebase/auth'
import {
  doc,
  getDoc,
  increment,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore'

type Status =
  | 'loading'
  | 'noQr'
  | 'needLogin'
  | 'invalid'
  | 'already'
  | 'ok'
  | 'error'
  | 'geoError'

// Mesmos valores padrão da página do admin
const DEFAULT_LAT = -22.941834
const DEFAULT_LNG = -43.057178

function toRad(deg: number) {
  return (deg * Math.PI) / 180
}

function distanceInKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371 // km
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function getUserPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocalização não suportada neste dispositivo.'))
      return
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      },
      (err) => {
        reject(err)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  })
}

export default function PpScanPage() {
  const searchParams = useSearchParams()
  const qrId = searchParams.get('qr') || null

  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [status, setStatus] = useState<Status>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u)
      setAuthReady(true)
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    if (!qrId) {
      setStatus('noQr')
      setMessage('QR Code inválido.')
      return
    }

    if (!authReady) return

    if (!user) {
      setStatus('needLogin')
      setMessage('Você precisa estar logado para ganhar o ponto de presença.')
      return
    }

    claimPoint(qrId, user)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrId, authReady, user])

  async function claimPoint(qrId: string, user: User) {
    try {
      setStatus('loading')
      setMessage('Validando QR Code...')

      const qrRef = doc(db, 'pp_qr', qrId)
      const qrSnap = await getDoc(qrRef)

      if (!qrSnap.exists()) {
        setStatus('invalid')
        setMessage('Este QR Code não existe ou já foi removido.')
        return
      }

      const qrData = qrSnap.data() as any
      if (!qrData.active) {
        setStatus('invalid')
        setMessage('Este QR Code não é mais válido.')
        return
      }

      // Coordenadas do ponto de encontro (do admin ou padrão)
      const adminLat = typeof qrData.adminLat === 'number' ? qrData.adminLat : DEFAULT_LAT
      const adminLng = typeof qrData.adminLng === 'number' ? qrData.adminLng : DEFAULT_LNG

      // Pega localização do jogador
      setMessage('Obtendo sua localização, permita o acesso à localização...')
      let userLat = 0
      let userLng = 0

      try {
        const pos = await getUserPosition()
        userLat = pos.lat
        userLng = pos.lng
      } catch (err) {
        console.error(err)
        setStatus('geoError')
        setMessage(
          'Não foi possível obter sua localização. Ative o GPS/permissão de localização e tente novamente.'
        )
        return
      }

      // Calcula distância
      const distKm = distanceInKm(adminLat, adminLng, userLat, userLng)

      if (distKm > 1) {
        setStatus('invalid')
        setMessage(
          `Você está muito longe do ponto de presença. Distância aproximada: ${distKm.toFixed(
            2
          )} km (máximo permitido: 1,00 km).`
        )
        return
      }

      // Dentro do raio: tenta registrar o ponto
      let already = false

      await runTransaction(db, async (tx) => {
        const claimRef = doc(db, 'pp_claims', `${qrId}_${user.uid}`)
        const claimSnap = await tx.get(claimRef)

        if (claimSnap.exists()) {
          already = true
          return
        }

        const userRef = doc(db, 'usuarios', user.uid)

        tx.update(userRef, {
          pontosPresenca: increment(1),
        })

        tx.set(claimRef, {
          userId: user.uid,
          qrId,
          createdAt: serverTimestamp(),
          tipo: 'qr',
          distanceKm: distKm,
          adminLat,
          adminLng,
          userLat,
          userLng,
        })
      })

      if (already) {
        setStatus('already')
        setMessage('Você já ganhou ponto com este QR Code.')
      } else {
        setStatus('ok')
        setMessage('Ponto de presença registrado com sucesso!')
      }
    } catch (err) {
      console.error(err)
      setStatus('error')
      setMessage('Ocorreu um erro ao registrar seu ponto. Tente novamente.')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <div className="bg-white rounded-lg shadow p-6 max-w-md w-full text-center">
        <h1 className="text-xl font-semibold mb-3 text-slate-900">
          Ponto de Presença
        </h1>

        {status === 'loading' && (
          <p className="text-sm text-slate-600">{message || 'Carregando...'}</p>
        )}

        {status !== 'loading' && (
          <p className="text-sm text-slate-700 mb-4">{message}</p>
        )}

        {status === 'needLogin' && (
          <Link
            href="/login"
            className="inline-block text-sm text-blue-600 hover:underline"
          >
            Fazer login para registrar ponto
          </Link>
        )}

        {(status === 'ok' || status === 'already') && (
          <p className="text-xs text-slate-500">
            Você pode fechar esta página e voltar ao evento.
          </p>
        )}

        {status === 'invalid' && (
          <p className="text-xs text-slate-500">
            Peça ao organizador um QR Code atualizado e fique próximo ao ponto de encontro.
          </p>
        )}

        {status === 'geoError' && (
          <p className="text-xs text-slate-500">
            Ative a localização do aparelho e libere o acesso à localização para o navegador.
          </p>
        )}

        {status === 'noQr' && (
          <p className="text-xs text-slate-500">
            Link de QR inválido. Peça ao organizador para escanear novamente.
          </p>
        )}
      </div>
    </div>
  )
}
