import { requireAdmin } from "@/lib/require-admin";
import { documentPdfContext, getReport } from "@/lib/reports/service";
import { clientDocuments } from "@/lib/reports/documents/model";
import { documentPdfFilename, renderReportDocumentPdf } from "@/lib/reports/documents/pdf";
import { clientReportPdfFilename, renderClientReportPdf } from "@/lib/reports/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Private download: never expose client reports through a public or signed anonymous URL. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const report = await getReport(id);
  if (!report) return new Response("Rapport introuvable.", { status: 404, headers: { "Cache-Control": "no-store" } });
  try {
    // ?doc=<agent> : PDF de ce document du rapport complet ; sinon le PDF client historique.
    const key = request.url ? new URL(request.url).searchParams.get("doc") : null;
    const document = key ? clientDocuments(report.client_content).find((item) => item.key === key) : null;
    if (key && !document) return new Response("Document introuvable.", { status: 404, headers: { "Cache-Control": "no-store" } });
    const context = documentPdfContext(report);
    const pdf = document ? renderReportDocumentPdf(context, document) : renderClientReportPdf(report);
    const filename = document ? documentPdfFilename(context, document, report.period_start) : clientReportPdfFilename(report);
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.byteLength),
        "Content-Disposition": 'attachment; filename="' + filename + '"',
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch {
    return new Response("Le PDF de ce rapport est indisponible.", { status: 422, headers: { "Cache-Control": "no-store" } });
  }
}
