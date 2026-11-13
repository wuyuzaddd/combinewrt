import { getBuildService } from "@/lib/builds";
import { loadSourceOffer } from "@/lib/source-offer/load";
import { sourceOfferJson } from "@/lib/source-offer/manifest";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const build = getBuildService().get(id);
  if (!build) return Response.json({ error: "build not found" }, { status: 404 });

  const offer = loadSourceOffer(build);
  const filename = `source-offer-${id}.json`;

  return new Response(sourceOfferJson(offer), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
