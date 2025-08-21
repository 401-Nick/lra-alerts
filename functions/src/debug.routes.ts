/**
 * @fileoverview Debug and utility routes for testing and development.
 * Not for production use.
 */

import { Router } from "express";
import { createHash } from "crypto";
import { getStorage } from "firebase-admin/storage";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { fetchAllArcgisRows, rowsToCsv, type LraRow } from "./arcgis";
import { addedAlert, removedAlert, changedAlert } from "./alertEngine";
import express from "express";

const router = Router();
const db = getFirestore();
const storage = getStorage();

const DEBUG = process.env.DEBUG === 'true';
const MAX_BATCH_OPERATIONS = 450;
const MERGE_WRITES = false;



/**
 * Normalizes a value by trimming strings.
 * @param v The value to normalize.
 * @returns The normalized value.
 */
// const canonicalize = (v: any): string | number | null => (v == null ? null : typeof v === "string" ? v.trim() : v);

/**
 * Creates a SHA1 hash of the listing's content to detect changes.
 * @param row The listing row.
 * @returns A SHA1 hash.
 */
function contentFingerprint(row: LraRow): string {
  return createHash("sha1").update(JSON.stringify(row)).digest("hex");
}

/**
 * Formats a row for Firestore, adding metadata.
 * @param row The listing row.
 * @param hash The content hash.
 * @returns The Firestore document.
 */
function buildListingDoc(row: LraRow, hash: string) {
  const address = (row.address ?? "").toLowerCase();
  
  // Create the addressKeywords array by splitting the address
  // and filtering out common stop words if desired.
  const addressKeywords = address.split(/\s+/).filter(Boolean);

  return {
    ...row,
    id: row.id,
    addressLower: address,
    addressKeywords: addressKeywords, // <-- ADD THIS FIELD
    removed: false,
    contentHash: hash,
    updatedAt: FieldValue.serverTimestamp(),
  };
}


/**
 * Commits a batch and returns a new one to avoid exceeding Firestore's batch limit.
 * @param batch The batch to commit.
 * @returns A new batch.
 */
async function commitBatch(batch: FirebaseFirestore.WriteBatch) {
  await batch.commit();
  return db.batch();
}

/**
 * Logs a debug message if debugging is enabled.
 * @param message The message to log.
 */
function debugLog(message: string) {
  if (DEBUG) console.log(`[debug! index] ${message}`);
}

/**
 * Diffs and upserts rows to Firestore, identifying added, changed, and removed listings.
 * @param rows The rows to upsert.
 * @returns An object with the results of the upsert.
 */
async function upsertToFirestore(rows: LraRow[]) {
    if (rows.length === 0) {
        console.log("[upsertToFirestore] No rows to upsert.");
        return { added: [], changed: [], removed: [], unchangedCount: 0 };
    }

    debugLog(`[upsertToFirestore] Upserting ${rows.length} rows to Firestore...`);
    
    try {
        const coll = db.collection("listings");
        const snap = await coll.select("contentHash", "removed").get();
        const existing = new Map(snap.docs.map(d => [d.id, d.data() as { contentHash: string | null; removed: boolean }]));
        const incomingIds = new Set(rows.map((r) => r.id));

        const added: LraRow[] = [], changed: LraRow[] = [], removed: LraRow[] = [];
        let unchangedCount = 0;
        let batch = db.batch();
        let ops = 0;

        for (const row of rows) {
            const hash = contentFingerprint(row);
            const prev = existing.get(row.id);

            if (!prev) {
                added.push(row);
                batch.set(coll.doc(row.id), buildListingDoc(row, hash), { merge: MERGE_WRITES });
                ops++;
            } else if (prev.contentHash !== hash || prev.removed) {
                changed.push(row);
                batch.set(coll.doc(row.id), buildListingDoc(row, hash), { merge: MERGE_WRITES });
                ops++;
            } else {
                unchangedCount++;
            }

            if (ops >= MAX_BATCH_OPERATIONS) {
                batch = await commitBatch(batch);
                ops = 0;
            }
        }

        const idsToRemove = snap.docs.filter(doc => !incomingIds.has(doc.id) && !doc.data().removed).map(doc => doc.id);
        
        if (idsToRemove.length > 0) {
            const removedDocsSnap = await db.getAll(...idsToRemove.map(id => coll.doc(id)));
            for (const doc of removedDocsSnap) {
                if (doc.exists) {
                    removed.push(doc.data() as LraRow);
                    batch.update(doc.ref, { removed: true, removedAt: FieldValue.serverTimestamp() });
                    ops++;

                    if (ops >= MAX_BATCH_OPERATIONS) {
                        batch = await commitBatch(batch);
                        ops = 0;
                    }
                }
            }
        }
        
        if (ops > 0) {
            await batch.commit();
        }

        return { added, changed, removed, unchangedCount };
    } catch (error: any) {
        console.error("[upsertToFirestore] Error:", error);
        return { added: [], changed: [], removed: [], unchangedCount: 0 };
    }
}

/**
 * Writes a CSV of the listings to Firebase Storage.
 * @param rows The listings to write.
 * @returns The bucket, path, and public URL of the CSV.
 */
