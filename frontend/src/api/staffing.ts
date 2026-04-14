import { useQuery } from '@tanstack/react-query';
import client from './client';

interface StaffingFilters {
  fiscal_year?: string[];
  department?: string;
}

function buildParams(filters: StaffingFilters) {
  const params = new URLSearchParams();
  filters.fiscal_year?.forEach(y => params.append('fiscal_year', y));
  if (filters.department) params.set('department', filters.department);
  return params;
}

export const useStaffingInflow = (filters: StaffingFilters = {}) =>
  useQuery({
    queryKey: ['staffing-inflow', filters],
    queryFn: () => client.get('/staffing/inflow', { params: buildParams(filters) }).then(r => r.data),
  });

export const useStaffingOutflow = (filters: StaffingFilters = {}) =>
  useQuery({
    queryKey: ['staffing-outflow', filters],
    queryFn: () => client.get('/staffing/outflow', { params: buildParams(filters) }).then(r => r.data),
  });

export const useStaffingMobility = (filters: StaffingFilters = {}) =>
  useQuery({
    queryKey: ['staffing-mobility', filters],
    queryFn: () => client.get('/staffing/mobility', { params: buildParams(filters) }).then(r => r.data),
  });

export const useStaffingAdvType = (filters: StaffingFilters = {}) =>
  useQuery({
    queryKey: ['staffing-adv-type', filters],
    queryFn: () => client.get('/staffing/adv-type', { params: buildParams(filters) }).then(r => r.data),
  });

export const useStaffingAdvAggregate = (
  groupBy: string,
  filters: StaffingFilters = {},
  groupBy2?: string,
) => {
  const params = buildParams(filters);
  params.set('group_by', groupBy);
  if (groupBy2) params.set('group_by2', groupBy2);
  return useQuery<{ x: string; category?: string; y: number }[]>({
    queryKey: ['staffing-adv-aggregate', groupBy, groupBy2, filters],
    queryFn: () => client.get('/staffing/adv-aggregate', { params }).then(r => r.data),
    enabled: !!groupBy,
  });
};

export const useStaffingAdvertisements = (filters: StaffingFilters = {}) =>
  useQuery({
    queryKey: ['staffing-advertisements', filters],
    queryFn: () => client.get('/staffing/advertisements', { params: buildParams(filters) }).then(r => r.data),
  });

interface SummaryYearRow { fiscal_year: string; total: number }
export interface StaffingSummary {
  q_count:           number;
  advertisements:    SummaryYearRow[];
  applications:      SummaryYearRow[];
  new_indeterminate: SummaryYearRow[];
  separations:       SummaryYearRow[];
  promotions:        SummaryYearRow[];
  lateral:           SummaryYearRow[];
  acting:            SummaryYearRow[];
}

export const useStaffingSummary = () =>
  useQuery<StaffingSummary>({
    queryKey: ['staffing-summary'],
    queryFn: () => client.get('/staffing/summary').then(r => r.data),
  });

export const useStaffingDemo = (dimension: string, filters: StaffingFilters = {}, hireE?: string) => {
  const params = buildParams(filters);
  if (hireE) params.set('hire_e', hireE);
  return useQuery({
    queryKey: ['staffing-demo', dimension, filters, hireE],
    queryFn: () =>
      client.get(`/staffing/demographics/${dimension}`, { params }).then(r => r.data),
    enabled: !!dimension,
  });
};

export const useStaffingPriority = () =>
  useQuery({
    queryKey: ['staffing-priority'],
    queryFn: () => client.get('/staffing/priority').then(r => r.data),
  });

export const useStaffingReappointments = (filters: StaffingFilters = {}) =>
  useQuery({
    queryKey: ['staffing-reappointments', filters],
    queryFn: () => client.get('/staffing/reappointments', { params: buildParams(filters) }).then(r => r.data),
  });

export const useStaffingVha = (tableNum: 1 | 2 | 3, filters: StaffingFilters = {}) => {
  const params = buildParams(filters);
  return useQuery({
    queryKey: ['staffing-vha', tableNum, filters],
    queryFn: () => client.get(`/staffing/vha/${tableNum}`, { params }).then(r => r.data),
  });
};
