import { supabase } from "./backend.js";

const PAGE = 1000;
const TABLES = new Set(["notes", "trash", "vault"]);
const STORE_NAME = "startNotes.offline";
const DOCS = "docs";
const OUTBOX = "outbox";

let storePromise = null;
let flushing = null;
let seq = Date.now();

function parsePath(path, withId) {
    const [root, uid, table, id] = path;

    if (root !== "users" || !uid || !TABLES.has(table) || (withId && !id)) {
        throw new Error(`database: unsupported path ${path.join("/")}`);
    }

    return withId ? { table, uid, id } : { table, uid };
}

function keyOf(ref) {
    return `${ref.uid}/${ref.table}/${ref.id}`;
}

function prefixRange(prefix) {
    return IDBKeyRange.bound(prefix, prefix + "￿");
}

function syncedKey(ref) {
    return `#${ref.uid}/${ref.table}`;
}

function isNetworkError(error) {
    if (!navigator.onLine) {
        return true;
    }

    if (!error) {
        return false;
    }

    if (error instanceof TypeError) {
        return true;
    }

    const text = `${error.message || ""} ${error.details || ""}`;
    return !error.code && /fetch|network|load failed|timed? ?out/i.test(text);
}

function wrapError(error) {
    const wrapped = new Error(error.message || "database error");
    wrapped.cause = error;

    if (error.code === "42501") {
        wrapped.code = "permission-denied";
    }
    else if (error.code === "PGRST301" || error.code === "PGRST302") {
        wrapped.code = "unauthenticated";
    }
    else {
        wrapped.code = "unavailable";
    }

    return wrapped;
}

function openStore() {
    if (!storePromise) {
        storePromise = new Promise(resolve => {
            if (!("indexedDB" in window)) {
                resolve(null);
                return;
            }

            try {
                const request = indexedDB.open(STORE_NAME, 1);
                request.onupgradeneeded = () => {
                    request.result.createObjectStore(DOCS);
                    request.result.createObjectStore(OUTBOX);
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => resolve(null);
                request.onblocked = () => resolve(null);
            }
            catch (error) {
                resolve(null);
            }
        });
    }

    return storePromise;
}

async function run(names, mode, work) {
    const store = await openStore();

    if (!store) {
        return undefined;
    }

    return new Promise(resolve => {
        let result;

        try {
            const tx = store.transaction(names, mode);
            const stores = Object.fromEntries([].concat(names).map(name => [name, tx.objectStore(name)]));
            result = work(stores);
            tx.oncomplete = () => resolve(result && "result" in result ? result.result : result);
            tx.onerror = () => resolve(undefined);
            tx.onabort = () => resolve(undefined);
        }
        catch (error) {
            resolve(undefined);
        }
    });
}

function readRange(name, prefix) {
    return run(name, "readonly", stores => stores[name].getAll(prefixRange(prefix)));
}

function readOne(name, key) {
    return run(name, "readonly", stores => stores[name].get(key));
}

async function cacheWrite(ref, data) {
    await run(DOCS, "readwrite", stores => {
        if (data === null) {
            stores[DOCS].delete(keyOf(ref));
        }
        else {
            stores[DOCS].put({ id: ref.id, data }, keyOf(ref));
        }
    });
}

async function queue(ref, op, data, at) {
    await run(OUTBOX, "readwrite", stores => {
        stores[OUTBOX].put({ ...ref, op, data, at }, keyOf(ref));
    });
}

async function unqueue(ref, at) {
    await run(OUTBOX, "readwrite", stores => {
        const request = stores[OUTBOX].get(keyOf(ref));
        request.onsuccess = () => {
            const entry = request.result;
            if (entry && entry.at <= at) {
                stores[OUTBOX].delete(keyOf(ref));
            }
        };
    });
}

async function sendSet(ref, data) {
    const { error } = await supabase
        .from(ref.table)
        .upsert({
            user_id: ref.uid,
            id: ref.id,
            data,
            updated_at: new Date().toISOString()
        }, { onConflict: "user_id,id" });

    return error;
}

async function sendDelete(ref) {
    const { error } = await supabase
        .from(ref.table)
        .delete()
        .eq("user_id", ref.uid)
        .eq("id", ref.id);

    return error;
}

async function write(ref, op, data) {
    const at = ++seq;
    await cacheWrite(ref, op === "set" ? data : null);

    if (!navigator.onLine) {
        await queue(ref, op, data, at);
        return;
    }

    if (flushing) {
        await flushing.catch(() => false);
    }

    await unqueue(ref, at);
    let error;

    try {
        error = op === "set" ? await sendSet(ref, data) : await sendDelete(ref);
    }
    catch (thrown) {
        error = thrown;
    }

    if (!error) {
        return;
    }

    if (isNetworkError(error)) {
        await queue(ref, op, data, at);
        return;
    }

    throw wrapError(error);
}

async function flushOnce(uid) {
    const entries = (await readRange(OUTBOX, `${uid}/`)) || [];

    for (const entry of entries.sort((a, b) => a.at - b.at)) {
        if (!navigator.onLine) {
            return false;
        }

        const ref = { uid: entry.uid, table: entry.table, id: entry.id };
        const current = await readOne(OUTBOX, keyOf(ref));

        if (!current || current.at !== entry.at) {
            continue;
        }

        let error;

        try {
            error = entry.op === "set" ? await sendSet(ref, entry.data) : await sendDelete(ref);
        }
        catch (thrown) {
            error = thrown;
        }

        if (error) {
            if (!isNetworkError(error)) {
                console.error("database: не удалось отправить изменение", error);
            }
            return false;
        }

        await unqueue(ref, entry.at);
    }

    return true;
}

export function flush(uid) {
    if (!uid || !navigator.onLine) {
        return Promise.resolve(false);
    }

    if (!flushing) {
        flushing = flushOnce(uid).finally(() => {
            flushing = null;
        });
    }

    return flushing;
}

export async function pendingCount(uid) {
    const entries = await readRange(OUTBOX, `${uid}/`);
    return entries ? entries.length : 0;
}

export async function forgetUser(uid) {
    if (await pendingCount(uid)) {
        return false;
    }

    await run([DOCS, OUTBOX], "readwrite", stores => {
        stores[DOCS].delete(prefixRange(`${uid}/`));
        stores[DOCS].delete(prefixRange(`#${uid}/`));
    });

    return true;
}

async function fetchRows(ref) {
    const rows = [];

    for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
            .from(ref.table)
            .select("id, data")
            .eq("user_id", ref.uid)
            .order("id")
            .range(from, from + PAGE - 1);

        if (error) {
            throw error;
        }

        rows.push(...data);

        if (data.length < PAGE) {
            return rows;
        }
    }
}

