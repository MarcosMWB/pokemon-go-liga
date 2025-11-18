export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebaseAdmin';

const GINASIOS = [
  { nome: 'Jardim Imbuí', tipo: '', icon: '/Insignia/jardimimbui.png' },
  { nome: 'Piratininga', tipo: '', icon: '/Insignia/piratininga.png' },
  { nome: 'Cafubá', tipo: '', icon: '/Insignia/cafuba.png' },
  { nome: 'Jacaré', tipo: '', icon: '/Insignia/jacare.png' },
  { nome: 'Camboinhas', tipo: '', icon: '/Insignia/camboinhas.png' },
  { nome: 'Maravista', tipo: '', icon: '/Insignia/maravista.png' },
  { nome: 'Itaipu', tipo: '', icon: '/Insignia/itaipu.png' },
  { nome: 'Itacoatiara', tipo: '', icon: '/Insignia/itacoatiara.png' },
  { nome: 'Serra Grande', tipo: '', icon: '/Insignia/serragrande.png' },
  { nome: 'Engenho do Mato', tipo: '', icon: '/Insignia/engenhodomato.png' },
];

export async function POST(req: Request) {
  try {
    const { liga } = await req.json();
    if (!liga) {
      return NextResponse.json({ ok: false, error: 'liga ausente' }, { status: 400 });
    }

    const adminDb = getAdminDb(); // Admin SDK (não usa web API key)
    const batch = adminDb.batch();

    for (const g of GINASIOS) {
      const ref = adminDb.collection('ginasios').doc();
      batch.set(ref, {
        nome: g.nome,
        tipo: g.tipo,
        insignia_icon: g.icon,
        lider_uid: '',
        lider_whatsapp: '',
        em_disputa: false,
        liga,
        createdAt: Date.now(),
      });
    }

    await batch.commit();
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'erro' }, { status: 500 });
  }
}
