'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { PokemonSelect } from '@/components/PokemonSelect'

export default function CadastroEquipePage() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const ligaParam = searchParams.get('liga') as 'Great' | 'Master' | null
    const userId = searchParams.get('user')
    const [liga, setLiga] = useState<'Great' | 'Master'>(ligaParam || 'Great')
    const [pokemonList, setPokemonList] = useState<{ name: string, id: number }[]>([])
    const [team, setTeam] = useState(['', '', '', '', '', ''])
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [message, setMessage] = useState({ text: '', type: '' })

    useEffect(() => {
        const fetchPokemon = async () => {
            const res = await fetch('https://pokeapi.co/api/v2/pokemon?limit=1010')
            const data = await res.json()
            const list = data.results.map((p: { name: string }, index: number) => ({
                name: formatName(p.name),
                id: index + 1
            }))
            setPokemonList(list)
        }
        fetchPokemon()
    }, [])

    const formatName = (name: string) =>
        name.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')

    useEffect(() => {
        const verificarDuplicado = async () => {
            if (!userId || !ligaParam) return

            const supabase = createClient()
            const { data } = await supabase
                .from('participacoes')
                .select('id')
                .eq('usuario_id', userId)
                .eq('ligas.nome', ligaParam)
                .maybeSingle()

            if (data) {
                alert(`Você já cadastrou equipe na liga ${ligaParam}.`)
                router.push(`/perfil/${userId}`)
            }
        }
        verificarDuplicado()
    }, [userId, ligaParam])


    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsSubmitting(true)
        setMessage({ text: '', type: '' })

        if (!userId) {
            setMessage({ text: 'Usuário não identificado.', type: 'error' })
            setIsSubmitting(false)
            return
        }

        if (team.some(p => !p)) {
            setMessage({ text: 'Preencha todos os 6 Pokémon.', type: 'error' })
            setIsSubmitting(false)
            return
        }

        const supabase = createClient()

        try {
            const { data: ligaRow } = await supabase
                .from('ligas')
                .select('id')
                .eq('nome', liga)
                .single()

            const { data: temporada } = await supabase
                .from('temporadas')
                .select('id')
                .eq('ativa', true)
                .single()

            if (!ligaRow || !temporada) throw new Error('Liga ou temporada não encontrada.')

            const { data: participacao, error: pErr } = await supabase
                .from('participacoes')
                .insert({
                    usuario_id: userId,
                    liga_id: ligaRow.id,
                    temporada_id: temporada.id,
                    equipe_registrada: true
                })
                .select('id')
                .single()

            if (pErr) throw pErr

            const pokemonToInsert = team.map(name => ({
                participacao_id: participacao.id,
                nome: name
            }))

            const { error: pokeErr } = await supabase
                .from('pokemon')
                .insert(pokemonToInsert)

            if (pokeErr) throw pokeErr

            setMessage({ text: 'Equipe cadastrada com sucesso!', type: 'success' })
            setTimeout(() => router.push('/'), 2000)
        } catch (error) {
            const err = error as Error
            setMessage({ text: `Erro: ${err.message}`, type: 'error' })
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="min-h-screen bg-blue-50 py-10 px-4">
            <div className="max-w-2xl mx-auto bg-white p-8 rounded shadow">
                <h1 className="text-xl font-bold text-center text-gray-800 mb-4">Cadastro de Equipe</h1>

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Liga</label>
                        <select
                            value={liga}
                            disabled
                            className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md bg-gray-100 cursor-not-allowed"
                        >
                            <option value="Great">Great League</option>
                            <option value="Master">Master League</option>
                        </select>

                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {team.map((pkm, idx) => (
                            <div key={idx}>
                                <label className="text-sm text-gray-600">Pokémon {idx + 1}</label>
                                <PokemonSelect
                                    value={pkm}
                                    onChange={(value) => {
                                        const newTeam = [...team]
                                        newTeam[idx] = value
                                        setTeam(newTeam)
                                    }}
                                    pokemonList={pokemonList}
                                />
                            </div>
                        ))}
                    </div>

                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full py-3 bg-yellow-600 hover:bg-yellow-700 text-white font-semibold rounded-md"
                    >
                        {isSubmitting ? 'Salvando...' : 'Cadastrar Equipe'}
                    </button>

                    {message.text && (
                        <div className={`mt-4 text-sm rounded-md p-3 ${message.type === 'error'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-green-100 text-green-800'
                            }`}>
                            {message.text}
                        </div>
                    )}
                </form>
            </div>
        </div>
    )
}
