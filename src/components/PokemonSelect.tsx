'use client'

import { useState, useEffect } from 'react'

export function PokemonSelect({
    value,
    onChange,
    pokemonList
}: {
    value: string
    onChange: (value: string) => void
    pokemonList: { name: string, id: number }[]
}) {
    const [searchTerm, setSearchTerm] = useState('')
    const [filteredPokemon, setFilteredPokemon] = useState(pokemonList)
    const [isOpen, setIsOpen] = useState(false)

    useEffect(() => {
        if (searchTerm) {
            setFilteredPokemon(
                pokemonList.filter(p =>
                    p.name.toLowerCase().includes(searchTerm.toLowerCase())
                )
            )
        } else {
            setFilteredPokemon(pokemonList)
        }
    }, [searchTerm, pokemonList])

    return (
        <div className="relative">
            <input
                type="text"
                placeholder="Buscar Pokémon..."
                value={searchTerm || value}
                onChange={(e) => setSearchTerm(e.target.value)}
                onFocus={() => setIsOpen(true)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
            />
            {isOpen && (
                <div className="absolute z-10 mt-1 w-full bg-white shadow-lg max-h-60 rounded-md py-1 text-base ring-1 ring-black ring-opacity-5 overflow-auto focus:outline-none sm:text-sm">
                    {filteredPokemon.length > 0 ? (
                        filteredPokemon.map((pokemon) => (
                            <div
                                key={pokemon.id}
                                className={`cursor-pointer select-none relative py-2 pl-3 pr-9 hover:bg-yellow-50 ${value === pokemon.name ? 'bg-yellow-100' : ''
                                    }`}
                                onClick={() => {
                                    onChange(pokemon.name)
                                    setIsOpen(false)
                                    setSearchTerm('')
                                }}
                            >
                                <span className="block truncate">{pokemon.name}</span>
                            </div>
                        ))
                    ) : (
                        <div className="text-gray-500 py-2 pl-3 pr-9">Nenhum Pokémon encontrado</div>
                    )}
                </div>
            )}
        </div>
    )
}
