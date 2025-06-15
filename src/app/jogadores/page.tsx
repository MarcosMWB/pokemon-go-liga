import Link from 'next/link'
import { createServerSideClient } from '@/utils/supabase/server'
import { FiltroUsuarios } from './FiltroUsuarios'
import { useState } from 'react'

export default async function JogadoresPage() {
    const supabase = await createServerSideClient()
    const { data: usuarios } = await supabase.from('usuarios').select('id, nome')

    return (
        <div className="p-4 max-w-2xl mx-auto">
            <h1 className="text-2xl font-bold mb-4">Jogadores</h1>
            <FiltroUsuarios usuarios={usuarios || []} />
        </div>
    )
}


export const dynamic = 'force-dynamic'

export function FiltroUsuarios({ usuarios }: { usuarios: { id: string; nome: string }[] }) {
    const [busca, setBusca] = useState('')

    const filtrados = usuarios.filter(u => u.nome.toLowerCase().includes(busca.toLowerCase()))

    return (
        <>
            <input
                type="text"
                value={busca}
                onChange={e => setBusca(e.target.value)}
                placeholder="Buscar jogador"
                className="mb-4 w-full px-3 py-2 border rounded"
            />
            <ul className="space-y-2">
                {filtrados.map(u => (
                    <li key={u.id}>
                        <a href={`/perfil/${u.id}`} className="text-blue-700 hover:underline">
                            {u.nome}
                        </a>
                    </li>
                ))}
            </ul>
        </>
    )
}
