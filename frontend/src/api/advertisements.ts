import { useQuery } from '@tanstack/react-query';
import client from './client';
import type { AdvertisementSummary } from '../types';

export const useAdvertisementSummary = () =>
  useQuery<AdvertisementSummary[]>({
    queryKey: ['adv-summary'],
    queryFn: () => client.get('/advertisements/summary').then(r => r.data),
  });

export const useAdvertisementAggregate = (
  groupBy: string,
  metric: string = 'adv_count',
  filters: { fiscal_year?: string[]; organization?: string[] } = {},
  groupBy2?: string,
) => {
  const params = new URLSearchParams({ group_by: groupBy, metric });
  if (groupBy2) params.set('group_by2', groupBy2);
  filters.fiscal_year?.forEach(v => params.append('fiscal_year', v));
  filters.organization?.forEach(v => params.append('organization', v));
  return useQuery<{ x: string; category?: string; y: number }[]>({
    queryKey: ['adv-aggregate', groupBy, groupBy2, metric, filters],
    queryFn: () => client.get('/advertisements/aggregate', { params }).then(r => r.data),
    enabled: !!groupBy,
  });
};

interface FilterOptions {
  organization: string[];
  region: string[];
  status: string[];
  advertisement_type: string[];
  recruitment_program: string[];
  classifications: string[];
}

export const useFilterOptions = () =>
  useQuery<FilterOptions>({
    queryKey: ['adv-filter-options'],
    queryFn: () => client.get('/advertisements/filter-options').then(r => r.data),
    staleTime: 5 * 60 * 1000, // options don't change often
  });
