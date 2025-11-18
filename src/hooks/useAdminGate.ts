"use client";
import { useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

export type AdminState = "loading" | "no-auth" | "not-super" | "ok" | "error";

function useAdminGate() {
  const [state, setState] = useState<AdminState>("loading");
  const [uid, setUid] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    try {
      // @ts-ignore
      setProjectId((db as any)?.app?.options?.projectId ?? null);
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (u) => {
      if (!u) {
        setUid(null);
        setState("no-auth");
        return;
      }
      setUid(u.uid);
      try {
        const snap = await getDoc(doc(db, "superusers", u.uid));
        setState(snap.exists() ? "ok" : "not-super");
      } catch (e: any) {
        setErr(e?.message || String(e));
        setState("error");
      }
    });
    return () => unsub();
  }, []);

  return { state, uid, projectId, err };
}

export { useAdminGate };     // named
export default useAdminGate; // default
