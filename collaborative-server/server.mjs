import http from "http";
import { WebSocketServer } from "ws";
import {
    setupWSConnection,
    getYDoc,
    setPersistence,
} from "@y/websocket-server/utils";
import * as Y from "yjs";

const port = process.env.PORT || 1234;
const backendUrl = process.env.BACKEND_URL || "http://localhost:4000";
const snapshotDebounceMs = Number(process.env.SNAPSHOT_DEBOUNCE_MS || 2000);
const serviceApiKey = process.env.SERVICE_API_KEY || "dev-service-key";

const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end("Yjs server up n runnin\n");
});

const wss = new WebSocketServer({ server });

const docState = new Map();

const getDocState = (docName) => {
    if (!docState.has(docName)) {
        docState.set(docName, {
            hydrated: false,
            hydrating: null,
            hooksAttached: false,
            saveTimeout: null,
            pendingSave: null,
        });
    }
    return docState.get(docName);
};

const persistDoc = async (docName, doc) => {
    const state = getDocState(docName);
    if (state.pendingSave) {
        return state.pendingSave;
    }

    const promise = (async () => {
        try {
            const update = Y.encodeStateAsUpdate(doc);
            const snapshot = Buffer.from(update).toString("base64");
            const res = await fetch(
                `${backendUrl}/documents/${docName}/snapshot`,
                {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json",
                        "X-Service-API-Key": serviceApiKey,
                    },
                    body: JSON.stringify({ snapshot }),
                }
            );

            if (!res.ok) {
                throw new Error(`Snapshot save failed (${res.status})`);
            }
        } catch (error) {
            console.error(`Failed to persist snapshot for ${docName}:`, error);
        } finally {
            state.pendingSave = null;
        }
    })();

    state.pendingSave = promise;
    return promise;
};

const scheduleSave = (docName, doc) => {
    const state = getDocState(docName);
    if (state.saveTimeout) {
        clearTimeout(state.saveTimeout);
    }

    state.saveTimeout = setTimeout(() => {
        state.saveTimeout = null;
        persistDoc(docName, doc).catch(() => {
            /* errors already logged */
        });
    }, snapshotDebounceMs);
};

const hydrateDoc = async (docName) => {
    const doc = getYDoc(docName);
    const state = getDocState(docName);

    if (!state.hooksAttached) {
        doc.on("update", () => scheduleSave(docName, doc));
        state.hooksAttached = true;
    }

    if (state.hydrated) {
        return doc;
    }

    if (state.hydrating) {
        await state.hydrating;
        return doc;
    }

    const hydratePromise = (async () => {
        try {
            const res = await fetch(
                `${backendUrl}/documents/${docName}/snapshot`,
                {
                    headers: {
                        "X-Service-API-Key": serviceApiKey,
                    },
                }
            );

            if (res.status === 204) {
                // No snapshot stored yet; treat as empty doc
                return;
            }

            if (res.ok) {
                const { snapshot } = await res.json();
                if (snapshot) {
                    const update = Buffer.from(snapshot, "base64");
                    Y.applyUpdate(doc, update);
                    console.log(`Hydrated document ${docName} from snapshot.`);
                }
            } else if (res.status !== 404) {
                console.warn(
                    `Snapshot fetch failed for ${docName} (${res.status})`
                );
            }
        } catch (error) {
            console.warn(`Unable to hydrate ${docName}:`, error.message);
        } finally {
            state.hydrated = true;
            state.hydrating = null;
        }
    })();

    state.hydrating = hydratePromise;
    await hydratePromise;
    return doc;
};

setPersistence({
    bindState: () => {},
    writeState: async (docName, doc) => {
        await persistDoc(docName, doc);
        const state = docState.get(docName);
        if (state?.saveTimeout) {
            clearTimeout(state.saveTimeout);
        }
        docState.delete(docName);
    },
});

wss.on("connection", async (ws, req) => {
    try {
        const host = req.headers.host || `localhost:${port}`;
        const url = new URL(req.url || "/", `http://${host}`);
        const docName = url.pathname.slice(1) || "default-room";
        await hydrateDoc(docName);
        console.log("Client connected to document:", docName);

        setupWSConnection(ws, req, {
            docName,
        });

        ws.on("close", (code, reason) => {
            const reasonText = reason?.toString() ?? "";
            const suffix = reasonText ? ` reason: ${reasonText}` : "";
            console.log(
                `Client disconnected from document ${docName} (code ${code})${suffix}`
            );
        });

        ws.on("error", (error) => {
            console.error(
                `WebSocket error for document ${docName}:`,
                error?.message ?? error
            );
        });
    } catch (error) {
        console.error("Failed to establish websocket connection:", error);
        ws.close(1011, "Internal server error");
    }
});

server.listen(port, () => {
    console.log(`Yjs WebSocket server running on http://localhost:${port}`);
});