async function storeSnapshot(ref, rows) {
    const prefix = `${ref.uid}/${ref.table}/`;
    const pending = (await readRange(OUTBOX, prefix)) || [];
    const byId = new Map(rows.map(row => [row.id, row.data]));

    pending.forEach(entry => {
        if (entry.op === "set") {
            byId.set(entry.id, entry.data);
        }
        else {
            byId.delete(entry.id);
        }
    });

    await run(DOCS, "readwrite", stores => {
        stores[DOCS].delete(prefixRange(prefix));
        byId.forEach((data, id) => {
            stores[DOCS].put({ id, data }, prefix + id);
        });
        stores[DOCS].put({ at: Date.now() }, syncedKey(ref));
    });

    return { rows: [...byId].map(([id, data]) => ({ id, data })), pending: pending.length };
}

function snapshot(rows, fromCache, pending) {
    const docs = rows.map(row => ({ id: row.id, data: () => row.data }));

    return {
        docs,
        size: docs.length,
        empty: docs.length === 0,
        metadata: { fromCache, hasPendingWrites: pending > 0 }
    };
}

export function collection(db, ...path) {
    return parsePath(path, false);
}

export function doc(db, ...path) {
    return parsePath(path, true);
}

export async function getDocs(ref) {
    await flush(ref.uid).catch(() => false);

    try {
        const rows = await fetchRows(ref);
        const merged = await storeSnapshot(ref, rows);
        return snapshot(merged.rows, false, merged.pending);
    }
    catch (error) {
        if (!isNetworkError(error)) {
            throw wrapError(error);
        }

        const synced = await readOne(DOCS, syncedKey(ref));

        if (!synced) {
            throw wrapError(error);
        }

        const rows = (await readRange(DOCS, `${ref.uid}/${ref.table}/`)) || [];
        return snapshot(rows, true, await pendingCount(ref.uid));
    }
}

export function setDoc(ref, value) {
    return write(ref, "set", JSON.parse(JSON.stringify(value)));
}

export function deleteDoc(ref) {
    return write(ref, "delete", null);
}

window.addEventListener("online", async () => {
    const { data } = await supabase.auth.getSession();

    if (data && data.session) {
        flush(data.session.user.id);
    }
});
