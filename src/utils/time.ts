// src/utils/time.ts
export const toMs = (v: unknown): number =>
  v && typeof (v as any).toMillis === "function"
    ? (v as any).toMillis()
    : typeof v === "number"
    ? (v as number)
    : 0;
