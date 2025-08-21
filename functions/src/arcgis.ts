// lra-alerts/functions/src/arcgis.ts
/* ============================================================================
 * ArcGIS Helpers for Firestore/CSV (Cloud Functions)
 * Cleaned + structured + typed
 * ==========================================================================*/

import { csvFormat } from "d3-dsv";
import { randomUUID as nodeRandomUUID } from "crypto";

/* ============================================================================
 * Types
 * ==========================================================================*/
export type NormalizedLraRow = {
  id: string;
  parcelId: string | null;
  address: string | null;
  neighborhood: string | null;
  ward: number | null;
  zip: string | null;
  sqft: number | null;
  usage: string | null;
  status: string | null;
};



export type LraRow = {
  // ArcGIS raw fields (subset — include as needed)
  OBJECTID: number | null;
  Shape: unknown | null; // Geometry object; refine if using ArcGIS types
  GDB_GEOMATTR_DATA: unknown | null;

  AddrNum: string | null;
  ADDRESS: string | null;
  LowAddrNum: number | null;
  LowAddrSuf: string | null;
  HighAddrNum: number | null;
  HighAddrSuf: string | null;
  StPreDir: string | null;
  StName: string | null;
  StType: string | null;
  StSufDir: string | null;

  Handle: string | null;
  CityBlock: number | null;
  Parcel: number | null;
  ParcelId: string | null;
  GUID: string | null;

  WARD: number | null;
  NEIGHBORHOOD_NUM: number | null;
  ZipCode: number | null;
  SQFT: number | null;

  Underground_Storage: string | null;
  Irregular_Lot: string | null;
  Description: string | null;
  Acres: number | null;
  Status: string | null;
  Stories: number | null;
  Usage: string | null;
  Environmental: string | null;
  Deed_Restriction: string | null;

  Record_No: number | null;
  Class: string | null;
  Field: number | null;
  LRA_PRICING: number | null;
  Featured: string | null;
  AssessorsTotal: number | null;
  Frontage: number | null;
  NbrOfUnits: number | null;
  LegalDescription: string | null;
  AssessorsNbrhdNum: number | null;
  LOCATION: string | null;
  PublicNotice: string | null;
  PropertyType: string | null;
  BuriedMaterials: string | null;
  SideLotEligible: string | null;

  // Normalized core fields
  id: string;
  parcelId: string | null;
  address: string | null;
  neighborhood: string | null;
  ward: number | null;
  zip: string | null;
  sqft: number | null;
  usage: string | null;
  status: string | null;
};

/* ============================================================================
 * Utilities
 * ==========================================================================*/


function tokenAsParam(): boolean {
  return String(process.env.ARCGIS_TOKEN_AS_PARAM ?? "false").toLowerCase() === "true";
}

function uniqIdFallback(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function genUuid(): string {
  try {
    if (typeof nodeRandomUUID === "function") return nodeRandomUUID();
    if (globalThis?.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    // ignore; fall through
  }
  return uniqIdFallback();
}

function normZip(raw: unknown): string | null {
  if (raw == null) return null;
  const digits = String(raw).trim().replace(/\D+/g, "");
  return digits ? digits.slice(0, 5).padStart(5, "0") : null;
}

function pickAttr<T = unknown>(attrs: Record<string, any> | null | undefined, aliases: string[]): T | null {
  if (!attrs) return null;
  for (const alias of aliases) {
    if (attrs[alias] != null) return attrs[alias] as T;
  }
  return null;
}

function joinParams(
  params: Record<string, string | number | boolean | undefined | null>,
): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null) p.append(k, String(v));
  }
  return p;
}

