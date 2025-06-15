// src/app/reset/ResetPasswordPage.tsx
'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/utils/supabase/client'

export default function ResetPasswordPage() {
    const [newPassword, setNewPassword] = useState('')
    const [message, setMessage] = useState('')
    const [loading, setLoading] = useState(false)

    const router = useRouter()
    const supabase = createClient()

    const handleReset = async () => {
        setLoading(true)
        setMessage('')

        const { error } = await supabase.auth.updateUser({ password: newPassword })

        if (error) {
            setMessage(error.message)
        } else {
            setMessage('Senha redefinida com sucesso.')
            setTimeout(() => router.push('/login'), 2000)
        }

        setLoading(false)
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-blue-50 px-4">
            <div className="max-w-md w-full bg-white rounded-xl shadow p-8">
                <h1 className="text-2xl font-bold text-center text-blue-700 mb-6">Redefinir Senha</h1>
                <input
                    type="password"
                    placeholder="Nova senha"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md mb-4"
                />
                <button
                    onClick={handleReset}
                    disabled={loading}
                    className="w-full py-3 bg-blue-700 text-white font-semibold rounded-md hover:bg-blue-800"
                >
                    {loading ? 'Atualizando...' : 'Atualizar Senha'}
                </button>
                {message && <p className="mt-4 text-center text-sm text-gray-700">{message}</p>}
            </div>
        </div>
    )
}
