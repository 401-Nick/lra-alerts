/**
 * @fileoverview Defines API routes for querying and retrieving property data.
 * Handles property searching, filtering, and fetching selection options.
 */

import { Router, Request, Response, NextFunction } from "express";
import { db } from "./index"; // Import the exported db instance
import { Query, DocumentData } from "firebase-admin/firestore";
import { z } from "zod";

const router = Router();

// ============================================================================
// Constants & Configuration
// ============================================================================

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 20;
const FIRESTORE_IN_QUERY_LIMIT = 30;
const TEXT_SEARCH_LIMIT = 50; // Per-field limit for prefix searches

// ============================================================================
// Request Validation & Sanitization (Using Zod)
// ============================================================================

// Helper to transform a comma-separated string or an array of numbers into a clean array
const numToArray = z.preprocess((v) => {
    if (!v) return undefined;
    const values = Array.isArray(v) ? v : String(v).split(',');
    return values.map(item => Number(item.trim())).filter(Boolean);
}, z.array(z.number().int()).min(1).optional());

// Helper to transform a comma-separated string or an array of strings into a clean array
const stringToArray = z.preprocess((v) => {
    if (!v) return undefined;
    const values = Array.isArray(v) ? v : String(v).split(',');
    return values.map(item => String(item).trim()).filter(Boolean);
}, z.array(z.string()).min(1).optional());

