import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ApplicationBootstrap } from '../app/bootstrap';
import { TYPES, container } from '../app/core/container';
import type { CreditService } from '../app/domain/services/billing/credit.service';

let serverPromise: Promise<void> | undefined;

function ensureInitialized(): Promise<void> {
  if (!serverPromise) {
    serverPromise = (async () => {
      const bootstrap = new ApplicationBootstrap({
        environment: 'production',
        enableMetrics: false,
        enableTracing: false,
        logLevel: 'info'
      });
      await bootstrap.initialize();
    })();
  }
  return serverPromise;
}

export default async function handler(
  _request: VercelRequest,
  response: VercelResponse
): Promise<void> {
  try {
    await ensureInitialized();

    const creditService = container.get<CreditService>(TYPES.CreditService);
    await creditService.resetCredits();

    response.status(200).json({ ok: true, message: 'Credit reset completed' });
  } catch (error) {
    console.error('Cron job failed:', error);
    response.status(500).json({ ok: false, error: (error as Error).message });
  }
}
