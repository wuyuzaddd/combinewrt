import { getSession } from "@/lib/auth/current-session";
import { createBaseVersionStore } from "@/lib/base/store";
import { getBuildService } from "@/lib/builds";
import { getDatabase } from "@/lib/db";
import { createSourceOffer, sourceOfferJson } from "@/lib/source-offer/manifest";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const build = getBuildService().get(id);
  if (!build) return Response.json({ error: "build not found" }, { status: 404 });

  const base = createBaseVersionStore(getDatabase()).get(build.plan.baseVersion);
  const offer = createSourceOffer(build, { imageBuilder: base });
  const filename = `source-offer-${id}.json`;

  return new Response(sourceOfferJson(offer), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
