export type Incident = {
  id: string;
  type: 'medical' | 'hazard' | 'supply' | 'general';
  message: string;
  timestamp: number;
  author: string;
  locationName: string;
  location: { lat: number; lng: number } | null;
  // Optional photo of the scene, base64-encoded JPEG. Sized for the mesh
  // (~30 KB on wire); see src/utils/imageResize.ts. Travels inside the signed
  // envelope, so verify still passes.
  imageB64?: string;
  // Optional cached AI vision analysis from a previous ANALYZE call. Lives on
  // the local copy only — not part of the signed payload — and is filled in
  // after VisionAnalyzeService returns. Keeps the analyse-once UX usable.
  visionAnalysis?: string;
};

// Seed feed shown on a fresh install. Locations are intentionally null so the
// map starts empty rather than pinning fake reports to a hardcoded city.
// Real reports created via FeedScreen + GPS will populate the map.
export const MOCK_FEED: Incident[] = [];

export const MOCK_USER = 'Me (Offline)';
