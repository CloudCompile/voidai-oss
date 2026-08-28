import { injectable, inject } from 'inversify';
import { ApiRequest } from '../../domain/entities';
import type { ApiRequestRepository } from '../../domain/repositories';
import type { ILogger } from '../../core/logging';
import { TYPES } from '../../core/container/types';
import { getSupabaseAdmin } from '../supabase/client';

interface ApiRequestRow {
  id: string;
  user_id: string | null;
  endpoint: string;
  method: string;
  model: string | null;
  provider_id: string | null;
  sub_provider_id: string | null;
  ip_address: string;
  user_agent: string;
  tokens_used: number;
  credits_used: number;
  latency: number;
  request_size: number;
  response_size: number;
  status: string;
  status_code: number;
  error_message: string | null;
  retry_count: number;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
}

@injectable()
export class SupabaseApiRequestRepository implements ApiRequestRepository {
  private readonly logger: ILogger;

  constructor(@inject(TYPES.Logger) logger: ILogger) {
    this.logger = logger.createChild('SupabaseApiRequestRepository');
  }

  private rowToEntity(row: ApiRequestRow): ApiRequest {
    return new ApiRequest(
      {
        id: row.id,
        userId: row.user_id || '',
        createdAt: new Date(row.created_at).getTime()
      },
      {
        endpoint: row.endpoint,
        method: row.method,
        model: row.model || undefined,
        providerId: row.provider_id || undefined,
        subProviderId: row.sub_provider_id || undefined,
        ipAddress: row.ip_address,
        userAgent: row.user_agent
      },
      {
        tokensUsed: row.tokens_used,
        creditsUsed: Number(row.credits_used),
        latency: row.latency,
        responseSize: row.response_size,
        requestSize: row.request_size
      },
      {
        status: row.status as any,
        statusCode: row.status_code,
        errorMessage: row.error_message || undefined,
        retryCount: row.retry_count,
        completedAt: row.completed_at ? new Date(row.completed_at).getTime() : undefined
      }
    );
  }

  private entityToRow(req: ApiRequest): Record<string, any> {
    const identity = req.getIdentity();
    const details = req.getDetails();
    const metrics = req.getRequestMetrics();
    const status = req.getRequestStatus();
    return {
      id: identity.id,
      user_id: identity.userId || null,
      endpoint: details.endpoint,
      method: details.method,
      model: details.model || null,
      provider_id: details.providerId || null,
      sub_provider_id: details.subProviderId || null,
      ip_address: details.ipAddress,
      user_agent: details.userAgent,
      tokens_used: metrics.tokensUsed,
      credits_used: metrics.creditsUsed,
      latency: metrics.latency,
      request_size: metrics.requestSize,
      response_size: metrics.responseSize,
      status: status.status,
      status_code: status.statusCode,
      error_message: status.errorMessage || null,
      retry_count: status.retryCount,
      created_at: new Date(identity.createdAt).toISOString(),
      completed_at: status.completedAt ? new Date(status.completedAt).toISOString() : null,
      updated_at: new Date().toISOString()
    };
  }

  async findById(id: string): Promise<ApiRequest | null> {
    try {
      const { data, error } = await getSupabaseAdmin().from('api_requests').select('*').eq('id', id).single();
      if (error || !data) return null;
      return this.rowToEntity(data as ApiRequestRow);
    } catch (error) {
      this.logger.error('Failed to find API request by ID', error as Error, { metadata: { requestId: id } });
      throw error;
    }
  }

  async findByUserId(userId: string): Promise<ApiRequest[]> {
    try {
      const { data, error } = await getSupabaseAdmin().from('api_requests').select('*').eq('user_id', userId);
      if (error || !data) return [];
      return (data as ApiRequestRow[]).map(row => this.rowToEntity(row));
    } catch (error) {
      this.logger.error('Failed to find API requests by user ID', error as Error, { metadata: { userId } });
      throw error;
    }
  }