function sqlQuote(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

/* ============================================================================
 * Config
 * ==========================================================================*/

interface ArcgisConfig {
  layerUrl: string;
  fields: string[];
  outFields: string;
  pageSize: number;
  batchSize: number;
  includeComingSoon: boolean;
  neighborhoodField: string;
}

function getConfig(): ArcgisConfig {
  const layerUrl = process.env.ARCGIS_LAYER_URL;
  if (!layerUrl) throw new Error("Missing ARCGIS_LAYER_URL");

  const ALL_FIELDS_FALLBACK = [
    "OBJECTID","Shape","GDB_GEOMATTR_DATA","AddrNum","ADDRESS","LowAddrNum","LowAddrSuf",
    "HighAddrNum","HighAddrSuf","StPreDir","StName","StType","StSufDir","Handle",
    "CityBlock","Parcel","ParcelId","GUID","WARD","NEIGHBORHOOD_NUM","ZipCode","SQFT",
    "Underground_Storage","Irregular_Lot","Description","Acres","Status","Stories","Usage",
    "Environmental","Deed_Restriction","Record_No","Class","Field","LRA_PRICING","Featured",
    "AssessorsTotal","Frontage","NbrOfUnits","LegalDescription","AssessorsNbrhdNum","LOCATION",
    "PublicNotice","PropertyType","BuriedMaterials","SideLotEligible",
    // also include common alias candidates
    "Neighborhood","NEIGHBORHOOD","NeighborhoodName",
  ].join(",");

  const rawFields = process.env.ARCGIS_FIELDS ?? ALL_FIELDS_FALLBACK;

  // sanitize + de-dupe (case-insensitive)
  const seen = new Set<string>();
  const fields = rawFields
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((f) => {
      const key = f.toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (!fields.map((s) => s.toUpperCase()).includes("OBJECTID")) fields.unshift("OBJECTID");

  const nf = (process.env.ARCGIS_NEIGHBORHOOD_FIELD ?? "NEIGHBORHOOD_NUM").trim();
  if (!fields.map((s) => s.toUpperCase()).includes(nf.toUpperCase())) fields.push(nf);

  const coerce = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  return {
    layerUrl,
    fields,
    outFields: fields.join(","),
    pageSize: coerce(process.env.ARCGIS_PAGE_SIZE, 2000),
    batchSize: coerce(process.env.ARCGIS_BATCH_SIZE, 500),
    includeComingSoon: String(process.env.INCLUDE_COMING_SOON ?? "true").toLowerCase() === "true",
    neighborhoodField: nf,
  };
}

/* ============================================================================
 * Auth (none | static | oauth)
 * ==========================================================================*/

type AuthMode = "none" | "static" | "oauth";

function getAuthMode(): AuthMode {
  const m = (process.env.ARCGIS_AUTH_MODE ?? "oauth").toLowerCase();
  return m === "none" || m === "static" || m === "oauth" ? m : "oauth";
}

interface ArcgisOAuthConfig {
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
}

function getOauthConfig(): ArcgisOAuthConfig {
  return {
    tokenUrl: process.env.ARCGIS_OAUTH_TOKEN_URL,
    clientId: process.env.ARCGIS_OAUTH_CLIENT_ID,
    clientSecret: process.env.ARCGIS_OAUTH_CLIENT_SECRET,
  };
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function getArcgisToken(forceRefresh = false): Promise<string | undefined> {
  const mode = getAuthMode();
  if (mode === "none") return undefined;
  if (mode === "static") return process.env.ARCGIS_TOKEN;

  const now = Date.now();
  if (!forceRefresh && cachedToken && cachedToken.expiresAt - 60_000 > now) {
    return cachedToken.accessToken;
  }

  const { tokenUrl, clientId, clientSecret } = getOauthConfig();
  if (!tokenUrl || !clientId || !clientSecret) throw new Error("Missing OAuth environment variables.");

  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("f", "json");

  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const txt = await resp.text();
  if (!resp.ok) throw new Error(`OAuth token HTTP ${resp.status}: ${txt}`);

  let json: any;
  try {
    json = JSON.parse(txt);
  } catch {
    throw new Error(`OAuth token non-JSON: ${txt.slice(0, 400)}`);
  }

  const accessToken: string | undefined = json.access_token || json.accessToken;
  const expiresIn: number = Number(json.expires_in ?? json.expiresIn ?? 3600);
  if (!accessToken) throw new Error(`OAuth response missing access_token: ${txt.slice(0, 400)}`);

  cachedToken = {
    accessToken,
    expiresAt: now + Math.max(30_000, expiresIn * 1000),
  };

  return accessToken;
}

function authHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/* ============================================================================
 * Query Builders
 * ==========================================================================*/

export function buildWhere(includeComingSoon: boolean): string {
  const base = (process.env.ARCGIS_STATUS_AVAILABLE ?? "Available")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

  const coming = (process.env.ARCGIS_STATUS_COMING ?? "PROPNS|PROPNS Available")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

  const set = includeComingSoon ? base.concat(coming) : base;
  if (set.length === 0) return "1=1"; // fail-safe
  return `Status IN (${set.map(sqlQuote).join(",")})`;
}

/* ============================================================================
 * Field Normalization
 * ==========================================================================*/

type NormalizedKey = "parcelId" | "address" | "ward" | "zip" | "sqft" | "usage" | "status" | "neighborhood";

const FIELD_ALIASES: Record<NormalizedKey, string[]> = {
  parcelId: ["ParcelId", "PARCELID", "Parcel", "PARCEL"],
  address: ["ADDRESS", "Address", "AddrNum", "Addr", "AddressNum", "LOCATION"],
  ward: ["WARD", "Ward", "Wards"],
  zip: ["ZipCode", "ZIPCODE", "Zip", "ZIP", "PostalCode", "POSTALCODE"],
  sqft: ["SQFT", "SqFt", "SquareFeet", "Square_Footage"],
  usage: ["Usage", "PropertyType", "PROPERTYTYPE", "Use", "Zoning"],
  status: ["Status", "STATUS", "State", "Condition"],
  neighborhood: ["NEIGHBORHOOD_NUM", "Neighborhood", "NEIGHBORHOOD", "NeighborhoodName"],
};

/* ============================================================================
 * Attribute → Row Conversion
 * ==========================================================================*/

function toRow(attrs: Record<string, any>): LraRow {
  const sqftRaw = pickAttr<any>(attrs, FIELD_ALIASES.sqft);
  const sqft = typeof sqftRaw === "number" && Number.isFinite(sqftRaw)
    ? sqftRaw
    : typeof sqftRaw === "string"
      ? Number(sqftRaw)
      : null;

  const parcel = pickAttr<any>(attrs, FIELD_ALIASES.parcelId);
  const objectId = (attrs?.OBJECTID ?? attrs?.ObjectId) as number | undefined;
  const id = (parcel && String(parcel)) || (objectId != null && String(objectId)) || genUuid();

  const wardRaw = pickAttr<any>(attrs, FIELD_ALIASES.ward);
  const ward = typeof wardRaw === "number" && Number.isFinite(wardRaw) ? wardRaw : Number(wardRaw);
  const zip = normZip(pickAttr<any>(attrs, FIELD_ALIASES.zip));

  return {
    // raw passthroughs (best-effort; absent fields are null)
    OBJECTID: objectId ?? null,
    Shape: attrs?.Shape ?? null,
    GDB_GEOMATTR_DATA: attrs?.GDB_GEOMATTR_DATA ?? null,

    AddrNum: attrs?.AddrNum ?? null,
    ADDRESS: attrs?.ADDRESS ?? null,
    LowAddrNum: attrs?.LowAddrNum ?? null,
    LowAddrSuf: attrs?.LowAddrSuf ?? null,
    HighAddrNum: attrs?.HighAddrNum ?? null,
    HighAddrSuf: attrs?.HighAddrSuf ?? null,
    StPreDir: attrs?.StPreDir ?? null,
    StName: attrs?.StName ?? null,
    StType: attrs?.StType ?? null,
    StSufDir: attrs?.StSufDir ?? null,

    Handle: attrs?.Handle ?? null,
    CityBlock: attrs?.CityBlock ?? null,
    Parcel: attrs?.Parcel ?? null,
    ParcelId: attrs?.ParcelId ?? null,
    GUID: attrs?.GUID ?? null,

    WARD: attrs?.WARD ?? null,
    NEIGHBORHOOD_NUM: attrs?.NEIGHBORHOOD_NUM ?? null,
    ZipCode: attrs?.ZipCode ?? null,
    SQFT: attrs?.SQFT ?? null,

    Underground_Storage: attrs?.Underground_Storage ?? null,
    Irregular_Lot: attrs?.Irregular_Lot ?? null,
    Description: attrs?.Description ?? null,
    Acres: attrs?.Acres ?? null,
    Status: attrs?.Status ?? null,
    Stories: attrs?.Stories ?? null,
    Usage: attrs?.Usage ?? null,
    Environmental: attrs?.Environmental ?? null,
    Deed_Restriction: attrs?.Deed_Restriction ?? null,

    Record_No: attrs?.Record_No ?? null,
    Class: attrs?.Class ?? null,
    Field: attrs?.Field ?? null,
    LRA_PRICING: attrs?.LRA_PRICING ?? null,
    Featured: attrs?.Featured ?? null,
    AssessorsTotal: attrs?.AssessorsTotal ?? null,
    Frontage: attrs?.Frontage ?? null,
    NbrOfUnits: attrs?.NbrOfUnits ?? null,
    LegalDescription: attrs?.LegalDescription ?? null,
    AssessorsNbrhdNum: attrs?.AssessorsNbrhdNum ?? null,
    LOCATION: attrs?.LOCATION ?? null,
    PublicNotice: attrs?.PublicNotice ?? null,
    PropertyType: attrs?.PropertyType ?? null,
    BuriedMaterials: attrs?.BuriedMaterials ?? null,
    SideLotEligible: attrs?.SideLotEligible ?? null,

    // normalized core
    id,
    parcelId: parcel ? String(parcel) : null,
    address: (pickAttr<any>(attrs, FIELD_ALIASES.address) as any) ?? null,
    neighborhood: (pickAttr<any>(attrs, FIELD_ALIASES.neighborhood) as any) ?? null,
    ward: Number.isFinite(ward) ? Number(ward) : null,
    zip,
    sqft: Number.isFinite(sqft) ? Number(sqft) : null,
    usage: (pickAttr<any>(attrs, FIELD_ALIASES.usage) as any) ?? null,
    status: (pickAttr<any>(attrs, FIELD_ALIASES.status) as any) ?? null,
  };
}





/* ============================================================================
 * Retry Wrapper
 * ==========================================================================*/

async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  let attempt = 0;
  let delay = 300;
  for (;;) {
    try {
      return await fn();
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (/(^|[^0-9])(401|498|499)([^0-9]|$)/.test(msg)) throw e; // non-retryable auth
      if (++attempt > retries) throw e;
      await new Promise((r) => setTimeout(r, delay + Math.random() * 300));
      delay *= 2;
    }
  }
}




/* ============================================================================
 * ArcGIS POST
 * ==========================================================================*/

async function arcgisPost(
  url: string,
  params: Record<string, string | number | boolean | undefined>,
  token?: string,
): Promise<any> {
  const mode = getAuthMode();

  async function doCall(effectiveToken?: string, tokenViaParam = false) {
    const effectiveParams = { ...params } as any;
    if (effectiveToken && tokenViaParam) effectiveParams.token = effectiveToken;

    const body = joinParams(effectiveParams);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        ...(effectiveToken && !tokenViaParam ? authHeaders(effectiveToken) : {}),
      },
      body,
      cache: "no-store",
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);

    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Non-JSON from ArcGIS: ${text.slice(0, 500)}`);
    }

    if (json?.error) {
      throw new Error(
        `ArcGIS error ${json.error.code}: ${json.error.message} ${JSON.stringify(json.error.details ?? [])}`,
      );
    }

    return json;
  }

  const initialToken = token ?? (mode !== "none" ? await getArcgisToken() : undefined);
  const preferParam = tokenAsParam();

  try {
    return await withRetry(() => doCall(initialToken, preferParam), 3);
  } catch (e: any) {
    const msg = String(e?.message || e);
    const isAuthErr = /(HTTP\s*401|ArcGIS error\s*(498|499))/.test(msg);
    if (!isAuthErr || token) throw e;

    if (mode === "oauth") {
      try {
        const refreshed = await getArcgisToken(true);
        return await doCall(refreshed, preferParam);
      } catch {
        // fall through
      }
    }

    const effective = initialToken ?? (mode === "oauth" ? await getArcgisToken() : undefined);
    return await doCall(effective, !preferParam);
  }
}




/* ============================================================================
 * ArcGIS Queries (low-level)
 * ==========================================================================*/

async function queryAttributesOnce(
  layerUrl: string,
  params: Record<string, string | number | boolean>,
  token?: string,
): Promise<Record<string, any>[]> {
  const url = `${layerUrl.replace(/\/$/, "")}/query`;
  const json = await arcgisPost(url, params, token);
  return Array.isArray(json.features) ? json.features.map((f: any) => f?.attributes ?? {}) : [];
}




/* ============================================================================
 * Data Fetchers
 * ==========================================================================*/

async function fetchObjectIds(
  layerUrl: string,
  where: string,
  pageSize: number,
  token?: string,
): Promise<number[]> {
  const url = `${layerUrl.replace(/\/$/, "")}/query`;
  let offset = 0;
  const ids: number[] = [];

  // eslint-disable-next-line no-constant-condition
  for (;;) {
    const json = await arcgisPost(
      url,
      {
        where,
        returnIdsOnly: true,
        orderByFields: "OBJECTID",
        f: "json",
        resultRecordCount: pageSize,
        resultOffset: offset,
      },
      token,
    );

    const chunk: number[] = Array.isArray(json.objectIds) ? json.objectIds : [];
    ids.push(...chunk);

    const exceeded = !!json.exceededTransferLimit;
    if (chunk.length < pageSize && !exceeded) break;

    offset += pageSize;
  }

  return ids;
}

async function fetchByObjectIdBatches(
  layerUrl: string,
  ids: number[],
  outFields: string,
  batchSize: number,
  token?: string,
): Promise<LraRow[]> { // <<< Ensure this returns Promise<LraRow[]>
  const rows: LraRow[] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const slice = ids.slice(i, i + batchSize).join(",");
    const attrs = await queryAttributesOnce(
      layerUrl,
      {
        objectIds: slice,
        outFields,
        returnGeometry: false,
        f: "json",
      },
      token,
    );
    // CORRECT: attrs.map(toRow) creates an array of the full LraRow objects.
    // We push these directly into our `rows` array.
    rows.push(...attrs.map(toRow));
  }
  return rows; // <<< This now correctly returns LraRow[]
}





/* ============================================================================
 * High-level Fetchers
 * ==========================================================================*/

export async function fetchAllArcgisRows(token?: string): Promise<LraRow[]> {
  const config = getConfig();
  const where = buildWhere(config.includeComingSoon);

  const ids = await fetchObjectIds(config.layerUrl, where, config.pageSize, token);
  if (ids.length === 0) return [];

  return await fetchByObjectIdBatches(
    config.layerUrl,
    ids,
    config.outFields,
    config.batchSize,
    token,
  );
}

/* ============================================================================
 * CSV Conversion
 * ==========================================================================*/

export function rowsToCsv(rows: LraRow[]): string {
  return csvFormat(rows);
}
/* ============================================================================
 * Neighborhood Fetcher
 * ==========================================================================*/

export async function fetchNeighborhoodNames(token?: string): Promise<string[]> {
  const config = getConfig();
  const field = config.neighborhoodField;
  const pageSize = config.pageSize;
  let offset = 0;
  const set = new Set<string>();

  // eslint-disable-next-line no-constant-condition
  for (;;) {
    const attrs = await queryAttributesOnce(
      config.layerUrl,
      {
        where: "1=1",
        outFields: field,
        returnGeometry: false,
        returnDistinctValues: true,
        orderByFields: `${field} ASC`,
        f: "json",
        resultRecordCount: pageSize,
        resultOffset: offset,
      },
      token,
    );

    for (const a of attrs) {
      const v = a?.[field];
      if (v != null) {
        const name = String(v).trim();
        if (name) set.add(name);
      }
    }

    if (attrs.length < pageSize) break;
    offset += pageSize;
  }

  return Array.from(set).sort((a, b) => a.localeCompare(b));
}