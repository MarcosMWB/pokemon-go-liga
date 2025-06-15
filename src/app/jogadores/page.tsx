import { createServerSideClient } from '@/utils/supabase/server'
import { FiltroUsuarios } from './FiltroUsuarios'

export default async function JogadoresPage() {
    const supabase = await createServerSideClient()

    const { data: usuarios } = await supabase
        .from('usuarios')
        .select('id, nome')
        .order('nome', { ascending: true })

    return (
        <div className="max-w-xl mx-auto p-6">
            <h1 className="text-2xl font-bold mb-4">Jogadores</h1>
            {usuarios ? (
                <FiltroUsuarios usuarios={usuarios} />
            ) : (
                <p>Não foi possível carregar os usuários.</p>
            )}
        </div>
    )
}