  async findByEndpoint(endpoint: string): Promise<ApiRequest[]> {
    try {
      const { data, error } = await getSupabaseAdmin().from('api_requests').select('*').eq('endpoint', endpoint);
      if (error || !data) return [];
      return (data as ApiRequestRow[]).map(row => this.rowToEntity(row));
    } catch (error) {
      this.logger.error('Failed to find API requests by endpoint', error as Error, { metadata: { endpoint } });
      throw error;
    }
  }

  async findByModel(model: string): Promise<ApiRequest[]> {
    try {
      const { data, error } = await getSupabaseAdmin().from('api_requests').select('*').eq('model', model);
      if (error || !data) return [];
      return (data as ApiRequestRow[]).map(row => this.rowToEntity(row));
    } catch (error) {
      this.logger.error('Failed to find API requests by model', error as Error, { metadata: { model } });
      throw error;
    }
  }

  async findByProviderId(providerId: string): Promise<ApiRequest[]> {
    try {
      const { data, error } = await getSupabaseAdmin().from('api_requests').select('*').eq('provider_id', providerId);
      if (error || !data) return [];
      return (data as ApiRequestRow[]).map(row => this.rowToEntity(row));
    } catch (error) {
      this.logger.error('Failed to find API requests by provider ID', error as Error, { metadata: { providerId } });
      throw error;
    }
  }

  async findByStatus(status: string): Promise<ApiRequest[]> {
    try {
      const { data, error } = await getSupabaseAdmin().from('api_requests').select('*').eq('status', status);
      if (error || !data) return [];
      return (data as ApiRequestRow[]).map(row => this.rowToEntity(row));
    } catch (error) {
      this.logger.error('Failed to find API requests by status', error as Error, { metadata: { status } });
      throw error;
    }
  }

  async findAll(): Promise<ApiRequest[]> {
    try {
      const { data, error } = await getSupabaseAdmin().from('api_requests').select('*').order('created_at', { ascending: false });
      if (error || !data) return [];
      return (data as ApiRequestRow[]).map(row => this.rowToEntity(row));
    } catch (error) {
      this.logger.error('Failed to find all API requests', error as Error);
      throw error;
    }
  }

  async save(request: ApiRequest): Promise<ApiRequest> {
    try {
      const row = this.entityToRow(request);
      const { error } = await getSupabaseAdmin().from('api_requests').upsert(row, { onConflict: 'id' });
      if (error) throw error;
      return request;
    } catch (error) {
      this.logger.error('Failed to save API request', error as Error, { metadata: { requestId: request.getId() } });
      throw error;
    }
  }

  async update(id: string, _updates: Partial<ApiRequest>): Promise<ApiRequest> {
    try {
      const existing = await this.findById(id);
      if (!existing) throw new Error(`API request ${id} not found`);
      const row = this.entityToRow(existing);
      row.updated_at = new Date().toISOString();
      const { error } = await getSupabaseAdmin().from('api_requests').update(row).eq('id', id);
      if (error) throw error;
      const updated = await this.findById(id);
      if (!updated) throw new Error(`API request ${id} not found after update`);
      return updated;
    } catch (error) {
      this.logger.error('Failed to update API request', error as Error, { metadata: { requestId: id } });
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      const { error } = await getSupabaseAdmin().from('api_requests').delete().eq('id', id);
      if (error) throw error;
    } catch (error) {
      this.logger.error('Failed to delete API request', error as Error, { metadata: { requestId: id } });
      throw error;
    }
  }

  async exists(id: string): Promise<boolean> {
    const { count, error } = await getSupabaseAdmin().from('api_requests').select('id', { count: 'exact', head: true }).eq('id', id);
    if (error) throw error;
    return (count ?? 0) > 0;
  }

