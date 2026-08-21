import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { logError } from "@/lib/error-handler";
import { sanitizeErrorMessage } from "@/lib/utils";
import { requireCsrf } from "@/lib/csrf";
import { generateDishDetails } from "@/lib/agent/dish-details";

export async function POST(request: NextRequest) {
  try {
    const csrfError = requireCsrf(request);
    if (csrfError) return csrfError;

    if (!checkRateLimit(getClientIp(request))) {
      return NextResponse.json({ error: "Too many requests. Wait a minute and try again." }, { status: 429 });
    }

    const { dishName, category, origin, description, id, regenerate } = await request.json();

    if (!dishName?.trim()) {
      return NextResponse.json({ error: "Dish name is required" }, { status: 400 });
    }

    // Shared generator: cached per dish doc, short/fast output.
    // regenerate: true (from the "Regenerate descriptions" action) skips the
    // persistent cache so fresh details are generated and re-persisted.
    const data = await generateDishDetails({ dishName, category, origin, description, id, regenerate });

    return NextResponse.json(data);
  } catch (err) {
    logError(err, { endpoint: "/api/dishes/details" });
    return NextResponse.json({ error: sanitizeErrorMessage(err) }, { status: 500 });
  }
}
