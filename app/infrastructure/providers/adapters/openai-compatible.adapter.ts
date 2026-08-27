import { injectable } from 'inversify';
import { BaseProviderAdapter, type ProviderConfiguration } from '../base.js';
import type { ILogger } from '../../../core/logging';
import type { MetricsService } from '../../../core/metrics';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  StreamChunk,
  SpeechRequest,
  AudioTranscriptionRequest,
  TranscriptionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  ImageGenerationRequest,
  ImageEditRequest,
  ImageResponse,
  ModerationRequest,
  ModerationResponse
} from '../../../application/types.js';

export interface CustomProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  capabilities: {
    chat: boolean;
    audio: boolean;
    embeddings: boolean;
    images: boolean;
    moderation: boolean;
  };
  timeout: number;
}

/**
 * Reads custom provider definitions from environment variables.
 *
 * For each provider, set these env vars:
 *   CUSTOM_PROVIDER_<NAME>_BASE_URL   — required, e.g. http://localhost:1234/v1
 *   CUSTOM_PROVIDER_<NAME>_API_KEY    — optional, defaults to "no-key"
 *   CUSTOM_PROVIDER_<NAME>_MODELS     — optional, comma-separated list of model IDs
 *   CUSTOM_PROVIDER_<NAME>_CAPABILITIES — optional, comma-separated: chat,audio,embeddings,images,moderation
 *   CUSTOM_PROVIDER_<NAME>_TIMEOUT    — optional, request timeout in ms (default 60000)
 *
 * Example for a local LM Studio instance:
 *   CUSTOM_PROVIDER_LMSTUDIO_BASE_URL=http://localhost:1234/v1
 *   CUSTOM_PROVIDER_LMSTUDIO_API_KEY=no-key
 *   CUSTOM_PROVIDER_LMSTUDIO_MODELS=llama-3,mistral-7b,codellama
 *   CUSTOM_PROVIDER_LMSTUDIO_CAPABILITIES=chat
 *
 * Example for a vLLM deployment:
 *   CUSTOM_PROVIDER_VLLM_BASE_URL=https://my-vllm.example.com/v1
 *   CUSTOM_PROVIDER_VLLM_API_KEY=sk-xxx
 *   CUSTOM_PROVIDER_VLLM_MODELS=meta-llama/Llama-3-70B
 *   CUSTOM_PROVIDER_VLLM_CAPABILITIES=chat,embeddings
 */
export function discoverCustomProviders(): CustomProviderConfig[] {
  const providers: CustomProviderConfig[] = [];
  const prefix = 'CUSTOM_PROVIDER_';
  const suffixes = ['BASE_URL', 'API_KEY', 'MODELS', 'CAPABILITIES', 'TIMEOUT'];

  // Collect all unique provider names from env vars
  const providerNames = new Set<string>();
  for (const key of Object.keys(process.env)) {
    if (key.startsWith(prefix)) {
      const remainder = key.slice(prefix.length);
      for (const suffix of suffixes) {
        if (remainder.endsWith(suffix)) {
          const name = remainder.slice(0, -suffix.length - 1);
          if (name.length > 0) {
            providerNames.add(name);
          }
        }
      }
    }
  }

  for (const name of providerNames) {
    const baseUrl = process.env[`${prefix}${name}_BASE_URL`];
    if (!baseUrl) {
      continue; // BASE_URL is required
    }

    const apiKey = process.env[`${prefix}${name}_API_KEY`] || 'no-key';
    const modelsRaw = process.env[`${prefix}${name}_MODELS`] || '';
    const models = modelsRaw
      .split(',')
      .map(m => m.trim())
      .filter(m => m.length > 0);
    const timeout = parseInt(process.env[`${prefix}${name}_TIMEOUT`] || '60000', 10);

    const capsRaw = (process.env[`${prefix}${name}_CAPABILITIES`] || 'chat').toLowerCase();
    const caps = capsRaw.split(',').map(c => c.trim());
    const capabilities = {
      chat: caps.includes('chat'),
      audio: caps.includes('audio'),
      embeddings: caps.includes('embeddings'),
      images: caps.includes('images'),
      moderation: caps.includes('moderation')
    };

    providers.push({
      name: name.toLowerCase(),
      baseUrl: baseUrl.replace(/\/+$/, ''),
      apiKey,
      models,
      capabilities,
      timeout
    });
  }

  return providers;
}

/**
 * A generic adapter for any OpenAI-compatible API endpoint.
 *
 * The adapter is constructed dynamically by the registry using the config
 * produced by `discoverCustomProviders()`. It speaks the same wire format
 * as the OpenAI adapter but targets a custom base URL and model list.
 */
@injectable()
export class OpenAICompatibleAdapter extends BaseProviderAdapter {
  private readonly customName: string;

  constructor(
    customConfig: CustomProviderConfig,
    apiKey: string,
    logger: ILogger,
    metricsService: MetricsService
  ) {
    const configuration: ProviderConfiguration = {
      name: customConfig.name,
      apiKey: apiKey || customConfig.apiKey,
      baseUrl: customConfig.baseUrl,
      timeout: customConfig.timeout,
      maxRetries: 3,
      rateLimitPerMinute: 60,
      requiresApiKey: customConfig.apiKey !== 'no-key',
      supportedModels: customConfig.models,
      capabilities: customConfig.capabilities
    };

    super(configuration, logger, metricsService);
    this.customName = customConfig.name;
  }

  protected async executeChatCompletion(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse | AsyncIterable<StreamChunk>> {
    if (request.stream) {
      return this.createStreamResponse('/chat/completions', request);
    }

    const response = await this.makeHttpRequest<ChatCompletionResponse>(
      '/chat/completions',
      'POST',
      request
    );

    return response;
  }

  protected async executeTextToSpeech(_request: SpeechRequest): Promise<ArrayBuffer> {
    throw new Error(`Provider ${this.customName} does not support text-to-speech`);
  }

  protected async executeAudioTranscription(_request: AudioTranscriptionRequest): Promise<TranscriptionResponse> {
    throw new Error(`Provider ${this.customName} does not support audio transcription`);
  }

  protected async executeCreateEmbeddings(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const response = await this.makeHttpRequest<EmbeddingResponse>(
      '/embeddings',
      'POST',
      request
    );
    return response;
  }

  protected async executeGenerateImages(request: ImageGenerationRequest): Promise<ImageResponse> {
    const payload = {
      model: request.model,
      prompt: request.prompt,
      n: request.n || 1,
      size: request.size || '1024x1024'
    };

    const response = await this.makeHttpRequest<any>(
      '/images/generations',
      'POST',
      payload
    );

    return {
      created: response.created,
      data: response.data
    };
  }

  protected async executeEditImages(_request: ImageEditRequest): Promise<ImageResponse> {
    throw new Error(`Provider ${this.customName} does not support image editing`);
  }

  protected async executeModerateContent(_request: ModerationRequest): Promise<ModerationResponse> {
    throw new Error(`Provider ${this.customName} does not support content moderation`);
  }

  private async *createStreamResponse(
    endpoint: string,
    request: ChatCompletionRequest
  ): AsyncIterable<StreamChunk> {
    const response = await fetch(`${this.configuration.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: this.createHttpHeaders(),
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.configuration.timeout)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${this.customName} streaming API error: ${response.status} - ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Failed to get response stream reader');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              yield JSON.parse(data) as StreamChunk;
            } catch {
              this.logger.warn('Failed to parse stream chunk', {
                metadata: { line, provider: this.customName }
              });
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
