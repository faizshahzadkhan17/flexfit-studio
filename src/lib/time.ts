/** Hours between now and the given ISO timestamp (negative if it's already past). */
export function hoursUntil(iso: string, now = new Date()): number {
  return (new Date(iso).getTime() - now.getTime()) / 36e5;
}
