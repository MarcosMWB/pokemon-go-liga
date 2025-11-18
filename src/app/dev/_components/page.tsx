"use client";
import React from "react";
import type { AdminState } from "@/hooks/useAdminGate";

export default function AdminGateScreen({
  state, uid, projectId, err,
}: { state: AdminState; uid: string | null; projectId: string | null; err?: string | null }) {
  const Box = ({ children }: { children: React.ReactNode }) => (
    <div className="max-w-xl mx-auto mt-10 bg-white border rounded p-5">{children}</div>
  );

  if (state === "loading") return <Box><p>Carregando…</p></Box>;
  if (state === "no-auth") {
    return (
      <Box>
        <h1 className="text-lg font-semibold mb-2">Acesso restrito</h1>
        <p className="text-sm text-gray-700">Você precisa entrar para acessar o painel /dev.</p>
        <a className="text-blue-600 underline text-sm mt-3 inline-block" href="/login">Ir para login</a>
      </Box>
    );
  }
  if (state === "not-super") {
    return (
      <Box>
        <h1 className="text-lg font-semibold mb-2">Você não é superuser</h1>
        <p className="text-sm text-gray-700">Crie o documento no Firestore:</p>
        <pre className="text-xs bg-gray-100 p-2 rounded mt-2">
          {`Coleção: superusers
Doc ID: ${uid ?? "(seu uid)"}
Campos (opcional): { createdAt: Date.now() }`}
        </pre>
        <p className="text-xs text-gray-500 mt-2">projectId: <b>{projectId ?? "(desconhecido)"}</b> · uid: <b>{uid}</b></p>
        <a className="text-blue-600 underline text-sm mt-3 inline-block" href="/">Voltar</a>
      </Box>
    );
  }
  if (state === "error") {
    return (
      <Box>
        <h1 className="text-lg font-semibold mb-2">Erro ao checar permissões</h1>
        <p className="text-sm text-red-600 break-words">{err}</p>
        <p className="text-xs text-gray-500 mt-2">projectId: <b>{projectId ?? "(?)"}</b> · uid: <b>{uid}</b></p>
      </Box>
    );
  }
  return null;
}
