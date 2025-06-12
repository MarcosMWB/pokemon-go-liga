'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { PokemonSelect } from '@/components/PokemonSelect'
import { createClient } from '@/utils/supabase/client'

type FormData = {
    friendCode: string
    nome: string
    liga: 'Great' | 'Master'
    pokemon: string[]
}

export default function CadastroPage() {
    const router = useRouter()
    const [formData, setFormData] = useState<FormData>({
        friendCode: '',
        nome: '',
        liga: 'Great',
        pokemon: ['', '', '', '', '', '']
    })
    const [pokemonList, setPokemonList] = useState<{ name: string, id: number }[]>([])
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [message, setMessage] = useState({ text: '', type: '' })

    useEffect(() => {
        const fetchPokemon = async () => {
            try {
                const response = await fetch('https://pokeapi.co/api/v2/pokemon?limit=1010')
                const data = await response.json()
                const formattedList = data.results.map((p: { name: string }, index: number) => ({
                    name: formatPokemonName(p.name),
                    id: index + 1
                }))
                setPokemonList(formattedList)
            } catch (error) {
                console.error('Erro ao carregar Pokémon:', error)
            }
        }

        fetchPokemon()
    }, [])

    const formatPokemonName = (name: string) => {
        return name.split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ')
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsSubmitting(true)
        setMessage({ text: '', type: '' })

        if (!formData.friendCode.match(/^\d{4}\s?\d{4}\s?\d{4}$/)) {
            setMessage({ text: 'Friend Code inválido (formato: 1234 5678 9012)', type: 'error' })
            setIsSubmitting(false)
            return
        }

        if (formData.pokemon.some(p => !p)) {
            setMessage({ text: 'Selecione todos os 6 Pokémon', type: 'error' })
            setIsSubmitting(false)
            return
        }

        const supabase = createClient()

        try {
            const { error: userError } = await supabase.from('usuarios').insert({
                id: formData.friendCode.replace(/\s/g, ''),
                nome: formData.nome,
                liga: formData.liga
            })

            if (userError) throw userError

            const { error: teamError } = await supabase.from('equipes').insert({
                usuario_id: formData.friendCode,
                pokemon1: formData.pokemon[0],
                pokemon2: formData.pokemon[1],
                pokemon3: formData.pokemon[2],
                pokemon4: formData.pokemon[3],
                pokemon5: formData.pokemon[4],
                pokemon6: formData.pokemon[5],
            })

            if (teamError) throw teamError

            setMessage({
                text: 'Cadastro realizado com sucesso! Redirecionando...',
                type: 'success'
            })

            setTimeout(() => router.push('/'), 2000)
        } catch (error) {
            const err = error as Error
            setMessage({
                text: err.message.includes('duplicate key')
                    ? 'Este Friend Code já está cadastrado'
                    : `Erro: ${err.message}`,
                type: 'error'
            })
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="min-h-screen bg-gradient-to-b from-blue-50 to-blue-100 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-md mx-auto bg-white rounded-xl shadow-md overflow-hidden md:max-w-2xl">
                <div className="bg-yellow-500 p-4">
                    <h1 className="text-2xl font-bold text-center text-white">
                        Cadastro de Treinador
                    </h1>
                    <p className="text-yellow-100 text-center text-sm mt-1">
                        Região Oceânica de Niterói
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="p-8 space-y-6">
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-700">
                            Friend Code
                        </label>
                        <input
                            type="text"
                            placeholder="1234 5678 9012"
                            value={formData.friendCode}
                            onChange={(e) => setFormData({
                                ...formData,
                                friendCode: e.target.value.replace(/[^\d\s]/g, '')
                            })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
                            maxLength={14}
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-700">
                            Nome do Treinador
                        </label>
                        <input
                            type="text"
                            placeholder="Ash Ketchum"
                            value={formData.nome}
                            onChange={(e) => setFormData({
                                ...formData,
                                nome: e.target.value
                            })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-700">
                            Liga
                        </label>
                        <select
                            value={formData.liga}
                            onChange={(e) => setFormData({
                                ...formData,
                                liga: e.target.value as 'Great' | 'Master'
                            })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
                        >
                            <option value="Great">Great League (até 1500 CP)</option>
                            <option value="Master">Master League (sem limite de CP)</option>
                        </select>
                    </div>

                    <div className="space-y-4">
                        <h3 className="text-lg font-medium text-gray-900">
                            Seu Time Pokémon
                        </h3>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            {formData.pokemon.map((pkm, idx) => (
                                <div key={idx} className="space-y-1">
                                    <label className="block text-sm font-medium text-gray-700">
                                        Pokémon {idx + 1}
                                    </label>
                                    <PokemonSelect
                                        value={pkm}
                                        onChange={(value) => {
                                            const newTeam = [...formData.pokemon]
                                            newTeam[idx] = value
                                            setFormData({ ...formData, pokemon: newTeam })
                                        }}
                                        pokemonList={pokemonList}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>

                    <div>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className={`w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-yellow-600 hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500 ${isSubmitting ? 'opacity-70 cursor-not-allowed' : ''
                                }`}
                        >
                            {isSubmitting ? (
                                <>
                                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Cadastrando...
                                </>
                            ) : 'Cadastrar'}
                        </button>
                    </div>

                    {message.text && (
                        <div className={`rounded-md p-4 ${message.type === 'error'
                                ? 'bg-red-50 text-red-800'
                                : 'bg-green-50 text-green-800'
                            }`}>
                            <p className="text-sm">{message.text}</p>
                        </div>
                    )}
                </form>
            </div>
        </div>
    )
}