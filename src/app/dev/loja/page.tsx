// src/app/dev/loja/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
} from "firebase/firestore";

type Produto = {
  id: string;
  nome: string;
  descricao: string;
  preco: number;
  preco_promocional?: number;
  imagem?: string;
  link_compra?: string;
  ativo: boolean;
};

export default function DevLojaPage() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [produtos, setProdutos] = useState<Produto[]>([]);

  // form
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [preco, setPreco] = useState("");
  const [precoPromocional, setPrecoPromocional] = useState("");
  const [imagem, setImagem] = useState("");
  const [linkCompra, setLinkCompra] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState("");

  // 1) auth + superuser
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }

      // checa se está na coleção superusers
      const q = query(
        collection(db, "superusers"),
        where("uid", "==", user.uid)
      );
      const snap = await getDocs(q);
      if (snap.empty) {
        setIsAdmin(false);
        router.replace("/");
        return;
      }

      setIsAdmin(true);
    });

    return () => unsub();
  }, [router]);

  // 2) ouvir produtos
  useEffect(() => {
    if (isAdmin !== true) return;

    const q = query(collection(db, "produtos_loja"));
    const unsub = onSnapshot(q, (snap) => {
      const list: Produto[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          nome: data.nome,
          descricao: data.descricao || "",
          preco: data.preco ?? 0,
          preco_promocional: data.preco_promocional,
          imagem: data.imagem,
          link_compra: data.link_compra,
          ativo: data.ativo === true,
        };
      });
      setProdutos(list);
    });

    return () => unsub();
  }, [isAdmin]);

  const handleCriar = async () => {
    setMsg("");
    if (!nome || !preco) {
      setMsg("Preencha pelo menos nome e preço.");
      return;
    }

    setSalvando(true);
    try {
      await addDoc(collection(db, "produtos_loja"), {
        nome,
        descricao,
        preco: Number(preco),
        preco_promocional: precoPromocional ? Number(precoPromocional) : null,
        imagem,
        link_compra: linkCompra,
        ativo: true,
        createdAt: Date.now(),
      });

      // limpa form
      setNome("");
      setDescricao("");
      setPreco("");
      setPrecoPromocional("");
      setImagem("");
      setLinkCompra("");
      setMsg("Produto criado!");
    } catch (e: any) {
      console.error(e);
      setMsg("Erro ao criar produto: " + e.message);
    } finally {
      setSalvando(false);
    }
  };

  const handleToggleAtivo = async (p: Produto) => {
    try {
      await updateDoc(doc(db, "produtos_loja", p.id), {
        ativo: !p.ativo,
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleExcluir = async (p: Produto) => {
    if (!confirm(`Excluir o produto "${p.nome}"?`)) return;
    try {
      await deleteDoc(doc(db, "produtos_loja", p.id));
    } catch (e) {
      console.error(e);
    }
  };

  if (isAdmin === null) return <p className="p-8">Carregando…</p>;
  if (isAdmin === false) return null;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">DEV / Loja</h1>
          <p className="text-sm text-gray-500">
            Aqui você cria e gerencia produtos do modelo dropshipping.
          </p>
        </div>
        <button
          onClick={() => router.push("/loja")}
          className="text-sm text-blue-600 underline"
        >
          Ver loja pública
        </button>
      </div>

      {/* form de criação */}
      <div className="bg-white border rounded p-4 space-y-3">
        <h2 className="font-semibold mb-1">Novo produto</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500">Nome</label>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="w-full border rounded px-2 py-1"
              placeholder="Ex: Capa Pokéball"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">Imagem...</label>
            <input
              value={imagem}
              onChange={(e) => setImagem(e.target.value)}
              className="w-full border rounded px-2 py-1"
              placeholder="/produtos/produto.png"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">Preço</label>
            <input
              type="number"
              step="0.01"
              value={preco}
              onChange={(e) => setPreco(e.target.value)}
              className="w-full border rounded px-2 py-1"
              placeholder="79.9"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">Preço promocional (opcional)</label>
            <input
              type="number"
              step="0.01"
              value={precoPromocional}
              onChange={(e) => setPrecoPromocional(e.target.value)}
              className="w-full border rounded px-2 py-1"
              placeholder="59.9"
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-gray-500">Descrição</label>
            <textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              className="w-full border rounded px-2 py-1"
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-gray-500">Link de compra (WhatsApp / checkout)</label>
            <input
              value={linkCompra}
              onChange={(e) => setLinkCompra(e.target.value)}
              className="w-full border rounded px-2 py-1"
              placeholder="https://wa.me/55..."
            />
          </div>
        </div>
        <button
          onClick={handleCriar}
          disabled={salvando}
          className="px-4 py-2 bg-green-600 text-white rounded text-sm disabled:opacity-50"
        >
          {salvando ? "Salvando..." : "Criar produto"}
        </button>
        {msg && <p className="text-sm mt-2">{msg}</p>}
      </div>

      {/* lista de produtos */}
      <div className="bg-white border rounded p-4 space-y-3">
        <h2 className="font-semibold mb-2">Produtos cadastrados</h2>
        {produtos.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum produto.</p>
        ) : (
          <div className="space-y-2">
            {produtos.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 border rounded px-3 py-2"
              >
                <div className="flex-1">
                  <p className="font-semibold flex items-center gap-2">
                    {p.nome}
                    {p.ativo ? (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
                        ativo
                      </span>
                    ) : (
                      <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">
                        inativo
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">
                    {p.descricao?.slice(0, 100)}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Preço: R$ {p.preco.toFixed(2)}
                    {p.preco_promocional ? (
                      <>
                        {" "}
                        | Promo: R$ {p.preco_promocional.toFixed(2)}
                      </>
                    ) : null}
                  </p>
                  {p.link_compra && (
                    <p className="text-[10px] text-gray-400 break-all">
                      {p.link_compra}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => handleToggleAtivo(p)}
                    className="text-xs px-3 py-1 rounded bg-slate-100 hover:bg-slate-200"
                  >
                    {p.ativo ? "Desativar" : "Ativar"}
                  </button>
                  <button
                    onClick={() => handleExcluir(p)}
                    className="text-xs px-3 py-1 rounded bg-red-500 text-white"
                  >
                    Excluir
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
