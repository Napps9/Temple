// Client-side hooks for the site builder's Pexels stock-photo picker,
// mirroring useCustomDomainAction's invoke-an-edge-function shape.
// Both are mutations, not queries: searches are explicitly
// user-triggered and their results are transient modal-local state — a
// useQuery keyed on query strings would refetch on window focus and
// burn the platform-shared 200 req/hour Pexels budget for nothing.
// The archetype default queries live in site-templates.ts beside the
// template registry.

import { useMutation } from '@tanstack/react-query';

import { functionErrorMessage } from './errors';
import { supabase } from './supabase';

export type StockPhoto = {
  id: number;
  alt: string;
  photographer: string;
  photographer_url: string;
  thumb: string;
  avg_color: string;
};

export type StockPhotoSearchResult = {
  photos: StockPhoto[];
  page: number;
  has_more: boolean;
};

export type StockPhotoSaveResult = {
  url: string;
  alt: string;
  photographer: string;
  photographer_url: string;
};

// Plain async versions of the two mutations below — used directly (no
// hook, no component) by the site-creation auto-image flow
// (site-auto-images.ts), which runs from an event handler rather than
// render. The hooks are thin wrappers over these so the picker UI's
// existing external API (useMutation's isPending/error/etc.) doesn't
// change.
export async function searchStockPhotos(
  gymId: string,
  query: string,
  page?: number,
): Promise<StockPhotoSearchResult> {
  const { data, error } = await supabase.functions.invoke('stock-photos', {
    body: { action: 'search', gym_id: gymId, query, page },
  });
  if (error) throw new Error(await functionErrorMessage(error));
  return (data as StockPhotoSearchResult) ?? { photos: [], page: 1, has_more: false };
}

export async function saveStockPhoto(gymId: string, photoId: number): Promise<StockPhotoSaveResult> {
  const { data, error } = await supabase.functions.invoke('stock-photos', {
    body: { action: 'save', gym_id: gymId, photo_id: photoId },
  });
  if (error) throw new Error(await functionErrorMessage(error));
  return data as StockPhotoSaveResult;
}

export function useStockPhotoSearch(gymId: string | null | undefined) {
  return useMutation<StockPhotoSearchResult, Error, { query: string; page?: number }>({
    mutationFn: async ({ query, page }) => {
      if (!gymId) throw new Error('No gym selected');
      return searchStockPhotos(gymId, query, page);
    },
  });
}

export function useStockPhotoSave(gymId: string | null | undefined) {
  return useMutation<StockPhotoSaveResult, Error, { photoId: number }>({
    mutationFn: async ({ photoId }) => {
      if (!gymId) throw new Error('No gym selected');
      return saveStockPhoto(gymId, photoId);
    },
  });
}
