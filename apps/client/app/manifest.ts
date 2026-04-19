import type { MetadataRoute } from "next";

/** Web app manifest — links generated Android / PWA icons in `public/`. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "JobLoom",
    short_name: "JobLoom",
    icons: [
      {
        src: "/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
