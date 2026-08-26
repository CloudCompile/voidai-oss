import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ApplicationBootstrap } from '../app/bootstrap';
import { ApplicationServer } from '../app/server';

let serverPromise: Promise<ApplicationServer> | undefined;

function getServer(): Promise<ApplicationServer> {
  if (!serverPromise) {
    serverPromise = (async () => {
      const bootstrap = new ApplicationBootstrap({
        environment: 'production',
        enableMetrics: false,
        enableTracing: false,
        logLevel: 'info'
      });
      const server = new ApplicationServer(bootstrap);
      await server.initialize();
      return server;
    })();
  }

  return serverPromise;
}

export default async function handler(
  request: VercelRequest,
  response: VercelResponse
): Promise<void> {
  try {
    const server = await getServer();
    const url = new URL(request.url || '/', `https://${request.headers.host || 'localhost'}`);
    if (url.pathname === '/api') {
      url.pathname = '/';
    } else if (url.pathname.startsWith('/api/')) {
      url.pathname = url.pathname.slice('/api'.length);
    }
    const headers = new Headers();

    for (const [key, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') {
        headers.set(key, value);
      } else if (Array.isArray(value)) {
        headers.set(key, value.join(', '));
      }
    }

    const body = request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : JSON.stringify(request.body);
    const webRequest = new Request(url, {
      method: request.method,
      headers,
      body
    });
    const webResponse = await server.getApp().handle(webRequest);

    response.status(webResponse.status);
    webResponse.headers.forEach((value, key) => response.setHeader(key, value));
    response.send(await webResponse.text());
  } catch (error) {
    console.error('Vercel request failed:', error);
    response.status(500).json({
      error: {
        message: 'The API is not configured for Vercel yet',
        type: 'configuration_error'
      }
    });
  }
}
