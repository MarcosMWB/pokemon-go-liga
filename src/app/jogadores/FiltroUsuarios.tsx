'use client'

import { useState } from 'react'
import Link from 'next/link'

export function FiltroUsuarios({ usuarios }: { usuarios: { id: string, nome: string }[] }) {
    const [busca, setBusca] = useState('')

    const filtrados = usuarios.filter(u =>
        u.nome.toLowerCase().includes(busca.toLowerCase())
    )

    return (
        <div>
            <input
                type="text"
                placeholder="Buscar treinador..."
                value={busca}
                onChange={e => setBusca(e.target.value)}
                className="mb-4 w-full px-3 py-2 border border-gray-300 rounded-md"
            />

            <ul className="space-y-2">
                {filtrados.map(u => (
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
