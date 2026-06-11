import { revalidatePath, revalidateTag } from "next/cache";
import { jobDetailCacheTag, jobDetailPagePath } from "./jobDetailCacheTags";

export function revalidateJobDetailCaches(jobIds: string[]): string[] {
  const unique = [...new Set(jobIds.map((id) => id.trim()).filter(Boolean))];
  for (const id of unique) {
    revalidateTag(jobDetailCacheTag(id));
    revalidatePath(jobDetailPagePath(id));
  }
  return unique;
}
