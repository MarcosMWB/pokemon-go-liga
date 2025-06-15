import { createServerSideClient } from '@/utils/supabase/server'
import { FiltroUsuarios } from './FiltroUsuarios'

export default async function JogadoresPage() {
    const supabase = await createServerSideClient()

    const { data: usuarios } = await supabase
        .from('usuarios')
        .select('id, nome')
        .order('nome', { ascending: true })

    return (
        <div className="p-6 max-w-2xl mx-auto">
            <h1 className="text-2xl font-bold mb-4">Todos os Jogadores</h1>
            {usuarios && <FiltroUsuarios usuarios={usuarios} />}
        </div>
    )
}
