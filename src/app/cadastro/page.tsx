'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'

export default function CadastroPage() {
    const router = useRouter()
    const [friendCode, setFriendCode] = useState('')
    const [nome, setNome] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [message, setMessage] = useState({ text: '', type: '' })

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsSubmitting(true)
        setMessage({ text: '', type: '' })

        if (!friendCode.match(/^\d{4}\s?\d{4}\s?\d{4}$/)) {
            setMessage({ text: 'Friend Code inválido (formato: 1234 5678 9012)', type: 'error' })
            setIsSubmitting(false)
            return
        }

        const supabase = createClient()

        try {
            const { error } = await supabase.from('usuarios').insert({
                id: friendCode.replace(/\s/g, ''),
                nome
            })

            if (error) throw error

            setMessage({ text: 'Cadastro realizado com sucesso! Redirecionando...', type: 'success' })

            setTimeout(() => router.push(`/cadastro/equipe?user=${friendCode.replace(/\s/g, '')}`), 2000)
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
                    <h1 className="text-2xl font-bold text-center text-white">Cadastro de Treinador</h1>
                    <p className="text-yellow-100 text-center text-sm mt-1">Região Oceânica de Niterói</p>
                </div>

                <form onSubmit={handleSubmit} className="p-8 space-y-6">
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-700">Friend Code</label>
                        <input
                            type="text"
                            placeholder="1234 5678 9012"
                            value={friendCode}
                            onChange={(e) => setFriendCode(e.target.value.replace(/[^\d\s]/g, ''))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
                            maxLength={14}
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-700">Nome do Treinador</label>
                        <input
                            type="text"
                            placeholder="Ash Ketchum"
                            value={nome}
                            onChange={(e) => setNome(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
                            required
                        />
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
