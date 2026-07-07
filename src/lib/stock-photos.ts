// Client-side hooks for the site builder's Pexels stock-photo picker,
// mirroring useCustomDomainAction's invoke-an-edge-function shape.
// Both are mutations, not queries: searches are explicitly
// user-triggered and their results are transient modal-local state — a
// useQuery keyed on query strings would refetch on window focus and
// burn the platform-shared 200 req/hour Pexels budget for nothing.
// The archetype default queries live in site-templates.ts beside the
// template registry.

import { useMutation } from '@tanstack/react-query';

import { functionErrorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

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

export function useStockPhotoSearch(gymId: string | null | undefined) {
  return useMutation<StockPhotoSearchResult, Error, { query: string; page?: number }>({
    mutationFn: async ({ query, page }) => {
      if (!gymId) throw new Error('No gym selected');
      const { data, error } = await supabase.functions.invoke('stock-photos', {
        body: { action: 'search', gym_id: gymId, query, page },
      });
      if (error) throw new Error(await functionErrorMessage(error));
      return (data as StockPhotoSearchResult) ?? { photos: [], page: 1, has_more: false };
    },
  });
}

export function useStockPhotoSave(gymId: string | null | undefined) {
  return useMutation<StockPhotoSaveResult, Error, { photoId: number }>({
    mutationFn: async ({ photoId }) => {
      if (!gymId) throw new Error('No gym selected');
      const { data, error } = await supabase.functions.invoke('stock-photos', {
        body: { action: 'save', gym_id: gymId, photo_id: photoId },
      });
      if (error) throw new Error(await functionErrorMessage(error));
      return data as StockPhotoSaveResult;
    },
  });
}
