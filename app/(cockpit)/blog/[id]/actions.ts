"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/require-admin";
import { cancelBlogArticle, publishBlogArticleNow, updateBlogArticle } from "@/lib/blog-agent/service";

export type BlogArticleState = { ok?: boolean; message?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const idOf = (form: FormData) => { const id = form.get("article_id"); return typeof id === "string" && UUID.test(id) ? id : null; };
export async function updateBlogArticleAction(_state: BlogArticleState, form: FormData): Promise<BlogArticleState> {
  const { userId } = await requireAdmin(); const id = idOf(form);
  if (!id) return { ok: false, message: "Article invalide." };
  const r = await updateBlogArticle(userId, id, form); if (r.ok) revalidatePath(`/blog/${id}`); return r;
}
export async function cancelBlogArticleAction(_state: BlogArticleState, form: FormData): Promise<BlogArticleState> {
  const { userId } = await requireAdmin(); const id = idOf(form);
  if (!id) return { ok: false, message: "Article invalide." };
  const r = await cancelBlogArticle(userId, id); if (r.ok) revalidatePath(`/blog/${id}`); return r;
}
export async function publishBlogArticleNowAction(_state: BlogArticleState, form: FormData): Promise<BlogArticleState> {
  const { userId } = await requireAdmin(); const id = idOf(form);
  if (!id) return { ok: false, message: "Article invalide." };
  const r = await publishBlogArticleNow(userId, id); if (r.ok) revalidatePath(`/blog/${id}`); return r;
}
