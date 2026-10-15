import { requireAdmin } from "@/lib/require-admin";
import { getReport } from "@/lib/reports/service";
import { clientReportPdfFilename, renderClientReportPdf } from "@/lib/reports/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Private download: never expose client reports through a public or signed anonymous URL. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const report = await getReport(id);
  if (!report) return new Response("Rapport introuvable.", { status: 404, headers: { "Cache-Control": "no-store" } });
  try {
    const pdf = renderClientReportPdf(report);
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.byteLength),
        "Content-Disposition": 'attachment; filename="' + clientReportPdfFilename(report) + '"',
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch {
    return new Response("Le PDF de ce rapport est indisponible.", { status: 422, headers: { "Cache-Control": "no-store" } });
  }
}
