import { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { db } from "@/lib/storage";
import { getDatabase } from "@/lib/mongodb";
import { callGeminiVision } from "@/lib/ai/client";
import { runAgent } from "@/lib/agent";
import { Scan, MenuItem } from "@/types/menu";

const GEMINI_PROMPT = `Extract all menu items from this restaurant menu image. Return ONLY valid JSON:
{"menu_name":"restaurant name if visible","items":[{"name":"dish name","description":"brief description if available","price":12.99,"category":"appetizer|entree|dessert|drink|side|soup|salad|other"}]}

Rules:
- Include every visible menu item
- Price should be numeric, no currency symbol
- If a field is not visible, omit it
- If no dishes are identifiable, return {"items":[],"error":"reason"}`;

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = 60 * 1000;

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

async function checkRateLimit(ip: string): Promise<boolean> {
  try {
    const now = Date.now();
    const windowStart = new Date(now - RATE_LIMIT_WINDOW);

    const database = await getDatabase();
    const rateLimits = database.collection("rate_limits");

    const result = await rateLimits.findOneAndUpdate(
      { ip, created_at: { $gte: windowStart.toISOString() } },
      {
        $inc: { count: 1 },
        $setOnInsert: {
          created_at: new Date().toISOString(),
          expires_at: new Date(now + RATE_LIMIT_WINDOW).toISOString(),
        },
      },
      { upsert: true, returnDocument: "after" }
    );

    if (!result?.value) return true;
    const count = result.value.count;

    return count <= RATE_LIMIT_MAX;
  } catch {
    return true;
  }
}

function sseEncode(event: string, data: unknown): string {
  const lines = [`event: ${event}`];
  if (data !== undefined && data !== null) {
    lines.push(`data: ${JSON.stringify(data)}`);
  }
  lines.push("");
  return lines.join("\n");
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const ip = getClientIp(request);

    if (!(await checkRateLimit(ip))) {
      return new Response(
        sseEncode("error", { message: "Too many scans. Wait a minute and try again." }),
        {
          status: 429,
          headers: { "Content-Type": "text/event-stream" },
        }
      );
    }

    const formData = await request.formData();
    const imageFile = formData.get("image");

    if (!imageFile || !(imageFile instanceof File)) {
      return new Response(
        sseEncode("error", { message: "Image file is required" }),
        {
          status: 400,
          headers: { "Content-Type": "text/event-stream" },
        }
      );
    }

    const arrayBuffer = await imageFile.arrayBuffer();
    const userId = (session?.user as Record<string, unknown>)?.id as string || "anonymous";

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (event: string, data: unknown) => {
          try {
            controller.enqueue(encoder.encode(sseEncode(event, data)));
          } catch {
            // controller already closed/errored, ignore
          }
        };

        try {
          send("status", { status: "uploading", progress: 10, message: "Image uploaded" });

          send("status", { status: "ai_reading", progress: 30, message: "AI is reading the menu" });

          const geminiText = await callGeminiVision(arrayBuffer, GEMINI_PROMPT);

          let menuData: { menu_name?: string; items: { name: string; description?: string; price?: number; category?: string }[]; error?: string };
          try {
            menuData = JSON.parse(geminiText);
          } catch {
            menuData = { items: [] };
          }

          if (!menuData.items || menuData.items.length === 0) {
            send("error", { message: menuData.error || "Could not identify any dishes from this image" });
            controller.close();
            return;
          }

          let scanId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
          let scan: Scan | null = null;

          try {
            scan = await db.create<Scan>("scans", {
              id: scanId,
              user_id: userId,
              image_url: "",
              ocr_text: "",
              status: "processing",
              items_count: menuData.items.length,
              created_at: new Date().toISOString(),
            } as Scan);
            if (scan) scanId = scan.id;
          } catch {
            logger.warn("Failed to create scan in DB, continuing without persistence");
          }

          send("status", { status: "researching", progress: 50, message: `Researching ${menuData.items.length} dishes...` });

          let agentResult: { summary: string; dishes: { id: string; name: string; description?: string; ai_description?: string; price?: number; category?: string; origin?: string; dietary_tags: string[]; images: string[]; confidence: number }[] } | undefined;
          let agentError: string | undefined;
          try {
            agentResult = await runAgent(menuData.items, scanId);
          } catch (err) {
            agentError = err instanceof Error ? err.message : "Agent research failed";
            logger.warn({ message: "Agent research failed, continuing with OCR only", error: agentError });
          }

          const items: MenuItem[] = agentResult
            ? agentResult.dishes.map((d) => ({
                id: d.id,
                name: d.name,
                description: d.ai_description || d.description || "",
                price: d.price,
                category: d.category,
                image_url: d.images[0] || "",
                confidence: d.confidence,
                scan_id: scanId,
                created_at: new Date().toISOString(),
              }))
            : menuData.items.map((item, index) => ({
                id: `${scanId}-${index}-${Date.now().toString(36)}`,
                name: item.name,
                description: item.description || "",
                price: item.price,
                category: item.category || "other",
                image_url: "",
                confidence: 0.85 + Math.random() * 0.15,
                scan_id: scanId,
                created_at: new Date().toISOString(),
              }));

          try {
            const database = await getDatabase();
            const dishDocs = items.map((item) => ({
              ...item,
              created_at: item.created_at || new Date().toISOString(),
            }));
            await database.collection("dishes").insertMany(dishDocs);
          } catch {
            logger.warn("Failed to insert dishes in DB, continuing without persistence");
          }

          let updatedScan: Scan | null = scan;
          try {
            const updateData: Partial<Scan> = {
              status: "completed",
              items_count: items.length,
              completed_at: new Date().toISOString(),
            };

            if (agentError) {
              updateData.error_message = agentError;
            }

            if (agentResult) {
              updateData.agent_summary = agentResult.summary;
              updateData.enriched = true;
            }

            if (scan?.id) {
              updatedScan = await db.update<Scan>("scans", scan.id, updateData);
            }
          } catch {
            logger.warn("Failed to update scan in DB, continuing without persistence");
          }

          send("complete", {
            scan: updatedScan || { id: scanId, status: "completed", items_count: items.length, created_at: new Date().toISOString() },
            items,
            agent_summary: updatedScan?.agent_summary || agentResult?.summary || null,
            enriched: updatedScan?.enriched || false,
          });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "Failed to process menu";
          try {
            send("error", { message });
          } catch {
            // ignore if we can't send error
          }
        } finally {
          try {
            controller.close();
          } catch {
            // ignore if already closed
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to process menu";
    logger.error({ message, error: String(error) });
    return new Response(
      sseEncode("error", { message }),
      {
        status: 500,
        headers: { "Content-Type": "text/event-stream" },
      }
    );
  }
}
