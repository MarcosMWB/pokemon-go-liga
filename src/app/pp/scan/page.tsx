import { Suspense } from 'react'
import ScanClient from './ScanClient'

export default function Page() {
  return (
    <Suspense fallback={<div className="p-4">Carregando página de presença...</div>}>
      <ScanClient />
    </Suspense>
  )
}
