"use client";

import { useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";
import {
  addDoc,
  collection,
  serverTimestamp,
} from "firebase/firestore";

export default function DevPage() {
  const [uid, setUid] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((user) => {
      if (user) setUid(user.uid);
      else setUid(null);
    });
    return () => unsub();
  }, []);

  const handleSeedOfertas = async () => {
    if (!uid) {
      setStatus("precisa estar logado");
      return;
    }
    setStatus("criando ofertas...");

    // podemos criar com vários donos fictícios
    const ofertas = [
      {
        usuario_uid: uid,
        pokemon_oferecido: "Gible 96%",
        quer_em_troca: "Axew",
        observacao: "Tem bom IV pra PVP",
      },
      {
        usuario_uid: "dev-user-2",
        pokemon_oferecido: "Deino",
        quer_em_troca: "Gible",
        observacao: "Somente com amizade boa",
      },
      {
        usuario_uid: "dev-user-3",
        pokemon_oferecido: "Larvitar",
        quer_em_troca: "Deino ou Goomy",
        observacao: "",
      },
      {
        usuario_uid: "dev-user-4",
        pokemon_oferecido: "Goomy",
        quer_em_troca: "Noibat",
        observacao: "Sem rename",
      },
      {
        usuario_uid: "dev-user-5",
        pokemon_oferecido: "Noibat",
        quer_em_troca: "Goomy",
        observacao: "Aceito outro raro",
      },
    ];

    for (const o of ofertas) {
      await addDoc(collection(db, "trocas_ofertas"), {
        ...o,
        ativo: true,
        createdAt: Date.now(),
      });
    }

    setStatus("ofertas criadas ✅");
  };

  const handleSeedSwipes = async () => {
    if (!uid) {
      setStatus("precisa estar logado");
      return;
    }
    setStatus("criando swipes...");

    // ideia: o user logado deu like em 2 ofertas e dislike em 1
    const swipes = [
      {
        usuario_uid: uid,
        oferta_id: "OFERTA_ID_1", // depois você troca pelos ids reais se quiser
        acao: "like", // "like" ou "dislike"
      },
      {
        usuario_uid: uid,
        oferta_id: "OFERTA_ID_2",
        acao: "like",
      },
      {
        usuario_uid: uid,
        oferta_id: "OFERTA_ID_3",
        acao: "dislike",
      },
    ];

    for (const s of swipes) {
      await addDoc(collection(db, "trocas_swipes"), {
        ...s,
        createdAt: Date.now(),
      });
    }

    setStatus("swipes criados ✅ (lembre de trocar os OFERTA_ID_*)");
  };

  const handleSeedMatches = async () => {
    if (!uid) {
      setStatus("precisa estar logado");
      return;
    }
    setStatus("criando matches...");

    // match fake entre você e o dev-user-2
    await addDoc(collection(db, "trocas_matches"), {
      usuario1_uid: uid,
      usuario2_uid: "dev-user-2",
      oferta1_id: "OFERTA_ID_DO_USER", // trocar depois
      oferta2_id: "OFERTA_ID_DEV2", // trocar depois
      createdAt: Date.now(),
    });

    // outro match fake
    await addDoc(collection(db, "trocas_matches"), {
      usuario1_uid: uid,
      usuario2_uid: "dev-user-3",
      oferta1_id: "OFERTA_ID_DO_USER",
      oferta2_id: "OFERTA_ID_DEV3",
      createdAt: Date.now(),
    });

    setStatus("matches criados ✅ (troque os ids depois)");
  };

  return (
    <div className="max-w-xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold mb-2">/dev – popular trocas</h1>
      <p className="text-sm text-gray-500">
        {uid
          ? `Logado como ${uid}`
          : "Não está logado. Faça login para criar docs."}
      </p>

      <div className="flex flex-col gap-3">
        <button
          onClick={handleSeedOfertas}
          className="bg-blue-600 text-white px-4 py-2 rounded"
        >
          Popular trocas_ofertas
        </button>
        <button
          onClick={handleSeedSwipes}
          className="bg-purple-600 text-white px-4 py-2 rounded"
        >
          Popular trocas_swipes
        </button>
        <button
          onClick={handleSeedMatches}
          className="bg-green-600 text-white px-4 py-2 rounded"
        >
          Popular trocas_matches
        </button>
      </div>

      {status && <p className="text-sm text-gray-700">{status}</p>}

      <p className="text-xs text-gray-400 mt-6">
        Obs.: como nas permissões você deixou <code>create</code> liberado para
        qualquer logado, dá pra criar registros com outros uids fictícios
        (dev-user-2, dev-user-3...) só pra testar o fluxo.
      </p>
    </div>
  );
}
