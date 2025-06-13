// src/app/cadastro/equipe/page.tsx
import { Suspense } from 'react'
import PageContent from './PageContent'

export default function Page() {
    return (
        <Suspense fallback={<div>Carregando...</div>}>
            <PageContent />
        </Suspense>
    )
}
