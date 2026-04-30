import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client from './client';
import type { IngestLog } from '../types';

export const useIngestStatus = (refetchInterval?: number) =>
  useQuery<IngestLog[]>({
    queryKey: ['ingest-status'],
    queryFn: () => client.get('/ingest/status').then(r => r.data),
    refetchInterval,
  });

export const useIngestTrigger = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dataset_keys: string[] | 'all') =>
      client.post('/ingest', { dataset_keys }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ingest-status'] }),
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('Ingest trigger failed:', msg);
    },
  });
};
