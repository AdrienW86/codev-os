import type { NextConfig } from "next";

// Studio vidéo : ffmpeg-static reste hors du bundle (chemin du binaire calculé à l'exécution) ; le binaire et la police
// Montserrat et les musiques de fond ne sont ajoutés qu'à la seule fonction qui rend une vidéo.
const motionVideoFiles = ["./node_modules/ffmpeg-static/ffmpeg", "./lib/motion/video/fonts/*.ttf", "./lib/motion/video/music/*.mp3"];

const nextConfig: NextConfig = {
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/studio/videos": motionVideoFiles,
  },
  async headers() {
    return [{ source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Service-Worker-Allowed", value: "/" }, { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'; connect-src 'self'" }] }];
  },
};

export default nextConfig;
