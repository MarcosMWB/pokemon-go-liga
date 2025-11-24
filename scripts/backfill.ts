// scripts/backfill.ts
import { readFileSync } from "fs";
import path from "path";
import { initializeApp, applicationDefault, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

function getArg(name: string): string | undefined {
  const p = `--${name}=`;
  const a = process.argv.find((x) => x.startsWith(p));
  return a ? a.slice(p.length) : undefined;
}

function initAdmin() {
  const credPath = getArg("cred");       // ex: --cred=C:\keys\sa.json
  let projectId =
    getArg("project") ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT;

  if (!getApps().length) {
    if (credPath) {
      const full = path.resolve(credPath);
      const json = JSON.parse(readFileSync(full, "utf8"));
      if (!projectId && json?.project_id) projectId = json.project_id;
      if (!projectId) {
        console.error("Defina --project=SEU_PROJECT_ID ou inclua project_id no JSON da service account.");
        process.exit(1);
      }
      initializeApp({ credential: cert(json), projectId });
    } else {
      // ADC (gcloud) ou variáveis de ambiente
      if (!projectId) {
        console.error(
          "ProjectId não detectado. Use --project=SEU_PROJECT_ID, ou defina GOOGLE_CLOUD_PROJECT, ou passe --cred=... com project_id."
        );
        process.exit(1);
      }
      initializeApp({ credential: applicationDefault(), projectId });
    }
    console.log("[backfill] usando projectId:", projectId);
  }
}

async function main() {
  initAdmin();
  const db = getFirestore();

  const snap = await db.collection("usuarios").get();

  let copiados = 0;
  let pulados = 0;
  let emailsRemovidos = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data() as any;
    const uid = docSnap.id;

    // só copia quem já está verificado
    if (!data?.verificado) {
      pulados++;
      continue;
    }

    const payload: any = {
      nome: data?.nome ?? null,
      friend_code: data?.friend_code ?? null,
      email: data?.email ?? null, // será removido do público após copiar
    };

    // preserva createdAt se existir
    if (data?.createdAt instanceof Timestamp) {
      payload.createdAt = data.createdAt;
    } else if (typeof data?.createdAt === "number" || data?.createdAt instanceof Date) {
      payload.createdAt = data.createdAt;
    }

    // upsert em /usuarios_private/{uid}
    await db.collection("usuarios_private").doc(uid).set(payload, { merge: true });

    // remove o email do doc público
    if (data?.email !== undefined) {
      await docSnap.ref.update({ email: FieldValue.delete() });
      emailsRemovidos++;
    }

    copiados++;
  }

  console.log(
    `Backfill concluído. Copiados: ${copiados}, Pulados (não verificados): ${pulados}, E-mails removidos: ${emailsRemovidos}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
