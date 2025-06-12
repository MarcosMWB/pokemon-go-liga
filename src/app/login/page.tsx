'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import bcrypt from 'bcryptjs'

export default function LoginPage() {
    const router = useRouter()
    const [email, setEmail] = useState('')
    const [senha, setSenha] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [message, setMessage] = useState({ text: '', type: '' })

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsSubmitting(true)
        setMessage({ text: '', type: '' })

        const supabase = createClient()

        try {
            const { data: user, error } = await supabase
                .from('usuarios')
                .select('id, senha_hash')
                .eq('email', email)
                .single()

            if (error || !user) throw new Error('E-mail não encontrado.')

            const senhaCorreta = bcrypt.compareSync(senha, user.senha_hash)
            if (!senhaCorreta) throw new Error('Senha incorreta.')

            setMessage({ text: 'Login realizado com sucesso!', type: 'success' })

            setTimeout(() => {
                router.push(`/perfil/${user.id}`) // ajuste para rota real
            }, 1500)
        } catch (error) {
            const err = error as Error
            setMessage({ text: err.message, type: 'error' })
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-blue-50 px-4">
            <div className="max-w-md w-full bg-white rounded-xl shadow p-8">
                <h1 className="text-2xl font-bold text-center text-blue-700 mb-6">Login</h1>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm text-gray-700">E-mail</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                        />
                    </div>

                    <div>
                        <label className="block text-sm text-gray-700">Senha</label>
                        <input
                            type="password"
                            value={senha}
                            onChange={(e) => setSenha(e.target.value)}
                            required
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full py-3 bg-blue-700 text-white font-semibold rounded-md hover:bg-blue-800"
                    >
                        {isSubmitting ? 'Entrando...' : 'Entrar'}
                    </button>

                    {message.text && (
                        <div className={`mt-3 p-3 text-sm rounded-md ${message.type === 'error'
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
