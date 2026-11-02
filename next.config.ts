import type { NextConfig } from "next";

// Vidéos motion design (TikTok) : ffmpeg-static reste hors du bundle (chemin du binaire calculé à l'exécution) ; le
// binaire et la police Montserrat sont ajoutés aux seules fonctions qui rendent une vidéo.
const motionVideoFiles = ["./node_modules/ffmpeg-static/ffmpeg", "./lib/motion/video/fonts/*.ttf"];

const nextConfig: NextConfig = {
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/publications/\\[id\\]/motion-video": motionVideoFiles,
    "/api/internal/scheduler/tick": motionVideoFiles,
  },
  async headers() {
    return [{ source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Service-Worker-Allowed", value: "/" }, { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'; connect-src 'self'" }] }];
  },
};

export default nextConfig;
