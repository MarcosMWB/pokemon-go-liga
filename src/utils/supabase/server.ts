import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import type { CookieOptions } from '@supabase/ssr'

export async function createServerSideClient() {
    const cookieStore = await cookies() // <- usar await

    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll: (): { name: string; value: string }[] => cookieStore.getAll(),
                setAll: (
                    cookiesToSet: { name: string; value: string; options?: CookieOptions }[]
                ) =>
                    cookiesToSet.forEach(({ name, value, options }) =>
                        cookieStore.set(name, value, options)
                    ),
            },
        }
    )
}
