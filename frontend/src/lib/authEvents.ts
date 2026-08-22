export const unauthorizedEventName = "catcare:unauthorized";

export function notifyUnauthorized(status: number): void {
  if (status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event(unauthorizedEventName));
  }
}
