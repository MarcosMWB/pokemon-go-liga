// login.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'

export default function LoginPage() {
    const router = useRouter()
    const supabase = createClient()
    const [email, setEmail] = useState('')
    const [senha, setSenha] = useState('')
    const [mensagem, setMensagem] = useState('')

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setMensagem('')

        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password: senha
        })

        if (error) {
            setMensagem(error.message)
            return
        }

        const { user } = data
        router.push(`/perfil/${user.id}`)
    }

    const handlePasswordReset = async () => {
        if (!email) {
            setMensagem('Informe seu email para recuperar a senha.')
            return
        }
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/reset`
        })
        if (error) {
            setMensagem(error.message)
        } else {
            setMensagem('E-mail de recuperação enviado.')
        }
    }

    return (
        <form onSubmit={handleLogin} className="p-8 max-w-md mx-auto">
            <h1 className="text-xl font-bold mb-4">Login</h1>
            <input type="email" placeholder="Email" required value={email} onChange={e => setEmail(e.target.value)} className="w-full border p-2 mb-2" />
            <input type="password" placeholder="Senha" required value={senha} onChange={e => setSenha(e.target.value)} className="w-full border p-2 mb-4" />
            <button type="submit" className="w-full bg-blue-500 text-white p-2">Entrar</button>
            <button type="button" onClick={handlePasswordReset} className="w-full mt-2 text-sm text-blue-600 underline">Esqueci minha senha</button>
            {mensagem && <p className="text-red-600 mt-2">{mensagem}</p>}
        </form>
    )
}