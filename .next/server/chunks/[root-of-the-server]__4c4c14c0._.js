module.exports = [
"[externals]/module [external] (module, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("module", () => require("module"));

module.exports = mod;
}),
"[externals]/node:fs [external] (node:fs, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:fs", () => require("node:fs"));

module.exports = mod;
}),
"[externals]/node:path [external] (node:path, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:path", () => require("node:path"));

module.exports = mod;
}),
"[externals]/node:url [external] (node:url, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:url", () => require("node:url"));

module.exports = mod;
}),
"[externals]/events [external] (events, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("events", () => require("events"));

module.exports = mod;
}),
"[externals]/worker_threads [external] (worker_threads, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("worker_threads", () => require("worker_threads"));

module.exports = mod;
}),
"[externals]/path [external] (path, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("path", () => require("path"));

module.exports = mod;
}),
"[externals]/url [external] (url, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("url", () => require("url"));

module.exports = mod;
}),
"[externals]/buffer [external] (buffer, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("buffer", () => require("buffer"));

module.exports = mod;
}),
"[externals]/assert [external] (assert, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("assert", () => require("assert"));

module.exports = mod;
}),
"[externals]/node:os [external] (node:os, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:os", () => require("node:os"));

module.exports = mod;
}),
"[externals]/node:events [external] (node:events, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:events", () => require("node:events"));

module.exports = mod;
}),
"[externals]/node:diagnostics_channel [external] (node:diagnostics_channel, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:diagnostics_channel", () => require("node:diagnostics_channel"));

module.exports = mod;
}),
"[externals]/fs [external] (fs, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("fs", () => require("fs"));

module.exports = mod;
}),
"[externals]/util [external] (util, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("util", () => require("util"));

module.exports = mod;
}),
"[project]/src/lib/logger.ts [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "logger",
    ()=>logger
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$pino$2f$pino$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/pino/pino.js [instrumentation] (ecmascript)");
;
const logger = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$pino$2f$pino$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["default"])({
    level: process.env.LOG_LEVEL || "info"
});
}),
"[externals]/mongodb [external] (mongodb, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("mongodb", () => require("mongodb"));

