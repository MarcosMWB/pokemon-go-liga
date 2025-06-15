import Link from 'next/link'
import { useState } from 'react'
import { createServerSideClient } from '@/utils/supabase/server'
import { FiltroUsuarios } from './FiltroUsuarios'

export default async function JogadoresPage() {
    const supabase = await createServerSideClient()

    const { data: usuarios } = await supabase
        .from('usuarios')
        .select('id, nome')
        .order('nome', { ascending: true })

    return (
        <div className="p-6 max-w-2xl mx-auto">
            <h1 className="text-2xl font-bold mb-4">Todos os Jogadores</h1>
            {usuarios && <FiltroUsuarios usuarios={usuarios} />}
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
