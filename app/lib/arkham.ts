const API_KEY = process.env.ARKHAM_API_KEY ?? "";
const BASE = "https://api.arkhamintelligence.com";

export interface ArkhamData {
  entityName: string | null;
  entityType: string | null;
  labels: string[];
  isInstitutional: boolean;
}

const _cache = new Map<string, { data: ArkhamData; ts: number }>();
const TTL = 5 * 60_000;

const INSTITUTIONAL_TYPES = [
  "exchange", "fund", "institutional", "venture", "miner", "custodian",
  "market maker", "investment", "hedge",
];

async function apiFetch(path: string): Promise<unknown> {
  if (!API_KEY) return null;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "API-Key": API_KEY },
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    clearTimeout(tid);
    return null;
  }
}

export async function fetchArkhamData(address: string): Promise<ArkhamData> {
  const hit = _cache.get(address);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  const empty: ArkhamData = {
    entityName: null,
    entityType: null,
    labels: [],
    isInstitutional: false,
  };
  if (!API_KEY) return empty;

  const raw = await apiFetch(`/intelligence/address/${address}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = raw as any;
  if (!d) {
    _cache.set(address, { data: empty, ts: Date.now() });
    return empty;
  }

  const entity = d.arkhamEntity ?? d.entity ?? null;
  const labelObj = d.arkhamLabel ?? null;
  const labels: string[] = [];
  if (labelObj?.name) labels.push(labelObj.name);
  if (entity?.type && !labels.includes(entity.type)) labels.push(entity.type);

  const allText = [...labels, entity?.name ?? "", entity?.type ?? ""]
    .join(" ")
    .toLowerCase();
  const isInstitutional = INSTITUTIONAL_TYPES.some(t => allText.includes(t));

  const result: ArkhamData = {
    entityName: entity?.name ?? labelObj?.name ?? d.name ?? null,
    entityType: entity?.type ?? null,
    labels,
    isInstitutional,
  };

  _cache.set(address, { data: result, ts: Date.now() });
  return result;
}

export function formatArkham(d: ArkhamData): string {
  if (!API_KEY || (!d.entityName && d.labels.length === 0)) return "";
  const parts: string[] = [];
  if (d.entityName) parts.push(`エンティティ:${d.entityName}`);
  if (d.entityType) parts.push(`種別:${d.entityType}`);
  if (d.isInstitutional) parts.push("機関投資家確認✅");
  return parts.length > 0 ? `Arkham[${parts.join(", ")}]` : "";
}