// Schema defining the expected query parameters, their types, and transformations
const propertyQuerySchema = z.object({
    query: z.string().trim().optional(),
    // MODIFICATION: Use the 'numToArray' helper to parse single or comma-separated neighborhoods.
    neighborhood: numToArray,
    // MODIFICATION: Use the 'numToArray' helper to parse single or comma-separated wards.
    // Removed overly restrictive .max(2) validation.
    ward: numToArray,
    // MODIFICATION: Use the 'stringToArray' helper to parse single or comma-separated zips.
    zip: stringToArray.refine(
        (items) => items === undefined || items.every(item => /^\d{5}$/.test(item)),
        { message: "All zip codes must be 5 digits." }
    ).optional(),
    status: stringToArray,
    usage: stringToArray,
    sideLotEligible: z.enum(['true', 'false']).transform(v => v === 'true').optional(),
    sqftMin: z.coerce.number().optional(), sqftMax: z.coerce.number().optional(),
    acresMin: z.coerce.number().optional(), acresMax: z.coerce.number().optional(),
    storiesMin: z.coerce.number().optional(), storiesMax: z.coerce.number().optional(),
    unitsMin: z.coerce.number().optional(), unitsMax: z.coerce.number().optional(),
    sort: z.string().trim().optional(),
    order: z.enum(['asc', 'desc']).default('asc'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    fields: stringToArray,
});


// Middleware to validate and attach sanitized params to the request object
const validateRequest = (req: Request, res: Response, next: NextFunction): Response | void => {
    const result = propertyQuerySchema.safeParse(req.query);
    if (!result.success) {
        return res.status(400).json({ error: "Invalid query parameters.", details: result.error.format() });
    }
    // Attach validated and typed data to a custom property on the request
    (req as any).validatedParams = result.data;
    return next();
};

type ValidatedParams = z.infer<typeof propertyQuerySchema>;

// ============================================================================
// Internal Query Builder
// ============================================================================

/**
 * Constructs a Firestore query based on a set of sanitized filter parameters.
 * @param params - The validated and sanitized parameters for filtering.
 * @param isForTextSearch - If true, skips incompatible filters like 'in'.
 * @returns A Firestore Query object.
 */
function buildFilteredQuery(params: ValidatedParams, isForTextSearch: boolean = false): Query {
    let q: Query = db.collection("listings").where("removed", "==", false);

    
    // Handle text search query
    if (params.zip?.length && !isForTextSearch) {
        q = q.where("zip", "in", params.zip.slice(0, FIRESTORE_IN_QUERY_LIMIT));
    }

    // Handle ward filter
    if (params.ward?.length) {
        q = q.where("ward", "in", params.ward.slice(0, FIRESTORE_IN_QUERY_LIMIT));
    }

    // Handle neighborhood filter as array
    if (params.neighborhood?.length && !isForTextSearch) {
        q = q.where("neighborhood", "in", params.neighborhood.slice(0, FIRESTORE_IN_QUERY_LIMIT));
    }

    // Handle status filter as array
    if (params.status?.length && !isForTextSearch) {
        q = q.where("Status", "in", params.status.slice(0, FIRESTORE_IN_QUERY_LIMIT));
    }

    // Handle usage filter as array
    if (params.usage?.length && !isForTextSearch) {
        q = q.where("usage", "in", params.usage.slice(0, FIRESTORE_IN_QUERY_LIMIT));
    }


    // Handle single-value equality filters
    const singleFilters: Record<string, keyof ValidatedParams> = {
        // MODIFICATION: Removed neighborhood since it's now handled as an array above
        SideLotEligible: 'sideLotEligible',
    };
    for (const field in singleFilters) {
        const paramName = singleFilters[field];
        if (params[paramName] !== undefined) {
            q = q.where(field, "==", params[paramName]);
        }
    }

    // ... (rest of the function is unchanged)
    const rangeFields: Record<string, { field: string, min: keyof ValidatedParams, max: keyof ValidatedParams }> = {
        sqft: { field: 'sqft', min: 'sqftMin', max: 'sqftMax' },
        acres: { field: 'Acres', min: 'acresMin', max: 'acresMax' },
        // price: { field: 'LRA_PRICING', min: 'priceMin', max: 'priceMax' },
        stories: { field: 'Stories', min: 'storiesMin', max: 'storiesMax' },
        units: { field: 'NbrOfUnits', min: 'unitsMin', max: 'unitsMax' },
    };
    for (const key in rangeFields) {
        const { field, min, max } = rangeFields[key];
        if (params[min] !== undefined) q = q.where(field, ">=", params[min]!);
        if (params[max] !== undefined) q = q.where(field, "<=", params[max]!);
    }

    return q;
}

// ============================================================================
// Search Strategy Handlers
// ============================================================================

/**
 * Handles text-based searches by querying multiple fields and merging results.
 * @param baseQuery - The pre-filtered Firestore query.
 * @param params - The validated request parameters.
 * @returns A paginated list of results and total count.
 */
async function handleTextSearch(baseQuery: Query, params: ValidatedParams) {
    console.log(`[GET /properties] TEXT SEARCH mode for query: "${params.query}"`);
    const searchText = params.query!.toLowerCase();
    const highBoundary = params.query + "\uf8ff";

    let addressQuery = baseQuery
        .where("addressKeywords", "array-contains", searchText)
        .limit(TEXT_SEARCH_LIMIT);

    let parcelQuery = baseQuery
        .where("parcelId", ">=", params.query!)
        .where("parcelId", "<=", highBoundary)
        .limit(TEXT_SEARCH_LIMIT);

    if (params.fields?.length) {
        console.log(`[GET /properties] Selecting specific fields:`, params.fields);
        const sortField = getSortField(params.sort);
        const fieldsToSelect = new Set(params.fields);
        fieldsToSelect.add(sortField); // Ensure sort field is always included
        addressQuery = addressQuery.select(...Array.from(fieldsToSelect));
        parcelQuery = parcelQuery.select(...Array.from(fieldsToSelect));
    }

    const [addressSnap, parcelSnap] = await Promise.all([addressQuery.get(), parcelQuery.get()]);
    console.log(`[GET /properties] Found ${addressSnap.size} matches by address, ${parcelSnap.size} by parcel ID.`);

    const resultsMap = new Map<string, DocumentData>();
    addressSnap.docs.forEach(doc => resultsMap.set(doc.id, doc.data()));
    parcelSnap.docs.forEach(doc => resultsMap.set(doc.id, doc.data()));
    
    let mergedItems = Array.from(resultsMap.values());
    console.log(`[GET /properties] Merged to ${mergedItems.length} unique results.`);
    
    if (params.zip?.length) {
        const zipSet = new Set(params.zip);
        mergedItems = mergedItems.filter(item => item.zip && zipSet.has(String(item.zip)));
        console.log(`[GET /properties] Filtered down to ${mergedItems.length} results after applying ZIP filter.`);
    }

    if (params.neighborhood?.length) {
        const neighborhoodSet = new Set(params.neighborhood);
        mergedItems = mergedItems.filter(item => item.neighborhood && neighborhoodSet.has(Number(item.neighborhood)));
        console.log(`[GET /properties] Filtered down to ${mergedItems.length} results after applying NEIGHBORHOOD filter.`);
    }

    if (params.status?.length) {
        const statusSet = new Set(params.status);
        mergedItems = mergedItems.filter(item => item.Status && statusSet.has(String(item.Status)));
        console.log(`[GET /properties] Filtered down to ${mergedItems.length} results after applying STATUS filter.`);
    }

    if (params.usage?.length) {
        const usageSet = new Set(params.usage);
        mergedItems = mergedItems.filter(item => item.usage && usageSet.has(String(item.usage)));
        console.log(`[GET /properties] Filtered down to ${mergedItems.length} results after applying USAGE filter.`);
    }

    // ========================================================================
    // Apply range filters manually in-memory
    // ========================================================================
    if (params.sqftMin !== undefined) {
        mergedItems = mergedItems.filter(item => item.sqft != null && Number(item.sqft) >= params.sqftMin!);
        console.log(`[GET /properties] Filtered down to ${mergedItems.length} results after applying SQFT MIN filter (>= ${params.sqftMin}).`);
    }

    if (params.sqftMax !== undefined) {
        mergedItems = mergedItems.filter(item => item.sqft != null && Number(item.sqft) <= params.sqftMax!);
        console.log(`[GET /properties] Filtered down to ${mergedItems.length} results after applying SQFT MAX filter (<= ${params.sqftMax}).`);
    }

    if (params.acresMin !== undefined) {
        mergedItems = mergedItems.filter(item => item.Acres != null && Number(item.Acres) >= params.acresMin!);
        console.log(`[GET /properties] Filtered down to ${mergedItems.length} results after applying ACRES MIN filter.`);
    }

    if (params.acresMax !== undefined) {
        mergedItems = mergedItems.filter(item => item.Acres != null && Number(item.Acres) <= params.acresMax!);
        console.log(`[GET /properties] Filtered down to ${mergedItems.length} results after applying ACRES MAX filter.`);
    }

    if (params.storiesMin !== undefined) {
        mergedItems = mergedItems.filter(item => item.Stories != null && Number(item.Stories) >= params.storiesMin!);
        console.log(`[GET /properties] Filtered down to ${mergedItems.length} results after applying STORIES MIN filter.`);
    }

    if (params.storiesMax !== undefined) {
        mergedItems = mergedItems.filter(item => item.Stories != null && Number(item.Stories) <= params.storiesMax!);
        console.log(`[GET /properties] Filtered down to ${mergedItems.length} results after applying STORIES MAX filter.`);
    }

    if (params.unitsMin !== undefined) {
        mergedItems = mergedItems.filter(item => item.NbrOfUnits != null && Number(item.NbrOfUnits) >= params.unitsMin!);
        console.log(`[GET /properties] Filtered down to ${mergedItems.length} results after applying UNITS MIN filter.`);
    }

    if (params.unitsMax !== undefined) {
        mergedItems = mergedItems.filter(item => item.NbrOfUnits != null && Number(item.NbrOfUnits) <= params.unitsMax!);
        console.log(`[GET /properties] Filtered down to ${mergedItems.length} results after applying UNITS MAX filter.`);
    }

    const sortField = getSortField(params.sort);
    const finalItems = mergedItems.sort((a, b) => {
        const valA = a[sortField], valB = b[sortField];
        if (valA == null) return 1; if (valB == null) return -1;
        if (valA < valB) return params.order === 'asc' ? -1 : 1;
        if (valA > valB) return params.order === 'asc' ? 1 : -1;
        return 0;
    });

    const total = finalItems.length;
    const start = (params.page - 1) * params.pageSize;
    const items = finalItems.slice(start, start + params.pageSize);
    console.log(`[GET /properties] Final results: ${items.length} items for page ${params.page} of ${total} total.`);
    
    return { items, total };
}

/**
 * Handles standard filtered queries with efficient server-side pagination.
 * @param baseQuery - The pre-filtered Firestore query.
 * @param params - The validated request parameters.
 * @returns A paginated list of results and total count.
 */
async function handleStandardSearch(baseQuery: Query, params: ValidatedParams) {
    console.log("[GET /properties] STANDARD QUERY mode.");

    const sortField = getSortField(params.sort);
    console.log(`[GET /properties] Sorting by '${sortField}' (${params.order}). Paging: page ${params.page}, size ${params.pageSize}.`);

    const countPromise = baseQuery.count().get();

    let dataQuery = baseQuery
        .orderBy(sortField, params.order)
        .offset((params.page - 1) * params.pageSize)
        .limit(params.pageSize);

    if (params.fields?.length) {
        console.log(`[GET /properties] Selecting specific fields:`, params.fields);
        dataQuery = dataQuery.select(...params.fields);
    }

    const [agg, dataSnap] = await Promise.all([countPromise, dataQuery.get()]);

    const total = agg.data().count;
    const items = dataSnap.docs.map(doc => doc.data());
    console.log(`[GET /properties] Found ${total} total matching documents. Returning ${items.length} for this page.`);

    return { items, total };
}

/**
 * Determines a valid sort field, defaulting to 'address'.
 * @param sortParam - The requested sort field from the query.
 * @returns A valid and safe Firestore field name to sort by.
 */
function getSortField(sortParam?: string): string {
    const allowedSortFields = new Set(["address", "zip", "neighborhood", "ward", "sqft", "Acres", "LRA_PRICING"]);
    return allowedSortFields.has(sortParam || "") ? sortParam! : "address";
}


// ============================================================================
// API Route Definitions
// ============================================================================

/**
 * GET /
 * Main search endpoint for properties. Supports filtering, sorting, and pagination.
 */
router.get("/", validateRequest, async (req: Request, res: Response) => {
    const params = (req as any).validatedParams as ValidatedParams;
    try {
        console.log("-----------------------------------------------------");
        console.log("[GET /properties] Request received. Validated params:", params);

        // ========================================================================
        // MODIFICATION: Pass a flag to the query builder to indicate if this is
        // part of a text search, so it can skip incompatible filters.
        // ========================================================================
        const baseQuery = buildFilteredQuery(params, !!params.query);
        
        const { items, total } = params.query
            ? await handleTextSearch(baseQuery, params)
            : await handleStandardSearch(baseQuery, params);

        return res.json({
            items,
            total,
            page: params.page,
            pageSize: params.pageSize,
        });

    } catch (e: any) {
        console.error("[GET /properties] An unhandled error occurred:", e);
        if (e.message?.includes("requires an index")) {
            console.error(
                "[ACTION REQUIRED] A Firestore index is missing. " +
                "This query cannot be completed without it. Use the link in the full error log above " +
                "to create the necessary composite index in your Firestore console."
            );
            return res.status(500).json({
                error: "Query failed due to a missing database index. The server administrator has been notified."
            });
        }
        return res.status(500).json({ error: "Failed to query properties due to a server error." });
    }
});

/**
 * GET /selections
 *  full path: /properties/selections
 * Fetches pre-aggregated, distinct values for various property fields.
 */
router.get("/selections", async (_req: Request, res: Response) => {
    try {
        const docRef = db.collection("exports").doc("current");
        const doc = await docRef.get();

        if (!doc.exists) {
            console.warn("[GET /properties/selections] 'exports/current' document not found.");
            return res.status(404).json({ error: "Selection data not found." });
        }

        const data = doc.data() || {};
        const localeSort = (a: any, b: any) => String(a).localeCompare(String(b));
        const numericSort = (a: any, b: any) => Number(a) - Number(b);

        return res.json({
            knownZips: (data.knownZips || []).sort(localeSort),
            knownNeighborhoods: (data.knownNeighborhoods || []).sort(localeSort),
            knownWards: (data.knownWards || []).sort(numericSort),
            knownUsages: (data.knownUsages || []).sort(localeSort),
            knownStatuses: (data.knownStatuses || []).sort(localeSort),
        });
    } catch (e: any) {
        console.error("[GET /properties/selections] Error:", e);
        return res.status(500).json({ error: "Failed to fetch selection data." });
    }
});

export default router;