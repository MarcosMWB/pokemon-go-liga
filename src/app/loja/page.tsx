"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, where } from "firebase/firestore";

type Produto = {
  id: string;
  nome: string;
  descricao: string;
  preco: number;
  preco_promocional?: number;
  imagem?: string;
  link_compra?: string;
};

export default function LojaPage() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        // pega só os ativos
        const q = query(
          collection(db, "produtos_loja"),
          where("ativo", "==", true)
        );
        const snap = await getDocs(q);
        const list: Produto[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            nome: data.nome,
            descricao: data.descricao,
            preco: data.preco,
            preco_promocional: data.preco_promocional,
            imagem: data.imagem,
            link_compra: data.link_compra,
          };
        });
        setProdutos(list);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="space-y-6">
      {/* cabeçalho da loja */}
      <div className="bg-white rounded-lg p-4 border">
        <h1 className="text-2xl font-bold mb-1">Loja da Liga</h1>
        <p className="text-sm text-gray-500">
          Produtos de Pokémon GO, temático da Região Oceãnica de Niterói, uma das maiores e mais ativas comunidade do Brasil.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Carregando produtos...</p>
      ) : produtos.length === 0 ? (
        <p className="text-sm text-gray-500">Nenhum produto disponível agora.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {produtos.map((p) => (
            <div
              key={p.id}
              className="bg-white border rounded-lg overflow-hidden flex flex-col"
            >
              <div className="relative w-full h-40 bg-gray-100">
                {p.imagem ? (
                    <Image
                      src={p.imagem}
                      alt={p.nome}
                      fill
                      className="object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">
                      sem imagem
                    </div>
                  )}
              </div>
              <div className="p-4 flex-1 flex flex-col">
                <h2 className="font-semibold">{p.nome}</h2>
                <p className="text-xs text-gray-500 mb-2">
                  {p.descricao}
                </p>

                <div className="mb-3">
                  {p.preco_promocional ? (
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold text-green-600">
                        R$ {p.preco_promocional.toFixed(2)}
                      </span>
                      <span className="text-xs line-through text-gray-400">
                        R$ {p.preco.toFixed(2)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-lg font-bold text-gray-800">
                      R$ {p.preco.toFixed(2)}
                    </span>
                  )}
                </div>

                <div className="mt-auto">
                  {p.link_compra ? (
                    <a
                      href={p.link_compra}
                      target="_blank"
                      rel="noreferrer"
                      className="block w-full text-center bg-yellow-500 hover:bg-yellow-600 text-white py-2 rounded text-sm"
                    >
                      Pedir agora
                    </a>
                  ) : (
                    <p className="text-xs text-gray-400">
                      Sem link de compra configurado.
                    </p>
                  )}
                  <p className="text-[10px] text-gray-400 mt-2">
                    * Produto enviado pelo fornecedor (dropshipping)
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
