export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
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
    const authorization = req.headers.get('authorization');
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return NextResponse.json({ ok: false, error: 'não autenticado' }, { status: 401 });
    }

    const adminDb = getAdminDb();
    let decodedToken;
    try {
      decodedToken = await getAuth().verifyIdToken(match[1]);
    } catch {
      return NextResponse.json({ ok: false, error: 'token inválido' }, { status: 401 });
    }

    const superuser = await adminDb.collection('superusers').doc(decodedToken.uid).get();
    if (!superuser.exists) {
      return NextResponse.json({ ok: false, error: 'sem permissão' }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const liga = typeof body?.liga === 'string' ? body.liga.trim() : '';
    if (!liga || liga.length > 100) {
      return NextResponse.json({ ok: false, error: 'liga ausente' }, { status: 400 });
    }

    const ligaSnap = await adminDb.collection('ligas').where('nome', '==', liga).limit(1).get();
    if (ligaSnap.empty) {
      return NextResponse.json({ ok: false, error: 'liga não encontrada' }, { status: 404 });
    }

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
  } catch {
    console.error('Falha ao semear ginásios.');
    return NextResponse.json({ ok: false, error: 'erro interno' }, { status: 500 });
  }
}
