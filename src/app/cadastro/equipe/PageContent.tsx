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
    const [savedPokemons, setSavedPokemons] = useState<string[]>([])
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

            const extraForms = [
                'Raichu (Alola)',
                'Meowth (Alola)',
                'Meowth (Galar)',
                'Zigzagoon (Galar)',
                'Articuno (Galar)',
                'Zapdos (Galar)',
                'Moltres (Galar)',
                'Growlithe (Hisui)',
                'Voltorb (Hisui)',
                'Typhlosion (Hisui)',
                'Zorua (Hisui)',
                'Zoroark (Hisui)',
                'Braviary (Hisui)',
                'Lilligant (Hisui)',
                'Goodra (Hisui)',
                'Avalugg (Hisui)',
                'Sneasel (Hisui)',
                'Samurott (Hisui)',
                'Decidueye (Hisui)',
                'Wooper (Paldea)',
                'Tauros (Paldea Combat)',
                'Tauros (Paldea Blaze)',
                'Tauros (Paldea Aqua)',
                'Zacian (Hero)',
                'Zacian (Crowned)',
                'Zamazenta (Hero)',
                'Zamazenta (Crowned)',
                'Basculegion (Male)',
                'Basculegion (Female)'
            ].map((name, i) => ({
                name,
                id: 10000 + i
            }))

            setPokemonList([...formatted, ...extraForms])
        }

        fetchPokemonList()
    }, [])


    useEffect(() => {
        const fetchParticipacaoExistente = async () => {
            if (!userId || !liga) return

            const { data: temporada } = await supabase
                .from('temporadas')
                .select('id')
                .eq('ativa', true)
                .single()

            const { data: ligaData } = await supabase
                .from('ligas')
                .select('id')
                .eq('nome', liga)
                .single()

            const { data: participacao } = await supabase
                .from('participacoes')
                .select('id')
                .eq('usuario_id', userId)
                .eq('liga_id', ligaData?.id)
                .eq('temporada_id', temporada?.id)
                .single()

            if (participacao) {
                const { data: pokemons } = await supabase
                    .from('pokemon')
                    .select('nome')
                    .eq('participacao_id', participacao.id)

                const nomes = pokemons?.map(p => p.nome) ?? []
                setSelectedPokemons(nomes)
                setSavedPokemons(nomes)
            }
        }

        fetchParticipacaoExistente()
    }, [userId, liga])

    const formatName = (name: string) =>
        name.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')

    const handleRemove = (name: string) => {
        if (savedPokemons.includes(name)) return // bloqueia remoção dos salvos
        setSelectedPokemons(prev => prev.filter(p => p !== name))
    }

    const handleSubmit = async () => {
        setLoading(true)

        const { data: temporada, error: temporadaError } = await supabase
            .from('temporadas')
            .select('id')
            .eq('ativa', true)
            .single()

        if (temporadaError || !temporada) {
            console.error('Erro ao buscar temporada ativa:', temporadaError)
            setLoading(false)
            return
        }

        const { data: ligaData, error: ligaError } = await supabase
            .from('ligas')
            .select('id')
            .eq('nome', liga)
            .single()

        if (ligaError || !ligaData) {
            console.error('liga_id inválido:', liga)
            setLoading(false)
            return
        }

        const { data: participacaoExistente } = await supabase
            .from('participacoes')
            .select('id')
            .eq('usuario_id', userId)
            .eq('liga_id', ligaData.id)
            .eq('temporada_id', temporada.id)
            .single()

        let participacaoId = participacaoExistente?.id

        if (!participacaoExistente) {
            const { data: nova, error } = await supabase
                .from('participacoes')
                .insert({
                    usuario_id: userId,
                    liga_id: ligaData.id,
                    temporada_id: temporada.id,
                    equipe_registrada: true
                })
                .select('id')
                .single()

            if (error || !nova) {
                console.error('Erro ao criar participação:', error)
                setLoading(false)
                return
            }

            participacaoId = nova.id
        }

        const novos = selectedPokemons.filter(p => !savedPokemons.includes(p))

        if (selectedPokemons.length > 6) {
            alert('Limite de 6 Pokémon atingido.')
            setLoading(false)
            return
        }

        if (novos.length === 0) {
            setLoading(false)
            return
        }

        const { error: pokemonError } = await supabase
            .from('pokemon')
            .insert(novos.map(nome => ({ nome, participacao_id: participacaoId })))

        if (pokemonError) {
            console.error('Erro ao inserir Pokémon:', pokemonError)
            setLoading(false)
            return
        }

        setSavedPokemons([...savedPokemons, ...novos])
        setLoading(false)
    }

    return (
        <div className="min-h-screen bg-blue-50 py-10 px-4">
            <div className="max-w-2xl mx-auto bg-white p-6 rounded shadow">
                <h1 className="text-2xl font-bold mb-4 text-blue-800">
                    {savedPokemons.length > 0 ? 'Editar Equipe' : 'Cadastrar Equipe'}
                </h1>

                <PokemonSelect
                    value={selectedPokemons}
                    onChange={setSelectedPokemons}
                    pokemonList={pokemonList}
                />

                {selectedPokemons.length > 0 && (
                    <div className="mt-4 space-y-2">
                        <p className="text-sm text-gray-700">
                            Pokémon selecionados ({selectedPokemons.length}/6):
                        </p>
                        <ul className="grid grid-cols-2 gap-2">
                            {selectedPokemons.map((p) => (
                                <li
                                    key={p}
                                    className="flex justify-between items-center bg-yellow-100 px-3 py-1 rounded"
                                >
                                    <span>{p}</span>
                                    {!savedPokemons.includes(p) && (
                                        <button
                                            onClick={() => handleRemove(p)}
                                            className="text-red-600 font-bold hover:underline"
                                        >
                                            Remover
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {selectedPokemons.length >= 6 && (
                    <p className="mt-2 text-sm text-red-500">
                        Limite de 6 Pokémon atingido.
                    </p>
                )}

                <button
                    onClick={handleSubmit}
                    disabled={loading || selectedPokemons.length === 0 || selectedPokemons.length > 6}
                    className="mt-6 w-full py-3 bg-yellow-600 hover:bg-yellow-700 text-white font-semibold rounded disabled:opacity-50"
                >
                    {loading ? 'Salvando...' : savedPokemons.length > 0 ? 'Salvar Edição' : 'Salvar Equipe'}
                </button>

                <button
                    onClick={() => router.push(`/perfil/${userId}`)}
                    className="mt-4 w-full py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold rounded"
                >
                    Voltar
                </button>
            </div>
        </div>
    )
}
