import { useQuery } from '@tanstack/react-query';
import client from './client';

export const PS_TOTAL = 'Federal Public Service';

export interface SnpsQuestion {
  question: string;
  category_e: string;
  category_f: string;
  theme_e: string;
  theme_f: string;
  question_e: string;
  question_f: string;
}

export interface SnpsResponseRow {
  year: number;
  dept_e: string;
  dept_f: string;
  question_value_e: string;
  question_value_f: string;
  shr_w_resp: number;
  total_w_resp: number;
}

export const useSnpsYears = () =>
  useQuery<number[]>({
    queryKey: ['snps-years'],
    queryFn: () => client.get('/snps/years').then(r => r.data),
    staleTime: 30_000,
  });

export const useSnpsDepartments = () =>
  useQuery<string[]>({
    queryKey: ['snps-departments'],
    queryFn: () => client.get('/snps/departments').then(r => r.data),
    staleTime: 60_000,
  });

export const useSnpsQuestions = (year?: number) =>
  useQuery<SnpsQuestion[]>({
    queryKey: ['snps-questions', year],
    queryFn: () => client.get('/snps/questions', { params: year ? { year } : {} }).then(r => r.data),
    staleTime: 60_000,
  });

export const useSnpsResponses = (question: string | null, dept: string | null, year?: number) =>
  useQuery<SnpsResponseRow[]>({
    queryKey: ['snps-responses', question, dept, year],
    queryFn: () => client.get('/snps/responses', {
      params: { question, ...(dept ? { dept } : {}), ...(year ? { year } : {}) },
    }).then(r => r.data),
    enabled: !!question,
    staleTime: 5 * 60_000,
  });

export const useSnpsTrend = (question: string | null, dept: string | null) =>
  useQuery<SnpsResponseRow[]>({
    queryKey: ['snps-trend', question, dept],
    queryFn: () => client.get('/snps/trend', {
      params: { question, ...(dept ? { dept } : {}) },
    }).then(r => r.data),
    enabled: !!question,
    staleTime: 5 * 60_000,
  });

export interface SnpsDeptScore {
  dept_e: string;
  positive_pct: number;
  n_respondents: number;
}

export const useSnpsDeptScores = (question: string | null, year: number | null) =>
  useQuery<SnpsDeptScore[]>({
    queryKey: ['snps-dept-scores', question, year],
    queryFn: () => client.get('/snps/dept-scores', {
      params: { question, ...(year ? { year } : {}) },
    }).then(r => r.data),
    enabled: !!question,
    staleTime: 5 * 60_000,
  });
