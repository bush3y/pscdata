import { useQuery } from '@tanstack/react-query';
import client from './client';
import type { FunnelRow, FunnelByRegionRow } from '../types';

export const useFunnel = (fiscal_years?: string[]) =>
  useQuery<FunnelRow[]>({
    queryKey: ['funnel', fiscal_years],
    queryFn: () => {
      const params = fiscal_years?.length ? { fiscal_year: fiscal_years } : {};
      return client.get('/funnel', { params }).then(r => r.data);
    },
  });

export const useFunnelByRegion = (fiscal_year?: string) =>
  useQuery<FunnelByRegionRow[]>({
    queryKey: ['funnel-region', fiscal_year],
    queryFn: () =>
      client.get('/funnel/by-region', { params: fiscal_year ? { fiscal_year } : {} }).then(r => r.data),
  });