async function writeCsvToStorage(rows: LraRow[]) {
    console.log("[writeCsvToStorage] Writing CSV to storage...");
    const csv = rowsToCsv(rows);
    const bucket = storage.bucket();
    const stamp = new Date().toISOString().slice(0, 10);
    const path = `exports/lra_available_${stamp}.csv`;
    const file = bucket.file(path);

    await file.save(csv, { resumable: false, contentType: "text/csv; charset=utf-8", metadata: { cacheControl: "no-cache" } });
    const [url] = await file.getSignedUrl({ action: "read", expires: Date.now() + 1000 * 60 * 60 * 24 * 7 });
    
    return { bucket: bucket.name, path, publicUrl: url };
}

/**
 * Main data ingestion process.
 * Fetches data, upserts to Firestore, writes a CSV, and updates selection data.
 */
async function runIngest() {
    try {
        console.log("[runIngest] Starting data ingest from ArcGIS.");
        
        // 'rows' is now correctly typed as LraRow[], which matches the expectations
        // of downstream functions like upsertToFirestore.
        const rows: LraRow[] = await fetchAllArcgisRows();
        console.log(`[runIngest] Fetched ${rows.length} rows from ArcGIS.`);

        // const normalizedRows = normalizeRows(rows);
        // console.log(`[runIngest] Normalized ${normalizedRows.length} rows.`);

        const diff = await upsertToFirestore(rows);
        console.log(`[runIngest] Upserted data: ${diff.added.length} added, ${diff.changed.length} changed, ${diff.removed.length} removed, ${diff.unchangedCount} unchanged.`);

        const alertCount = diff.added.length + diff.changed.length + diff.removed.length;
        if (alertCount > 0) {
            console.log(`[runIngest] Processing ${alertCount} alerts.`);
            const alertPromises = [
                ...diff.added.map(addedAlert),
                ...diff.changed.map(changedAlert),
                ...diff.removed.map(removedAlert)
            ];
            await Promise.allSettled(alertPromises);
        }

        // writeCsvToStorage calls rowsToCsv, which now correctly handles LraRow[].
        const csvResult = await writeCsvToStorage(rows);
        const summary = { 
            new: diff.added.length, 
            changed: diff.changed.length, 
            removed: diff.removed.length, 
            unchanged: diff.unchangedCount, 
            total: rows.length 
        };

        const aggregateSelections = async (field: string): Promise<string[]> => {
            const snapshot = await db.collection("listings").select(field).where("removed", "==", false).get();
            const values = new Set<string>();
            snapshot.docs.forEach(doc => {
                const value = doc.data()[field];
                if (value) values.add(String(value));
            });
            return Array.from(values).sort();
        };

        // Aggregating all distinct values for filter dropdowns
        const [knownZips, knownNeighborhoods, knownWards, knownUsages, knownStatuses, knownPropertyTypes] = await Promise.all([
            aggregateSelections("zip"),
            aggregateSelections("neighborhood"),
            aggregateSelections("ward"),
            aggregateSelections("usage"),
            aggregateSelections("Status"),
            aggregateSelections("PropertyType"),
        ]);

        console.log(`[runIngest] Aggregated selections updated.`);

        await db.doc("exports/current").set({
            ...summary,
            csv: csvResult,
            updatedAt: FieldValue.serverTimestamp(),
            knownZips,
            knownNeighborhoods,
            knownWards,
            knownUsages,
            knownStatuses,
            knownPropertyTypes,
        }, { merge: true });

        console.log("[runIngest] Ingest process completed successfully.");
        return { ...summary, csv: csvResult };
    } catch (error: any) {
        console.error("[runIngest] Error during ingest:", error);
        throw error;
    }
}



/**
 * Ingest Endpoint: (Protected by secret key)
 * Triggers the data ingestion process.
 */
router.post("/ingest", async (req: express.Request, res: express.Response) => {
    console.log("[ingest] Ingest endpoint called.");
    const expectedSecret = process.env.INGEST_SECRET;
    if (!expectedSecret || req.get("x-ingest-key") !== expectedSecret) {
        return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    try {
        const result = await runIngest();
        return res.json({ ok: true, ...result });
    } catch (e: any) {
        console.error("[ingest] Error:", e);
        return res.status(500).json({ ok: false, error: e?.message || "Ingest failed." });
    }
});

/**
 * Wipe Endpoint: (For Testing)
 * Clears the listings collection. (Protected by secret key)
 */
router.post("/wipe", async (req: express.Request, res: express.Response) => {
    console.log("[wipe] Wipe endpoint called.");
    const expectedSecret = process.env.INGEST_SECRET;
    if (!expectedSecret || req.get("x-ingest-key") !== expectedSecret) {
        return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    try {
        const coll = db.collection("listings");
        const snap = await coll.get();
        if (snap.empty) {
            return res.json({ ok: true, message: "No documents to delete." });
        }

        let batch = db.batch();
        let ops = 0;
        for (const doc of snap.docs) {
            batch.delete(doc.ref);
            ops++;
            if (ops >= MAX_BATCH_OPERATIONS) {
                await batch.commit();
                batch = db.batch();
                ops = 0;
            }
        }
        if (ops > 0) {
            await batch.commit();
        }

        return res.json({ ok: true, message: `Deleted ${snap.size} documents.` });
    } catch (e: any) {
        console.error("[wipe] Error:", e);
        return res.status(500).json({ ok: false, error: e?.message || "Failed to wipe listings." });
    }
});

export default router;