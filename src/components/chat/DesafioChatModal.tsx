"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

function qrSrc(data: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(data)}`;
}
function buildPoGoFriendLinks(fc: string) {
  const native = `pokemongo://?dl_action=AddFriend&DlId=${encodeURIComponent(fc)}`;
  const androidIntent = `intent://?dl_action=AddFriend&DlId=${encodeURIComponent(
    fc
  )}#Intent;scheme=pokemongo;package=com.nianticlabs.pokemongo;end`;
  return { native, androidIntent };
}

export type ChatMsg = { id: string; from: string; text: string; createdAt: any };

export default function DesafioChatModal({
  open,
  onClose,
  uid,
  otherName,
  otherFC,
  isAndroid,
  messages,
  onSend,
  onDeclareWin,
  onDeclareLose,
}: {
  open: boolean;
  onClose: () => void;
  uid: string;
  otherName: string;
  otherFC: string | null;
  isAndroid: boolean;
  messages: ChatMsg[];
  onSend: (text: string) => void;
  onDeclareWin: () => void;
  onDeclareLose: () => void;
}) {
  const [input, setInput] = useState("");
  const [showInfo, setShowInfo] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open && boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [open, messages.length]);

  if (!open) return null;

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
                {(() => {
                  const { native, androidIntent } = buildPoGoFriendLinks(otherFC!);
                  const deep = isAndroid ? androidIntent : native;
                  return (
                    <div className="mt-2 flex flex-col items-start gap-2">
                      <a href={deep} className="text-blue-600 text-xs hover:underline">
                        Abrir no Pokémon GO
                      </a>
                      <Image
                        src={qrSrc(native)}
                        alt="QR para adicionar"
                        width={140}
                        height={140}
                        className="w-36 h-36 border rounded"
                      />
                      <div className="w-full flex items-center justify-between gap-2">
                        <button
                          onClick={() => navigator.clipboard?.writeText(otherFC!)}
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
                            <li>Se houver problema (app/conexão/atraso), registre aqui antes do resultado.</li>
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </>
            ) : (
              <p className="text-xs text-amber-600 mt-1">O outro jogador não cadastrou FC.</p>
            )}
          </div>
        </div>

        <div ref={boxRef} className="mt-3 border rounded-lg p-2 max-h-52 md:max-h-60 overflow-auto bg-slate-50">
          {messages.length === 0 ? (
            <p className="text-xs text-slate-500">Nenhuma mensagem ainda.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {messages.map((m) => {
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
              onKeyDown={(e) => {
                if (e.key === "Enter" && input.trim()) {
                  onSend(input.trim());
                  setInput("");
                }
              }}
              className="flex-1 border rounded px-3 py-2 text-sm"
              placeholder="Escreva uma mensagem..."
            />
            <button
              onClick={() => {
                if (!input.trim()) return;
                onSend(input.trim());
                setInput("");
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-3 py-2 rounded"
              type="button"
            >
              Enviar
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onDeclareWin}
              className="w-full bg-green-600 hover:bg-green-700 text-white text-xs md:text-sm px-3 py-2 rounded"
              title="Você declara que VENCEU"
              type="button"
            >
              🏆 Venci
            </button>
            <button
              onClick={onDeclareLose}
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
