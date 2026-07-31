// Behavioral test for the _id alias fix — run with tsx/ts-node via npx tsx
import { db } from "./src/lib/mongodb";

// Clean slate
const scans = db("scans");
const jobs = db("agent_log");

// 1. Insert a scan like saveScan does (no explicit id field)
const scanRes = scans.insertOne({ user_id: "test", image_path: "", raw_text: "x", items_count: 3, dishes: [], status: "completed" });
const scanId = scanRes.insertedId as string;

// 2. findById("scans", scanId) — storage wrapper queries { id: scanId }
const found = scans.findOne({ id: scanId });
console.log(found ? "✅ findOne({ id }) matches _id-stored scan" : "❌ findOne({ id }) FAILED");

// 3. update by { id } — as db.update('agent_log', jobId, ...) does
scans.updateOne({ id: scanId }, { $set: { enriched: true } });
const updated = scans.findOne({ _id: scanId });
console.log(updated?.enriched === true ? "✅ updateOne({ id }) updates _id-stored doc" : "❌ updateOne({ id }) FAILED");

// 4. deleteOne by { id }
scans.deleteOne({ id: scanId });
const gone = scans.findOne({ _id: scanId });
console.log(!gone ? "✅ deleteOne({ id }) removes _id-stored doc" : "❌ deleteOne({ id }) FAILED");

// 5. Explicit id field still takes precedence (dishes store id)
const dishes = db("dishes");
const dishRes = dishes.insertOne({ id: "dish-123", name: "Margherita", scan_id: "s1" });
const byExplicit = dishes.findOne({ id: "dish-123" });
console.log(byExplicit?.name === "Margherita" ? "✅ explicit id field still queried normally" : "❌ explicit id broken");
dishes.deleteOne({ id: "dish-123" });

console.log("\nAll _id-alias checks complete");
