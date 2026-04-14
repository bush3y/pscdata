import { useQuery } from '@tanstack/react-query';
import client from './client';
import type { DatasetMeta } from '../types';

export const useDatasets = () =>
  useQuery<DatasetMeta[]>({
    queryKey: ['datasets'],
    queryFn: () => client.get('/datasets').then(r => r.data),
  });