  async findByDateRange(startDate: number, endDate: number): Promise<ApiRequest[]> {
    try {
      const { data, error } = await getSupabaseAdmin().from('api_requests').select('*')
        .gte('created_at', new Date(startDate).toISOString())
        .lte('created_at', new Date(endDate).toISOString());
      if (error || !data) return [];
      return (data as ApiRequestRow[]).map(row => this.rowToEntity(row));
    } catch (error) {
      this.logger.error('Failed to find API requests by date range', error as Error, { metadata: { startDate, endDate } });
      throw error;
    }
  }

  async findByUserAndDateRange(userId: string, startDate: number, endDate: number): Promise<ApiRequest[]> {
    try {
      const { data, error } = await getSupabaseAdmin().from('api_requests').select('*')
        .eq('user_id', userId)
        .gte('created_at', new Date(startDate).toISOString())
        .lte('created_at', new Date(endDate).toISOString());
      if (error || !data) return [];
      return (data as ApiRequestRow[]).map(row => this.rowToEntity(row));
    } catch (error) {
      this.logger.error('Failed to find API requests by user and date range', error as Error, { metadata: { userId, startDate, endDate } });
      throw error;
    }
  }

  async findCompleted(): Promise<ApiRequest[]> { return this.findByStatus('completed'); }
  async findFailed(): Promise<ApiRequest[]> {
    try {
      const { data, error } = await getSupabaseAdmin().from('api_requests').select('*').in('status', ['failed', 'timeout']);
      if (error || !data) return [];
      return (data as ApiRequestRow[]).map(row => this.rowToEntity(row));
    } catch (error) {
      this.logger.error('Failed to find failed API requests', error as Error);
      throw error;
    }
  }
  async findProcessing(): Promise<ApiRequest[]> { return this.findByStatus('processing'); }

  async findByLatencyRange(minLatency: number, maxLatency: number): Promise<ApiRequest[]> {
    const { data, error } = await getSupabaseAdmin().from('api_requests').select('*')
      .gte('latency', minLatency).lte('latency', maxLatency);
    if (error || !data) return [];
    return (data as ApiRequestRow[]).map(row => this.rowToEntity(row));
  }

  async findByTokenRange(minTokens: number, maxTokens: number): Promise<ApiRequest[]> {
    const { data, error } = await getSupabaseAdmin().from('api_requests').select('*')
      .gte('tokens_used', minTokens).lte('tokens_used', maxTokens);
    if (error || !data) return [];
    return (data as ApiRequestRow[]).map(row => this.rowToEntity(row));
  }

  async findByCreditRange(minCredits: number, maxCredits: number): Promise<ApiRequest[]> {
    const { data, error } = await getSupabaseAdmin().from('api_requests').select('*')
      .gte('credits_used', minCredits).lte('credits_used', maxCredits);
    if (error || !data) return [];
    return (data as ApiRequestRow[]).map(row => this.rowToEntity(row));
  }

  async getTotalRequests(): Promise<number> {
    const { count, error } = await getSupabaseAdmin().from('api_requests').select('id', { count: 'exact', head: true });
    if (error) throw error;
    return count ?? 0;
  }

  async getTotalTokensUsed(): Promise<number> {
    const { data, error } = await getSupabaseAdmin().from('api_requests').select('tokens_used');
    if (error || !data) return 0;
    return data.reduce((sum: number, row: any) => sum + (row.tokens_used || 0), 0);
  }

  async getTotalCreditsUsed(): Promise<number> {
    const { data, error } = await getSupabaseAdmin().from('api_requests').select('credits_used');
    if (error || !data) return 0;
    return data.reduce((sum: number, row: any) => sum + Number(row.credits_used || 0), 0);
  }

  async getAverageLatency(): Promise<number> {
    const { data, error } = await getSupabaseAdmin().from('api_requests').select('latency').eq('status', 'completed');
    if (error || !data || data.length === 0) return 0;
    return data.reduce((sum: number, row: any) => sum + (row.latency || 0), 0) / data.length;
  }

  async getSuccessRate(): Promise<number> {
    const total = await this.getTotalRequests();
    if (total === 0) return 0;
    const { count } = await getSupabaseAdmin().from('api_requests').select('id', { count: 'exact', head: true }).eq('status', 'completed');
    return (count ?? 0) / total;
  }

