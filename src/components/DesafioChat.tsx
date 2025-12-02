// components/DesafioChat.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { db } from "@/lib/firebase";
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs,
  onSnapshot, orderBy, query, serverTimestamp, updateDoc, Unsubscribe
} from "firebase/firestore";

type Props = {
  desafioId: string;
  uid: string;
  onClose: () => void;
  onFinalizado?: (status: "concluido" | "conflito") => void;
  apagarMensagensAoFinal?: boolean;
};

function qrSrc(data: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(data)}`;
}
function buildPoGoFriendLinks(fc: string) {
  const native = `pokemongo://?dl_action=AddFriend&DlId=${encodeURIComponent(fc)}`;
  const androidIntent = `intent://?dl_action=AddFriend&DlId=${encodeURIComponent(fc)}#Intent;scheme=pokemongo;package=com.nianticlabs.pokemongo;end`;
  return { native, androidIntent };
}

export default function DesafioChat({
  desafioId, uid, onClose, onFinalizado, apagarMensagensAoFinal = true,
}: Props) {
  const [msgs, setMsgs] = useState<Array<{id: string; from: string; text: string; createdAt: any}>>([]);
  const [input, setInput] = useState("");
  const [otherName, setOtherName] = useState("Treinador");
  const [otherFC, setOtherFC] = useState<string | null>(null);
  const [souLiderNoChat, setSouLiderNoChat] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  const chatBoxRef = useRef<HTMLDivElement | null>(null);
  const msgsUnsub = useRef<Unsubscribe | null>(null);
  const desafioUnsub = useRef<Unsubscribe | null>(null);

  const isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent || "");

  useEffect(() => {
    // abrir: checa participação, resolve oponente, assina msgs e o doc do desafio
    let mounted = true;

    async function open() {
      const dRef = doc(db, "desafios_ginasio", desafioId);
      const dSnap = await getDoc(dRef);
      if (!dSnap.exists()) {
        alert("Desafio inexistente.");
        onClose();
        return;
      }
      const d = dSnap.data() as any;
      const souParticipante = d.lider_uid === uid || d.desafiante_uid === uid;
      if (!souParticipante) {
        alert("Você não participa deste desafio.");
        onClose();
        return;
      }
      setSouLiderNoChat(d.lider_uid === uid);

      const otherUid = d.lider_uid === uid ? d.desafiante_uid : d.lider_uid;
      try {
        const us = await getDoc(doc(db, "usuarios", otherUid));
        if (mounted) {
          if (us.exists()) {
            const du = us.data() as any;
            setOtherName(du.nome || du.email || otherUid);
            setOtherFC(du.friend_code || null);
          } else {
            setOtherName(otherUid);
            setOtherFC(null);
          }
        }
      } catch {
        if (mounted) {
          setOtherName(otherUid);
          setOtherFC(null);
        }
      }

      // mensagens
      msgsUnsub.current = onSnapshot(
        query(collection(db, "desafios_ginasio", desafioId, "mensagens"), orderBy("createdAt", "asc")),
        (snap) => {
          setMsgs(snap.docs.map((m) => {
            const x = m.data() as any;
            return { id: m.id, from: x.from, text: x.text, createdAt: x.createdAt };
          }));
          // autoscroll
          if (chatBoxRef.current) {
            chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
          }
        },
        (err) => {
          console.error("Chat listener error:", err);
          alert("Sem permissão para abrir este chat.");
          onClose();
        }
      );

      // watcher do desafio (fecha se concluir/conflito)
      desafioUnsub.current = onSnapshot(dRef, async (ds) => {
        if (!ds.exists()) return;
        const dd = ds.data() as any;
        if (dd.status === "concluido" || dd.status === "conflito") {
          if (apagarMensagensAoFinal) {
            await clearChat(desafioId);
          }
          onFinalizado?.(dd.status);
          onClose();
        }
      });
    }

    open();
    return () => {
      mounted = false;
      msgsUnsub.current?.();
      desafioUnsub.current?.();
      msgsUnsub.current = null;
      desafioUnsub.current = null;
    };
  }, [desafioId, uid, onClose, onFinalizado, apagarMensagensAoFinal]);

  async function clearChat(id: string) {
    const snap = await getDocs(collection(db, "desafios_ginasio", id, "mensagens"));
    await Promise.all(snap.docs.map((m) => deleteDoc(doc(db, "desafios_ginasio", id, "mensagens", m.id))));
  }

  async function send() {
    const text = input.trim();
    if (!text) return;
    await addDoc(collection(db, "desafios_ginasio", desafioId, "mensagens"), {
      from: uid,
      text,
      createdAt: serverTimestamp(),
    });
    setInput("");
  }

  async function declareResultado(vencedor: "lider" | "desafiante") {
    const ok = window.confirm(
      vencedor === (souLiderNoChat ? "lider" : "desafiante")
        ? "Você confirma que venceu esta batalha?"
        : "Você confirma que foi derrotado nesta batalha?"
    );
    if (!ok) return;

    const ref = doc(db, "desafios_ginasio", desafioId);
    const dSnap = await getDoc(ref);
    if (!dSnap.exists()) return;
    const d = dSnap.data() as any;

    const souLider = d.lider_uid === uid;
    const campo = souLider ? "resultado_lider" : "resultado_desafiante";
    await updateDoc(ref, { [campo]: vencedor });
    // a finalização continuará no fluxo já existente no cliente/CF
  }

  const deepLink = otherFC ? (isAndroid ? buildPoGoFriendLinks(otherFC).androidIntent
                                         : buildPoGoFriendLinks(otherFC).native) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full max-w-2xl max-h-[90vh] rounded-xl shadow-xl p-3 md:p-5 flex flex-col">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Desafio & Chat</h3>
            <p className="text-xs text-slate-600">Combine a batalha e depois declare o resultado.</p>
          </div>
          <button className="text-slate-500 hover:text-slate-800 text-sm" onClick={onClose}>
            Fechar
          </button>
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="border rounded-lg p-3">
            <p className="text-xs text-slate-500">Adicionar {otherName}:</p>
            {otherFC ? (
              <>
                <p className="text-sm font-semibold mt-1">FC: {otherFC}</p>
                {deepLink && (
                  <div className="mt-2 flex flex-col items-start gap-2">
                    <a href={deepLink} className="text-blue-600 text-xs hover:underline">
                      Abrir no Pokémon GO
                    </a>
                    <Image
                      src={qrSrc(buildPoGoFriendLinks(otherFC).native)}
                      alt="QR para adicionar"
                      width={140}
                      height={140}
                      className="w-36 h-36 border rounded"
                    />
                    <div className="w-full flex items-center justify-between gap-2">
                      <button
                        onClick={() => navigator.clipboard?.writeText(otherFC)}
                        className="text-[11px] bg-slate-200 hover:bg-slate-300 px-2 py-1 rounded"
                      >
                        Copiar FC
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowInfo((v) => !v)}
                        className="flex items-center gap-1 text-[11px] text-slate-700"
                      >
                        <span>Converse com o adversário</span>
                        <span className="w-4 h-4 flex items-center justify-center rounded-full bg-slate-100 border border-slate-300 text-[10px] font-bold">
                          i
                        </span>
                      </button>
                    </div>
                    {showInfo && (
                      <div className="text-[11px] text-slate-600 mt-1">
                        <ul className="list-disc pl-4 space-y-1">
                          <li>Combine dia, horário e se será presencial ou remoto.</li>
                          <li>Confirme a liga usada e a quantidade de partidas.</li>
                          <li>Registre problemas (app/conexão/atraso) aqui antes do resultado.</li>
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-amber-600 mt-1">O outro jogador não cadastrou FC.</p>
            )}
          </div>
        </div>

        <div ref={chatBoxRef} className="mt-3 border rounded-lg p-2 max-h-52 md:max-h-60 overflow-auto bg-slate-50">
          {msgs.length === 0 ? (
            <p className="text-xs text-slate-500">Nenhuma mensagem ainda.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {msgs.map((m) => {
                const mine = m.from === uid;
                return (
                  <div
                    key={m.id}
                    className={`max-w-[85%] px-3 py-2 rounded text-xs ${
                      mine ? "self-end bg-blue-600 text-white" : "self-start bg-white border"
                    }`}
                  >
                    <p>{m.text}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              className="flex-1 border rounded px-3 py-2 text-sm"
              placeholder="Escreva uma mensagem..."
            />
            <button onClick={send} className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-3 py-2 rounded" type="button">
              Enviar
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => declareResultado(souLiderNoChat ? "lider" : "desafiante")}
              className="w-full bg-green-600 hover:bg-green-700 text-white text-xs md:text-sm px-3 py-2 rounded"
              title="Você declara que VENCEU"
              type="button"
            >
              🏆 Venci
            </button>
            <button
              onClick={() => declareResultado(souLiderNoChat ? "desafiante" : "lider")}
              className="w-full bg-red-600 hover:bg-red-700 text-white text-xs md:text-sm px-3 py-2 rounded"
              title="Você declara que FOI DERROTADO"
              type="button"
            >
              Fui derrotado
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
