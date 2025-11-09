"use client";

import { useState } from "react";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/lib/firebase";

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg("");
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setMsg("Se existir conta com esse e-mail, o link foi enviado.");
    } catch (err: any) {
      setMsg(err.message || "Erro ao enviar e-mail.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <form
        onSubmit={handleReset}
        className="bg-white p-6 rounded shadow max-w-sm w-full"
      >
        <h1 className="text-xl font-bold mb-4">Recuperar senha</h1>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="seuemail@email.com"
          className="w-full border p-2 mb-3 rounded"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2 rounded disabled:opacity-50"
        >
          {loading ? "Enviando..." : "Enviar link"}
        </button>
        {msg && <p className="mt-3 text-sm text-gray-700">{msg}</p>}
      </form>
    </div>
  );
}
