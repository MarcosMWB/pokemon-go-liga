export type GPParticipant = {
  uid: string;
  nome: string;
  pontos: number;
  seed: number;
  opponents: string[];
  byes: number;
};

export type GPPairing = { a: GPParticipant; b: GPParticipant };

export function rankParticipants<T extends GPParticipant>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => b.pontos - a.pontos || a.seed - b.seed || a.nome.localeCompare(b.nome, "pt-BR")
  );
}

export function swissPairings(items: GPParticipant[], round: number): {
  pairings: GPPairing[];
  bye: GPParticipant | null;
} {
  let pool = rankParticipants(items);
  let bye: GPParticipant | null = null;
  if (pool.length % 2 === 1) {
    bye = [...pool].sort((a, b) => a.byes - b.byes || a.pontos - b.pontos || b.seed - a.seed)[0];
    pool = pool.filter((p) => p.uid !== bye!.uid);
  }

  // A primeira rodada fica previsível durante as inscrições: metade superior
  // contra metade inferior. Isso permite mostrar uma prévia estável do chaveamento.
  if (round === 1) {
    const half = Math.ceil(pool.length / 2);
    const upper = pool.slice(0, half);
    const lower = pool.slice(half);
    const firstRound = upper.map((a, index) => ({ a, b: lower[index] })).filter((pair): pair is GPPairing => Boolean(pair.b));
    return { pairings: firstRound, bye };
  }

  const pairings: GPPairing[] = [];
  while (pool.length > 0) {
    const a = pool.shift()!;
    const candidates = pool
      .map((b, index) => ({ b, index }))
      .sort((x, y) => {
        const xRematch = a.opponents.includes(x.b.uid) ? 1 : 0;
        const yRematch = a.opponents.includes(y.b.uid) ? 1 : 0;
        return xRematch - yRematch || Math.abs(a.pontos - x.b.pontos) - Math.abs(a.pontos - y.b.pontos) || x.index - y.index;
      });
    const chosen = candidates[0];
    if (!chosen) break;
    pool.splice(chosen.index, 1);
    pairings.push({ a, b: chosen.b });
  }

  return { pairings, bye };
}

export function topCutSize(participantCount: number): number {
  const cap = Math.min(8, participantCount);
  if (cap < 2) return cap;
  return 2 ** Math.floor(Math.log2(cap));
}

export function topCutOpeningOrder(size: number): number[] {
  // Semeia o bracket para que os melhores classificados só se encontrem mais adiante.
  const orders: Record<number, number[]> = {
    2: [1, 2],
    4: [1, 4, 3, 2],
    8: [1, 8, 4, 5, 3, 6, 2, 7],
  };
  return orders[size] ?? Array.from({ length: size }, (_, i) => i + 1);
}