  async getRequestsByEndpoint(): Promise<Record<string, number>> {
    const { data, error } = await getSupabaseAdmin().from('api_requests').select('endpoint');
    if (error || !data) return {};
    const counts: Record<string, number> = {};
    for (const row of data) {
      counts[row.endpoint] = (counts[row.endpoint] || 0) + 1;
    }
    return counts;
  }

  async getRequestsByModel(): Promise<Record<string, number>> {
    const { data, error } = await getSupabaseAdmin().from('api_requests').select('model');
    if (error || !data) return {};
    const counts: Record<string, number> = {};
    for (const row of data) {
      if (row.model) counts[row.model] = (counts[row.model] || 0) + 1;
    }
    return counts;
  }

  async getRequestsByProvider(): Promise<Record<string, number>> {
    const { data, error } = await getSupabaseAdmin().from('api_requests').select('provider_id');
    if (error || !data) return {};
    const counts: Record<string, number> = {};
    for (const row of data) {
      if (row.provider_id) counts[row.provider_id] = (counts[row.provider_id] || 0) + 1;
    }
    return counts;
  }

  async getRequestsByStatus(): Promise<Record<string, number>> {
    const { data, error } = await getSupabaseAdmin().from('api_requests').select('status');
    if (error || !data) return {};
    const counts: Record<string, number> = {};
    for (const row of data) {
      counts[row.status] = (counts[row.status] || 0) + 1;
    }
    return counts;
  }

  async getRequestsByHour(hours: number): Promise<ApiRequest[]> {
    const startTime = Date.now() - (hours * 60 * 60 * 1000);
    const { data, error } = await getSupabaseAdmin().from('api_requests').select('*')
      .gte('created_at', new Date(startTime).toISOString());
    if (error || !data) return [];
    return (data as ApiRequestRow[]).map(row => this.rowToEntity(row));
  }

  async getRequestsByDay(days: number): Promise<ApiRequest[]> {
    const startTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    const { data, error } = await getSupabaseAdmin().from('api_requests').select('*')
      .gte('created_at', new Date(startTime).toISOString());
    if (error || !data) return [];
    return (data as ApiRequestRow[]).map(row => this.rowToEntity(row));
  }

  async getUserStats(userId: string): Promise<{
    totalRequests: number; totalTokensUsed: number; totalCreditsUsed: number;
    averageLatency: number; successRate: number;
  }> {
    const requests = await this.findByUserId(userId);
    if (requests.length === 0) return { totalRequests: 0, totalTokensUsed: 0, totalCreditsUsed: 0, averageLatency: 0, successRate: 0 };
    const completed = requests.filter(r => r.isCompleted());
    return {
      totalRequests: requests.length,
      totalTokensUsed: completed.reduce((s, r) => s + r.getTokensUsed(), 0),
      totalCreditsUsed: completed.reduce((s, r) => s + r.getCreditsUsed(), 0),
      averageLatency: completed.length > 0 ? completed.reduce((s, r) => s + r.getLatency(), 0) / completed.length : 0,
      successRate: requests.length > 0 ? completed.length / requests.length : 0
    };
  }

  async getProviderStats(providerId: string): Promise<{
    totalRequests: number; totalTokensUsed: number; averageLatency: number; successRate: number;
  }> {
    const requests = await this.findByProviderId(providerId);
    if (requests.length === 0) return { totalRequests: 0, totalTokensUsed: 0, averageLatency: 0, successRate: 0 };
    const completed = requests.filter(r => r.isCompleted());
    return {
      totalRequests: requests.length,
      totalTokensUsed: completed.reduce((s, r) => s + r.getTokensUsed(), 0),
      averageLatency: completed.length > 0 ? completed.reduce((s, r) => s + r.getLatency(), 0) / completed.length : 0,
      successRate: requests.length > 0 ? completed.length / requests.length : 0
    };
  }
}
