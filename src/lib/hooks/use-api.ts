import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export function usePortfolio() {
  return useSWR('/api/dashboard/portfolio', fetcher, { refreshInterval: 30000 });
}

export function usePositions(status?: string) {
  return useSWR(`/api/dashboard/positions?status=${status || 'open'}`, fetcher, { refreshInterval: 30000 });
}

export function useTrades(page = 1) {
  return useSWR(`/api/dashboard/trades?page=${page}&limit=20`, fetcher, { refreshInterval: 60000 });
}

export function useEvaluations(page = 1) {
  return useSWR(`/api/dashboard/evaluations?page=${page}&limit=20`, fetcher, { refreshInterval: 60000 });
}

export function useRegime() {
  return useSWR('/api/dashboard/regime', fetcher, { refreshInterval: 60000 });
}

export function useStrategy() {
  return useSWR('/api/dashboard/strategy', fetcher, { refreshInterval: 60000 });
}

export function useReconciliation() {
  return useSWR('/api/dashboard/reconciliation', fetcher, { refreshInterval: 60000 });
}

export function useAlerts() {
  return useSWR('/api/dashboard/alerts?acknowledged=false&limit=20', fetcher, { refreshInterval: 15000 });
}
