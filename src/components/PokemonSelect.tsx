'use client'

import { useState, useEffect, useRef } from 'react'

type Pokemon = {
  name: string
  id: number
}

interface PokemonSelectProps {
  value: string[]
  onChange: (value: string[]) => void
  pokemonList: Pokemon[]
}

export function PokemonSelect({ value, onChange, pokemonList }: PokemonSelectProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [filteredPokemon, setFilteredPokemon] = useState<Pokemon[]>(pokemonList)
  const [isOpen, setIsOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (searchTerm) {
      setFilteredPokemon(
        pokemonList.filter((p) =>
          p.name.toLowerCase().includes(searchTerm.toLowerCase())
        )
      )
    } else {
      setFilteredPokemon(pokemonList)
    }
  }, [searchTerm, pokemonList])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const handleSelect = (name: string) => {
    if (!value.includes(name)) {
      onChange([...value, name])
    }
    setIsOpen(false)
    setSearchTerm('')
  }

  return (
    <div className="relative" ref={wrapperRef}>
      <input
        type="text"
        placeholder="Buscar Pokémon..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        onFocus={() => setIsOpen(true)}
        className="text-black w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
      />
      {isOpen && (
        <div className="absolute z-10 mt-1 w-full bg-white shadow-lg max-h-60 rounded-md py-1 text-base ring-1 ring-black ring-opacity-5 overflow-auto focus:outline-none sm:text-sm">
          {filteredPokemon.length > 0 ? (
            filteredPokemon.map((pokemon) => (
              <div
                key={pokemon.id}
                className={`text-black cursor-pointer select-none relative py-2 pl-3 pr-9 hover:bg-yellow-50 ${
                  value.includes(pokemon.name) ? 'bg-yellow-100' : ''
                }`}
                onClick={() => handleSelect(pokemon.name)}
              >
                <span className="block truncate">{pokemon.name}</span>
              </div>
            ))
          ) : (
            <div className="text-gray-500 py-2 pl-3 pr-9">
              Nenhum Pokémon encontrado
            </div>
          )}
        </div>
      )}
    </div>
  )
}
