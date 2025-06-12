import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerSideClient } from '@/utils/supabase/server'

type PageProps = {
    params: { id: string }
}

export default async function PerfilPage({ params }: PageProps) {
    const supabase = createServerSideClient()
    const { id } = params

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

    const ligasRegistradas = participacoes?.map(p => p.ligas?.nome) || []
    const ligasFaltando = ['Great', 'Master'].filter(l => !ligasRegistradas.includes(l))

    return (
        <div className="min-h-screen bg-blue-50 py-10 px-4">
            <div className="max-w-3xl mx-auto bg-white p-8 rounded shadow">
                <h1 className="text-2xl font-bold text-blue-800 mb-4">
                    Perfil de {usuario.nome}
                </h1>

                {participacoes && participacoes.length > 0 ? (
                    participacoes.map((p, i) => (
                        <div key={i} className="mb-6 border-t pt-4">
                            <h2 className="text-lg font-semibold text-blue-700">
                                Liga: {p.ligas?.nome || 'Desconhecida'}
                            </h2>
                            <ul className="list-disc list-inside text-gray-700 mt-2">
                                {p.pokemon?.map((poke, j) => (
                                    <li key={j}>{poke.nome}</li>
                                ))}
                            </ul>
                        </div>
                    ))
                ) : (
                    <p className="text-gray-600 mb-4">Nenhuma equipe registrada ainda.</p>
                )}

                {ligasFaltando.length > 0 && (
                    <div className="mt-8 space-y-4">
                        <h2 className="text-lg font-semibold text-blue-700">
                            Cadastrar Equipe:
                        </h2>
                        {ligasFaltando.map((liga) => (
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
            </div>
        </div>
    )
}
