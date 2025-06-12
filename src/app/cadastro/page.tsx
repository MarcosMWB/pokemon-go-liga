'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import bcrypt from 'bcryptjs'

export default function CadastroPage() {
    const router = useRouter()
    const [friendCode, setFriendCode] = useState('')
    const [nome, setNome] = useState('')
    const [email, setEmail] = useState('')
    const [senha, setSenha] = useState('')
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

        if (!email.includes('@') || senha.length < 6) {
            setMessage({ text: 'E-mail ou senha inválidos', type: 'error' })
            setIsSubmitting(false)
            return
        }

        const supabase = createClient()

        try {
            const senha_hash = bcrypt.hashSync(senha, 10)

            const { error } = await supabase.from('usuarios').insert({
                id: friendCode.replace(/\s/g, ''),
                nome,
                email,
                senha_hash
            })

            if (error) throw error

            setMessage({ text: 'Cadastro realizado com sucesso! Redirecionando...', type: 'success' })

            setTimeout(() => router.push(`/cadastro/equipe?user=${friendCode.replace(/\s/g, '')}`), 2000)
        } catch (error) {
            const err = error as Error
            setMessage({
                text: err.message.includes('duplicate key')
                    ? 'Este Friend Code ou e-mail já está cadastrado'
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
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                            maxLength={14}
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-700">Nome</label>
                        <input
                            type="text"
                            placeholder="Ash Ketchum"
                            value={nome}
                            onChange={(e) => setNome(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-700">E-mail</label>
                        <input
                            type="email"
                            placeholder="email@exemplo.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-700">Senha</label>
                        <input
                            type="password"
                            placeholder="******"
                            value={senha}
                            onChange={(e) => setSenha(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                            required
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full py-3 bg-yellow-600 hover:bg-yellow-700 text-white font-semibold rounded-md"
                    >
                        {isSubmitting ? 'Cadastrando...' : 'Cadastrar'}
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
