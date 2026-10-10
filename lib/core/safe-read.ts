import "server-only";
// Lecture tolérante : un module dont la migration n'est pas encore appliquée (ou une panne passagère)
// affiche un état explicite au lieu de faire échouer la page entière.
export type SafeRead<T> = { data: T; unavailable: boolean };

export async function safeRead<T>(scope: string, read: () => Promise<T>, fallback: T): Promise<SafeRead<T>> {
  try {
    return { data: await read(), unavailable: false };
  } catch {
    console.error(`[${scope}] Lecture indisponible.`);
    return { data: fallback, unavailable: true };
  }
}

