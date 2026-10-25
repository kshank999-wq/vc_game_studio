/**
 * "More from VC Software": the related VC apps this site shows, each sold on
 * its own site. Kept in step with vc-software-site's src/products.mjs (its
 * `related` for vc-game-studio); a product with no url yet shows as coming soon.
 */
export interface RelatedProduct {
  name: string;
  tagline: string;
  url: string | null;
}

export const VC_SOFTWARE_URL = 'https://www.vc-software.com';

export const RELATED: RelatedProduct[] = [
  { name: 'VC Writer', tagline: 'Write screenplays and novels in one place.', url: 'https://vc-writer.com' },
  { name: 'VC Film Studio', tagline: 'Run the whole production from one place.', url: null },
];
