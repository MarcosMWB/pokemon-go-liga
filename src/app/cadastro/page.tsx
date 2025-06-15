'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'

export default function CadastroPage() {
    const router = useRouter()
    const supabase = createClient()
    const [friendCode, setFriendCode] = useState('')
    const [nome, setNome] = useState('')
    const [email, setEmail] = useState('')
    const [senha, setSenha] = useState('')
    const [mensagem, setMensagem] = useState('')

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setMensagem('')

        if (!friendCode.match(/^\d{4}\s?\d{4}\s?\d{4}$/)) {
            setMensagem('Friend Code inválido (use o formato: 1234 5678 9012)')
            return
        }

        const { data, error } = await supabase.auth.signUp({
            email,
            password: senha
        })

        if (error) {
            setMensagem(error.message)
            return
        }

        const user = data?.user

        if (!user) {
            setMensagem('Erro ao obter usuário após cadastro.')
            return
        }

        const { error: insertError } = await supabase.from('usuarios').insert({
            id: user.id,
            nome,
            email,
            friend_code: friendCode.replace(/\s/g, '')
        })

        if (insertError) {
            setMensagem('Erro ao salvar no banco de dados.')
            return
        }

        router.push('/login')
    }

    return (
        <form onSubmit={handleSubmit} className="p-8 max-w-md mx-auto">
            <h1 className="text-xl font-bold mb-4">Cadastro</h1>
            <input
                type="text"
                placeholder="Código do treinador: 9999 0000 9999"
                required
                value={friendCode}
                onChange={e => setFriendCode(e.target.value)}
                className="w-full border p-2 mb-2"
            />
            <input
                type="text"
                placeholder="Nome"
                required
                value={nome}
                onChange={e => setNome(e.target.value)}
                className="w-full border p-2 mb-2"
            />
            <input
                type="email"
                placeholder="Email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full border p-2 mb-2"
            />
            <input
                type="password"
                placeholder="Senha"
                required
                value={senha}
                onChange={e => setSenha(e.target.value)}
                className="w-full border p-2 mb-4"
            />
            <button type="submit" className="w-full bg-yellow-500 text-white p-2">Cadastrar</button>
            {mensagem && <p className="text-red-600 mt-2">{mensagem}</p>}
        </form>
    )
}
