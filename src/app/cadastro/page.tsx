// src/app/cadastro/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function CadastroPage() {
    const [nome, setNome] = useState('')
    const [friendCode, setFriendCode] = useState('')
    const [liga, setLiga] = useState('Great')
    const [pokemons, setPokemons] = useState<string[]>(['', '', '', '', '', ''])
    const [pokemonList, setPokemonList] = useState<string[]>([])
    const [mensagem, setMensagem] = useState('')

    // Lista dos 1010 Pokémon (nome simplificado para demonstração)
    useEffect(() => {
        fetch('https://pokeapi.co/api/v2/pokemon?limit=1010')
            .then(res => res.json())
            .then(data => {
                const nomes = data.results.map((p: any) => capitalize(p.name))
                setPokemonList(nomes)
            })
    }, [])

    const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!friendCode || !nome || pokemons.includes('')) {
            setMensagem('Preencha todos os campos!')
            return
        }

        const { error: userError } = await supabase.from('usuarios').insert({
            id: friendCode,
            nome,
            liga
        })

        if (userError) {
            setMensagem('Erro ao cadastrar usuário: ' + userError.message)
            return
        }

        const { error: teamError } = await supabase.from('equipes').insert({
            usuario_id: friendCode,
            pokemon1: pokemons[0],
            pokemon2: pokemons[1],
            pokemon3: pokemons[2],
            pokemon4: pokemons[3],
            pokemon5: pokemons[4],
            pokemon6: pokemons[5],
        })

        if (teamError) {
            setMensagem('Usuário criado, mas erro ao salvar equipe: ' + teamError.message)
            return
        }

        setMensagem('Cadastro realizado com sucesso!')
        setNome('')
        setFriendCode('')
        setPokemons(['', '', '', '', '', ''])
    }

    return (
        <main className="p-6 max-w-xl mx-auto">
            <h1 className="text-3xl font-bold mb-4">Cadastro de Jogador</h1>
            <form onSubmit={handleSubmit} className="space-y-4">
                <input
                    type="text"
                    placeholder="Friend Code"
                    value={friendCode}
                    onChange={(e) => setFriendCode(e.target.value)}
                    className="w-full p-2 border rounded"
                />
                <input
                    type="text"
                    placeholder="Nome"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    className="w-full p-2 border rounded"
                />
                <select
                    value={liga}
                    onChange={(e) => setLiga(e.target.value)}
                    className="w-full p-2 border rounded"
                >
                    <option value="Great">Great League</option>
                    <option value="Master">Master League</option>
                </select>

                {pokemons.map((pkm, idx) => (
                    <select
                        key={idx}
                        value={pkm}
                        onChange={(e) => {
                            const novoTime = [...pokemons]
                            novoTime[idx] = e.target.value
                            setPokemons(novoTime)
                        }}
                        className="w-full p-2 border rounded"
                    >
                        <option value="">Escolha o Pokémon {idx + 1}</option>
                        {pokemonList.map(name => (
                            <option key={name} value={name}>{name}</option>
                        ))}
                    </select>
                ))}

                <button type="submit" className="bg-yellow-600 text-white px-4 py-2 rounded">
                    Cadastrar
                </button>

                {mensagem && <p className="mt-4 text-sm text-red-700">{mensagem}</p>}
            </form>
        </main>
    )
}