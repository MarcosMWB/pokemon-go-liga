import Link from 'next/link'
import { createServerSideClient } from '@/utils/supabase/server'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function PerfilPage(props: any) {
    const supabase = await createServerSideClient()
    const { id } = await props.params

    // Obtém o usuário logado
    const {
        data: { session },
    } = await supabase.auth.getSession()
    const user = session?.user
    const isOwnProfile = user?.id === id

    // Dados do perfil visitado
    const { data: usuario } = await supabase
        .from('usuarios')
        .select('nome')
        .eq('id', id)
        .single()

    if (!usuario) return notFound()

    const { data: participacoes } = await supabase
        .from('participacoes')
        .select('id, liga_id, ligas(nome), pokemon: pokemon(nome)')
        .eq('usuario_id', id)

    type Participacao = {
        ligas?: { nome: string }[]
    }

    const ligasRegistradas = (participacoes as Participacao[])?.map(p => p.ligas?.[0]?.nome) || []
    const ligasFaltando = ['Great', 'Master'].filter(l => !ligasRegistradas.includes(l))

    return (
        <div className="min-h-screen bg-blue-50 py-10 px-4">
            <div className="max-w-3xl mx-auto bg-white p-8 rounded shadow">
                <h1 className="text-2xl font-bold text-blue-800 mb-4">
                    Perfil de {usuario.nome}
                </h1>

                {participacoes && participacoes.length > 0 ? (
                    participacoes.map((p: any, i: number) => (
                        <div key={i} className="mb-6 border-t pt-4">
                            <h2 className="text-lg font-semibold text-blue-700">
                                Liga: {p.ligas?.nome || 'Desconhecida'}
                            </h2>
                            <ul className="list-disc list-inside text-gray-700 mt-2">
                                {p.pokemon?.map((poke: any, j: number) => (
                                    <li key={j}>{poke.nome}</li>
                                ))}
                            </ul>
                        </div>
                    ))
                ) : (
                    <p className="text-gray-600 mb-4">Nenhuma equipe registrada ainda.</p>
                )}

                {ligasFaltando.length > 0 && isOwnProfile && (
                    <div className="mt-8 space-y-4">
                        <h2 className="text-lg font-semibold text-blue-700">Cadastrar Equipe:</h2>
                        {ligasFaltando.map((liga: string) => (
                            <Link
                                key={liga}
                                href={`/cadastro/equipe?user=${id}&liga=${liga}`}
                            >
                                <button className="block w-full py-3 bg-yellow-600 hover:bg-yellow-700 text-white font-semibold rounded-md">
                                    Cadastrar equipe {liga}
                                </button>
                            </Link>
                        ))}
                    </div>
                )}

                <footer className="mt-10 text-sm text-gray-500 text-center">
                    {user && `Logado como: ${user.email}`}
                </footer>
            </div>
        </div>
    )
}