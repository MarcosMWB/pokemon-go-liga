'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { PokemonSelect } from '@/components/PokemonSelect'

export default function PageContent() {
    const searchParams = useSearchParams()
    const router = useRouter()
    const supabase = createClient()

    const [selectedPokemons, setSelectedPokemons] = useState<string[]>([])
    const [pokemonList, setPokemonList] = useState<{ name: string; id: number }[]>([])
    const [loading, setLoading] = useState(false)

    const userId = searchParams.get('user')
    const liga = searchParams.get('liga')

    useEffect(() => {
        if (!userId || !liga) router.push('/')
    }, [userId, liga, router])

    useEffect(() => {
        const fetchPokemonList = async () => {
            const res = await fetch('https://pokeapi.co/api/v2/pokemon?limit=1010')
            const data = await res.json()
            const formatted = data.results.map((p: { name: string }, i: number) => ({
                name: formatName(p.name),
                id: i + 1
            }))
            setPokemonList(formatted)
        }

        fetchPokemonList()
    }, [])

    const formatName = (name: string) =>
        name.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')

    const handleRemove = (name: string) => {
        setSelectedPokemons(prev => prev.filter(p => p !== name))
    }

    const handleSubmit = async () => {
        setLoading(true)

        const { error } = await supabase
            .from('participacoes')
            .insert({
                usuario_id: userId,
                liga_id: liga,
                pokemon: selectedPokemons.map((nome) => ({ nome }))
            })

        setLoading(false)

        if (!error) router.push(`/perfil/${userId}`)
    }

    return (
        <div className="min-h-screen bg-blue-50 py-10 px-4">
            <div className="max-w-2xl mx-auto bg-white p-6 rounded shadow">
                <h1 className="text-2xl font-bold mb-4 text-blue-800">Cadastrar Equipe</h1>

                <PokemonSelect
                    value={selectedPokemons}
                    onChange={setSelectedPokemons}
                    pokemonList={pokemonList}
                />

                {selectedPokemons.length > 0 && (
                    <div className="mt-4 space-y-2">
                        <p className="text-sm text-gray-700">Pokémon selecionados ({selectedPokemons.length}/6):</p>
                        <ul className="grid grid-cols-2 gap-2">
                            {selectedPokemons.map((p) => (
                                <li key={p} className="flex justify-between items-center bg-yellow-100 px-3 py-1 rounded">
                                    <span>{p}</span>
                                    <button
                                        onClick={() => handleRemove(p)}
                                        className="text-red-600 font-bold hover:underline"
                                    >
                                        Remover
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {selectedPokemons.length >= 6 && (
                    <p className="mt-2 text-sm text-red-500">Limite de 6 Pokémon atingido.</p>
                )}

                <button
                    onClick={handleSubmit}
                    disabled={loading || selectedPokemons.length === 0}
                    className="mt-6 w-full py-3 bg-yellow-600 hover:bg-yellow-700 text-white font-semibold rounded disabled:opacity-50"
                >
                    {loading ? 'Salvando...' : 'Salvar Equipe'}
                </button>
            </div>
        </div>
    )
}
