import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return { id: "/", name: "CODE-V OS", short_name: "CODE-V", description: "Cockpit interne CODE-V", start_url: "/dashboard", scope: "/", display: "standalone", background_color: "#101310", theme_color: "#101310", lang: "fr", icons: [{ src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" }, { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }] };
}