module.exports = mod;
}),
"[project]/src/lib/mongodb.ts [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "connectToDatabase",
    ()=>connectToDatabase,
    "getDatabase",
    ()=>getDatabase
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$mongodb__$5b$external$5d$__$28$mongodb$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/mongodb [external] (mongodb, cjs)");
;
const MONGODB_URI = process.env.MONGODB_URI || "";
const MONGODB_DB = process.env.MONGODB_DB || "sample_mflix";
let cachedClient = null;
let cachedDb = null;
let indexesEnsured = false;
async function connectToDatabase() {
    if (cachedClient && cachedDb) {
        if (!indexesEnsured) {
            indexesEnsured = true;
            const { ensureIndexes } = await __turbopack_context__.A("[project]/src/lib/storage/index.ts [instrumentation] (ecmascript, async loader)");
            await ensureIndexes();
        }
        return {
            client: cachedClient,
            db: cachedDb
        };
    }
    if (!MONGODB_URI) {
        throw new Error("MONGODB_URI is not defined");
    }
    const client = await __TURBOPACK__imported__module__$5b$externals$5d2f$mongodb__$5b$external$5d$__$28$mongodb$2c$__cjs$29$__["MongoClient"].connect(MONGODB_URI);
    const db = client.db(MONGODB_DB);
    cachedClient = client;
    cachedDb = db;
    indexesEnsured = true;
    const { ensureIndexes } = await __turbopack_context__.A("[project]/src/lib/storage/index.ts [instrumentation] (ecmascript, async loader)");
    await ensureIndexes();
    return {
        client,
        db
    };
}
async function getDatabase() {
    const { db } = await connectToDatabase();
    return db;
}
}),
"[project]/src/lib/storage/index.ts [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "db",
    ()=>db,
    "ensureIndexes",
    ()=>ensureIndexes
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$mongodb$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/mongodb.ts [instrumentation] (ecmascript)");
;
const db = {
    async create (collection, data) {
        const database = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$mongodb$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["getDatabase"])();
        const col = database.collection(collection);
        const doc = {
            ...data,
            id: data.id || generateId(),
            created_at: data.created_at || new Date().toISOString()
        };
        await col.insertOne(doc);
        return doc;
    },
    async findById (collection, id) {
        const database = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$mongodb$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["getDatabase"])();
        const col = database.collection(collection);
        const doc = await col.findOne({
            id
        });
        return doc || null;
    },
    async findAll (collection, limit = 1000, skip = 0) {
        const database = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$mongodb$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["getDatabase"])();
        const col = database.collection(collection);
        const docs = await col.find().skip(skip).limit(limit).toArray();
        return docs;
    },
    async findBy (collection, filter, limit = 1000) {
        const database = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$mongodb$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["getDatabase"])();
        const col = database.collection(collection);
        const docs = await col.find(filter).limit(limit).toArray();
        return docs;
    },
    async findOne (collection, filter) {
        const database = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$mongodb$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["getDatabase"])();
        const col = database.collection(collection);
        const doc = await col.findOne(filter);
        return doc || null;
    },
    async update (collection, id, updates) {
        const database = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$mongodb$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["getDatabase"])();
        const col = database.collection(collection);
        const result = await col.findOneAndUpdate({
            id
        }, {
            $set: {
                ...updates,
                updated_at: new Date().toISOString()
            }
        }, {
            returnDocument: "after"
        });
        return result || null;
    },
    async delete (collection, id) {
        const database = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$mongodb$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["getDatabase"])();
        const col = database.collection(collection);
        const result = await col.deleteOne({
            id
        });
        return result.deletedCount > 0;
    },
    async count (collection, filter) {
        const database = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$mongodb$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["getDatabase"])();
        const col = database.collection(collection);
        return col.countDocuments(filter || {});
    },
    async clear (collection) {
        const database = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$mongodb$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["getDatabase"])();
        const col = database.collection(collection);
        await col.deleteMany({});
    },
    async aggregate (collection, pipeline) {
        const database = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$mongodb$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["getDatabase"])();
        const col = database.collection(collection);
        const docs = await col.aggregate(pipeline).toArray();
        return docs;
    }
};
async function ensureIndexes() {
    const database = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$mongodb$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["getDatabase"])();
    await database.collection("scans").createIndex({
        user_id: 1
    });
    await database.collection("scans").createIndex({
        created_at: -1
    });
    await database.collection("scans").createIndex({
        status: 1
    });
    await database.collection("dishes").createIndex({
        scan_id: 1
    });
    await database.collection("dishes").createIndex({
        name: 1
    });
    await database.collection("cache").createIndex({
        dish_name: 1
    });
    await database.collection("cache").createIndex({
        expires_at: 1
    });
    await database.collection("cache").createIndex({
        query: 1
    });
    await database.collection("rate_limits").createIndex({
        expires_at: 1
    }, {
        expireAfterSeconds: 0
    });
}
function generateId() {
    return crypto.randomUUID();
}
}),
"[externals]/child_process [external] (child_process, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("child_process", () => require("child_process"));

module.exports = mod;
}),
"[externals]/os [external] (os, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("os", () => require("os"));

module.exports = mod;
}),
"[externals]/net [external] (net, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("net", () => require("net"));

