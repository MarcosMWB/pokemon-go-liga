'use client'

import { useState } from 'react'
import Link from 'next/link'

export function FiltroUsuarios({ usuarios }: { usuarios: { id: string; nome: string }[] }) {
    const [busca, setBusca] = useState('')

    const filtrados = usuarios.filter(u =>
        u.nome.toLowerCase().includes(busca.toLowerCase())
    )

    return (
        <div>
            <input
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar jogador..."
                className="mb-4 p-2 border border-gray-300 rounded w-full"
            />
            <ul className="space-y-1">
                {filtrados.map((u) => (
                    <li key={u.id}>
                        <Link href={`/perfil/${u.id}`} className="text-blue-600 hover:underline">
                            {u.nome}
                        </Link>
                    </li>
                ))}
            </ul>
        </div>
    )
}
