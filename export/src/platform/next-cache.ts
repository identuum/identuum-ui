/**
 * next/cache for the static export. A server action's revalidatePath means
 * "the data behind the page changed"; in the export the mounted route
 * re-runs its page in place, like router.refresh() in Next.
 */
import { revalidate } from "../router";

export function revalidatePath(_path: string, _type?: "page" | "layout"): void {
  revalidate();
}

export function revalidateTag(_tag: string): void {
  revalidate();
}