module.exports = mod;
}),
"[project]/src/lib/diagnostics.ts [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "bootHealthCheck",
    ()=>bootHealthCheck,
    "formatReport",
    ()=>formatReport,
    "runDiagnostics",
    ()=>runDiagnostics
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$logger$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/logger.ts [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$storage$2f$index$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/storage/index.ts [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$child_process__$5b$external$5d$__$28$child_process$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/child_process [external] (child_process, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/fs [external] (fs, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/path [external] (path, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$os__$5b$external$5d$__$28$os$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/os [external] (os, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$net__$5b$external$5d$__$28$net$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/net [external] (net, cjs)");
;
;
;
;
;
;
;
// ──────────────────────────────────────────────
// Expected environment variables per provider
// ──────────────────────────────────────────────
const ENV_VARS = {
    REQUIRED: [],
    RECOMMENDED: {
        MONGODB_URI: "MongoDB Atlas connection string (needed for persistence)",
        OPENROUTER_API_KEY: "OpenRouter free-tier API key (multi-model vision/text)",
        GEMINI_API_KEY: "Google Gemini API key (direct vision fallback)",
        FREETHEAI_API_KEY: "FreeTheAi API key (free text provider)",
        GROQ_API_KEY: "Groq API key (free text provider)",
        SAMBANOVA_API_KEY: "SambaNova API key (free text provider)",
        HF_TOKEN: "HuggingFace token (free text provider)"
    },
    CONDITIONAL: {
        CLOUDFLARE_API_TOKEN: "Cloudflare API token (needs CLOUDFLARE_ACCOUNT_ID too)",
        CLOUDFLARE_ACCOUNT_ID: "Cloudflare account ID (needs CLOUDFLARE_API_TOKEN too)",
        GITHUB_TOKEN: "GitHub token (needs fine-grained AI inference access)"
    }
};
// ──────────────────────────────────────────────
// Individual checks
// ──────────────────────────────────────────────
function check(label, fn) {
    const start = Date.now();
    return fn().then((r)=>({
            ...r,
            name: label,
            duration_ms: Date.now() - start
        }));
}
/** 1. Environment variable presence check */ async function checkEnvVars() {
    const missing = [];
    for (const [key, desc] of Object.entries(ENV_VARS.RECOMMENDED)){
        if (!process.env[key]) missing.push(`${key} — ${desc}`);
    }
    // Conditional checks — warn if one is set without the other
    if (process.env.CLOUDFLARE_API_TOKEN && !process.env.CLOUDFLARE_ACCOUNT_ID) {
        missing.push("CLOUDFLARE_ACCOUNT_ID — set when CLOUDFLARE_API_TOKEN is present");
    }
    if (process.env.CLOUDFLARE_ACCOUNT_ID && !process.env.CLOUDFLARE_API_TOKEN) {
        missing.push("CLOUDFLARE_API_TOKEN — set when CLOUDFLARE_ACCOUNT_ID is present");
    }
    const hasAnyAI = ENV_VARS.RECOMMENDED ? Object.keys(ENV_VARS.RECOMMENDED).some((k)=>process.env[k]) : false;
    if (missing.length === 0) {
        return {
            name: "env-vars",
            status: "pass",
            message: "All recommended env vars are set"
        };
    }
    // If none of the AI keys are set at all, it's a bigger issue
    if (!hasAnyAI && !process.env.GEMINI_API_KEY) {
        return {
            name: "env-vars",
            status: "warn",
            message: `No AI API keys configured — app will rely entirely on offline Python OCR`,
            detail: missing.join("\n")
        };
    }
    return {
        name: "env-vars",
        status: "warn",
        message: `${missing.length} recommended env var(s) missing`,
        detail: missing.join("\n")
    };
}
/** 2. MongoDB connectivity check */ async function checkMongoDB() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        return {
            name: "mongodb",
            status: "skip",
            message: "MONGODB_URI not set — app works without persistence"
        };
    }
    try {
        const start = Date.now();
        // The db.findById returns null on error, so we try a direct aggregate/count
        const count = await __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$storage$2f$index$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["db"].count("scans").catch(()=>null);
        if (count === null) throw new Error("MongoDB connection failed");
        return {
            name: "mongodb",
            status: "pass",
            message: `Connected to MongoDB (${count} scans in collection)`,
            duration_ms: Date.now() - start
        };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Detect common Atlas SSL/whitelist errors
        let hint = "";
        if (msg.includes("SSL") || msg.includes("tlsv1") || msg.includes("alert internal error")) {
            hint = " — check Atlas Network Access whitelist (add your current IP)";
        } else if (msg.includes("Authentication failed") || msg.includes("auth failed")) {
            hint = " — check username/password in MONGODB_URI";
        } else if (msg.includes("ENOTFOUND") || msg.includes("EAI_AGAIN")) {
            hint = " — DNS resolution failed, check cluster hostname";
        }
        return {
            name: "mongodb",
            status: "fail",
            message: `Cannot connect to MongoDB${hint}`,
            detail: msg.slice(0, 300)
        };
    }
}
/** 3. Python + Tesseract OCR availability */ async function checkOCRPipeline() {
    const pythonPath = `C:\\Users\\maqso\\AppData\\Local\\hermes\\hermes-agent\\venv\\Scripts\\python.exe`;
    const tesseractPath = `C:\\Program Files\\Tesseract-OCR\\tesseract.exe`;
    // Check Tesseract binary
    if (!(0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["existsSync"])(tesseractPath)) {
        return {
            name: "ocr-pipeline",
            status: "fail",
            message: "Tesseract OCR binary not found",
            detail: `Expected at: ${tesseractPath}\nInstall: winget install UB-Mannheim.TesseractOCR`
        };
    }
    // Check Python binary
    if (!(0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["existsSync"])(pythonPath)) {
        return {
            name: "ocr-pipeline",
            status: "fail",
            message: "Hermes-agent Python venv not found",
            detail: `Expected at: ${pythonPath}\nMake sure hermes-agent is installed`
        };
    }
    // Quick Python import test
    try {
        const result = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$child_process__$5b$external$5d$__$28$child_process$2c$__cjs$29$__["execSync"])(`"${pythonPath}" -c "import PIL; import pytesseract; print(PIL.__version__); print(pytesseract.get_tesseract_version())"`, {
            timeout: 15000,
            maxBuffer: 1024 * 1024
        }).toString().trim();
        const lines = result.split("\n");
        return {
            name: "ocr-pipeline",
            status: "pass",
            message: `Python OCR pipeline ready (PIL ${lines[0]}, ${lines[1]})`
        };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
            name: "ocr-pipeline",
            status: "fail",
            message: "Python OCR pipeline failed import check",
            detail: msg.slice(0, 300)
        };
    }
}
/** 4. Disk & temp directory check */ async function checkDisk() {
    const ocrDir = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["join"])((0, __TURBOPACK__imported__module__$5b$externals$5d2f$os__$5b$external$5d$__$28$os$2c$__cjs$29$__["tmpdir"])(), "menulens-ocr");
    try {
        if (!(0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["existsSync"])(ocrDir)) {
            // Creating the dir is part of the check — readable, writable?
            (0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["mkdirSync"])(ocrDir, {
                recursive: true
            });
            const testFile = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["join"])(ocrDir, ".write-test");
            (0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["writeFileSync"])(testFile, "ok");
            (0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["unlinkSync"])(testFile);
        }
        // Check writeability with an actual write
        (0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["accessSync"])(ocrDir, __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["constants"].W_OK | __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["constants"].R_OK);
        return {
            name: "disk",
            status: "pass",
            message: `Temp directory writable (${ocrDir})`
        };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
            name: "disk",
            status: "fail",
            message: "Temp directory not writable — OCR will fail",
            detail: msg.slice(0, 200)
        };
    }
}
/** 5. Port availability check */ async function checkPort(port = 3000) {
    try {
        // Quick check if port is already in use by trying to create a server
        const result = await new Promise((resolve)=>{
            const server = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$net__$5b$external$5d$__$28$net$2c$__cjs$29$__["createServer"])();
            server.once("error", (err)=>{
                if (err.code === "EADDRINUSE") resolve(`Port ${port} is in use (${err.message})`);
                else resolve(`Port check error: ${err.message}`);
            });
            server.once("listening", ()=>{
                server.close();
                resolve("available");
            });
            server.listen(port, "127.0.0.1");
        });
        if (result === "available") {
            return {
                name: "port-3000",
                status: "pass",
                message: `Port ${port} is available`
            };
        }
        return {
            name: "port-3000",
            status: "warn",
            message: result,
            detail: "Stop the existing process with: taskkill /F /IM node.exe"
        };
    } catch (err) {
        return {
            name: "port-3000",
            status: "skip",
            message: `Could not check port ${port}`,
            detail: err instanceof Error ? err.message : String(err)
        };
    }
}
/** 6. Project dependency check (node_modules sanity) */ async function checkDependencies() {
    const pkgPath = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["join"])(process.cwd(), "package.json");
    if (!(0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["existsSync"])(pkgPath)) {
        return {
            name: "dependencies",
            status: "fail",
            message: "package.json not found"
        };
    }
    const pkg = JSON.parse((0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["readFileSync"])(pkgPath, "utf-8"));
    const modulesPath = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["join"])(process.cwd(), "node_modules");
    if (!(0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["existsSync"])(modulesPath)) {
        return {
            name: "dependencies",
            status: "fail",
            message: "node_modules missing — run npm install"
        };
    }
    // Spot-check a few critical deps
    const criticalDeps = [
        "next",
        "react",
        "mongodb",
        "pino"
    ];
    const missingDeps = [];
    for (const dep of criticalDeps){
        const depPath = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["join"])(modulesPath, dep);
        if (!(0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["existsSync"])(depPath)) {
            missingDeps.push(dep);
        }
    }
    if (missingDeps.length > 0) {
        return {
            name: "dependencies",
            status: "fail",
            message: `Missing critical dependencies: ${missingDeps.join(", ")}`,
            detail: "Run: npm install"
        };
    }
    return {
        name: "dependencies",
        status: "pass",
        message: `All critical dependencies found (${Object.keys(pkg.dependencies || {}).length} total)`
    };
}
/** 7. Check that key page files exist */ async function checkRoutes() {
    const srcDir = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["join"])(process.cwd(), "src");
    const expectedFiles = [
        "app/page.tsx",
        "app/layout.tsx",
        "app/scan/page.tsx",
        "app/results/[id]/page.tsx",
        "app/api/scan/new/route.ts",
        "app/api/scan/[id]/route.ts"
    ];
    const missing = [];
    for (const file of expectedFiles){
        if (!(0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["existsSync"])((0, __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["join"])(srcDir, file))) {
            missing.push(file);
        }
    }
    if (missing.length > 0) {
        return {
            name: "routes",
            status: "fail",
            message: `${missing.length} expected route file(s) missing`,
            detail: missing.join("\n")
        };
    }
    return {
        name: "routes",
        status: "pass",
        message: `${expectedFiles.length} key route files exist`
    };
}
/** 8. Check that ErrorBoundary component exists (referenced in layout.tsx) */ async function checkErrorBoundary() {
    const componentsDir = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["join"])(process.cwd(), "src", "components");
    if (!(0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["existsSync"])(componentsDir)) {
        return {
            name: "error-boundary",
            status: "fail",
            message: "src/components/ directory is missing",
            detail: "Layout imports from @/components/ErrorBoundary but directory doesn't exist"
        };
    }
    const ebPath = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["join"])(componentsDir, "ErrorBoundary.tsx");
    if (!(0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["existsSync"])(ebPath)) {
        return {
            name: "error-boundary",
            status: "fail",
            message: "ErrorBoundary.tsx is referenced in layout.tsx but does not exist",
            detail: "Path expected: src/components/ErrorBoundary.tsx\nThis will cause a build error if the file is not created."
        };
    }
    return {
        name: "error-boundary",
        status: "pass",
        message: "ErrorBoundary component exists"
    };
}
async function runDiagnostics(categories, options) {
    const checks = [];
    const add = (name, fn, cat)=>{
        checks.push({
            name,
            fn,
            category: cat
        });
    };
    add("Environment Variables", checkEnvVars, "env");
    add("Dependencies", checkDependencies, "system");
    add("Disk & Temp", checkDisk, "system");
    add("Port Availability", ()=>checkPort(options?.port ?? 3000), "system");
    add("MongoDB", checkMongoDB, "storage");
    add("OCR Pipeline", checkOCRPipeline, "ocr");
    add("Routes", checkRoutes, "routes");
    add("ErrorBoundary Component", checkErrorBoundary, "routes");
    const toRun = categories && !categories.includes("all") ? checks.filter((c)=>categories.includes(c.category)) : checks;
    // Run all checks in parallel where possible
    const results = await Promise.all(toRun.map((c)=>check(c.name, c.fn)));
    const summary = {
        pass: results.filter((r)=>r.status === "pass").length,
        fail: results.filter((r)=>r.status === "fail").length,
        warn: results.filter((r)=>r.status === "warn").length,
        skip: results.filter((r)=>r.status === "skip").length,
        total: results.length
    };
    return {
        timestamp: new Date().toISOString(),
        environment: ("TURBOPACK compile-time value", "development") || "development",
        summary,
        results
    };
}
async function bootHealthCheck() {
    const results = await runDiagnostics([
        "env",
        "ocr",
        "storage"
    ]);
    for (const r of results.results){
        if (r.status === "fail") {
            __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$logger$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["logger"].error({
                diagnostic: r.name,
                message: r.message,
                detail: r.detail
            });
        } else if (r.status === "warn") {
            __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$logger$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["logger"].warn({
                diagnostic: r.name,
                message: r.message
            });
        } else {
            __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$logger$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["logger"].info({
                diagnostic: r.name,
                message: r.message
            });
        }
    }
    if (results.summary.fail > 0) {
        __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$logger$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["logger"].warn(`Boot diagnostics: ${results.summary.fail} failure(s) — app may have reduced functionality`);
    }
}
function formatReport(report) {
    const lines = [];
    const ICON = {
        pass: "✓",
        fail: "✗",
        warn: "!",
        skip: "—"
    };
    lines.push(`\n  MenuLens Diagnostics Report`);
    lines.push(`  ${"=".repeat(42)}`);
    lines.push(`  Timestamp: ${report.timestamp}`);
    lines.push(`  Environment: ${report.environment}`);
    lines.push("");
    for (const r of report.results){
        const icon = ICON[r.status] || "?";
        lines.push(`  ${icon}  ${r.name}`);
        lines.push(`     ${r.message}`);
        if (r.detail) {
            for (const line of r.detail.split("\n")){
                lines.push(`     ${line}`);
            }
        }
        if (r.duration_ms !== undefined) {
            lines.push(`     (${r.duration_ms}ms)`);
        }
        lines.push("");
    }
    const { pass, fail, warn, skip } = report.summary;
    lines.push(`  ${"=".repeat(42)}`);
    lines.push(`  ${pass} passed, ${fail} failed, ${warn} warnings, ${skip} skipped`);
    if (fail > 0) {
        lines.push(`  ✗  ${fail} blocking issue(s) need attention`);
    }
    if (warn > 0) {
        lines.push(`  !  ${warn} non-blocking issue(s) to review`);
    }
    lines.push("");
    return lines.join("\n");
}
}),
"[project]/instrumentation.ts [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Next.js Instrumentation — runs once at server startup.
 * Used here to execute a boot-time health check and log diagnostics.
 */ __turbopack_context__.s([
    "register",
    ()=>register
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$diagnostics$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/diagnostics.ts [instrumentation] (ecmascript)");
;
async function register() {
    // Run async health check at boot (non-blocking, logs warnings)
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$diagnostics$2e$ts__$5b$instrumentation$5d$__$28$ecmascript$29$__["bootHealthCheck"])().catch(()=>{
    // Silent — bootHealthCheck already logs errors internally
    });
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__4c4c14c0._.js.map