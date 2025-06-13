// src/app/cadastro/equipe/page.tsx
import dynamic from 'next/dynamic'
import { Suspense } from 'react'

const PageContent = dynamic(() => import('./PageContent'), { ssr: false })

export default function Page() {
    return (
        <Suspense fallback={<div>Carregando...</div>}>
            <PageContent />
        </Suspense>
    )
}
