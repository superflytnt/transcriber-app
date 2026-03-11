import { getSessionFromRequest } from "./session";

export function getCurrentUser(request: Request): string | null {
  return getSessionFromRequest(request);
}
