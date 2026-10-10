/** Same-origin cockpit destinations only, including a push deep link after sign-in. */
export function cockpitReturnPath(input: unknown) {
  if (typeof input !== "string" || !input.startsWith("/") || input.startsWith("//") || input.includes("\\")) return "/dashboard";
  const url = new URL(input, "https://cockpit.invalid");
  if (url.origin !== "https://cockpit.invalid" || !/^\/(dashboard|notifications|advertising|reports|agents|clients|projects|work|tasks|agenda|settings|publications|recommendations|actions)(\/|$)/.test(url.pathname)) return "/dashboard";
  return `${url.pathname}${url.search}`;
}
