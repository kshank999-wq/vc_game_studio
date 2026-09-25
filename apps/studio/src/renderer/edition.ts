/** Where the preview edition sends people who want to keep their work. */
export const PURCHASE_URL = 'https://vc-writer.com/';

export const isPreview = (): boolean => __EDITION__ === 'preview';
