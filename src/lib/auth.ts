import { config } from '@/lib/config';
import { NextRequest } from 'next/server';

export function validateCronSecret(request: NextRequest): boolean {
  const auth = request.headers.get('authorization');
  if (!auth) return false;
  const token = auth.replace('Bearer ', '');
  return token === config.CRON_SECRET;
}
