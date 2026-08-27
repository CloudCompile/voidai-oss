import { injectable, inject } from 'inversify';
import { SubProvider } from '../../domain/entities.js';
import type { SubProviderRepository } from '../../domain/repositories';
import type { ILogger } from '../../core/logging';
import { TYPES } from '../../core/container';
import { getSupabaseAdmin } from '../supabase/client.js';

interface SubProviderRow {
  id: string;
  provider_id: string;
  name: string;
  configuration: any;
  metrics: any;
  limits: any;
  created_at: string;
  updated_at: string;
}

@injectable()
export class SupabaseSubProviderRepository implements SubProviderRepository {
  private readonly logger: ILogger;

  constructor(@inject(TYPES.Logger) logger: ILogger) {
    this.logger = logger.createChild('SupabaseSubProviderRepository');
  }

  private rowToEntity(row: SubProviderRow): SubProvider {
    return new SubProvider(
      {
        id: row.id,
        providerId: row.provider_id,
        name: row.name,
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime()
      },
      row.configuration || {},
      row.metrics || {},
      row.limits || {}
    );
  }

  private entityToRow(sp: SubProvider): Record<string, any> {
    const identity = sp.getIdentity();
    return {
      id: identity.id,
      provider_id: identity.providerId,
      name: identity.name,
      configuration: sp.getConfiguration(),
      metrics: sp.getMetrics(),
      limits: sp.getFullLimits(),
      updated_at: new Date().toISOString()
    };
  }

  async findById(id: string): Promise<SubProvider | null> {
    try {
      const { data, error } = await getSupabaseAdmin().from('sub_providers').select('*').eq('id', id).single();
      if (error || !data) return null;
      return this.rowToEntity(data as SubProviderRow);
    } catch (error) {
      this.logger.error('Failed to find sub-provider by ID', error as Error, { metadata: { subProviderId: id } });
      throw error;
    }
  }

  async findByProviderId(providerId: string): Promise<SubProvider[]> {
    try {
      const { data, error } = await getSupabaseAdmin().from('sub_providers').select('*').eq('provider_id', providerId);
      if (error || !data) return [];
      return (data as SubProviderRow[]).map(row => this.rowToEntity(row));
    } catch (error) {
      this.logger.error('Failed to find sub-providers by provider ID', error as Error, { metadata: { providerId } });
      throw error;
    }
  }

  async findByName(name: string): Promise<SubProvider | null> {
    try {
      const { data, error } = await getSupabaseAdmin().from('sub_providers').select('*').eq('name', name).single();
      if (error || !data) return null;
      return this.rowToEntity(data as SubProviderRow);
    } catch (error) {
      this.logger.error('Failed to find sub-provider by name', error as Error, { metadata: { name } });
      throw error;
    }
  }

  async findAll(): Promise<SubProvider[]> {
    try {
      const { data, error } = await getSupabaseAdmin().from('sub_providers').select('*');
      if (error || !data) return [];
      return (data as SubProviderRow[]).map(row => this.rowToEntity(row));
    } catch (error) {
      this.logger.error('Failed to find all sub-providers', error as Error);
      throw error;
    }
  }

  async findActive(): Promise<SubProvider[]> {
    try {
      const { data, error } = await getSupabaseAdmin().from('sub_providers').select('*');
      if (error || !data) return [];
      return (data as SubProviderRow[])
        .map(row => this.rowToEntity(row))
        .filter(sp => sp.isEnabled());
    } catch (error) {
      this.logger.error('Failed to find active sub-providers', error as Error);
      throw error;
    }
  }

  async findAvailable(): Promise<SubProvider[]> {
    try {
      const all = await this.findAll();
      return all.filter(sp => sp.isAvailable());
    } catch (error) {
      this.logger.error('Failed to find available sub-providers', error as Error);
      throw error;
    }
  }

  async findHealthy(): Promise<SubProvider[]> {
    try {
      const all = await this.findAll();
      return all.filter(sp => sp.isHealthy());
    } catch (error) {
      this.logger.error('Failed to find healthy sub-providers', error as Error);
      throw error;
    }
  }

  async save(subProvider: SubProvider): Promise<SubProvider> {
    try {
      const row = this.entityToRow(subProvider);
      row.created_at = new Date(subProvider.getCreatedAt()).toISOString();
      const { error } = await getSupabaseAdmin().from('sub_providers').upsert(row, { onConflict: 'id' });
      if (error) throw error;
      return subProvider;
    } catch (error) {
      this.logger.error('Failed to save sub-provider', error as Error, { metadata: { subProviderId: subProvider.getId() } });
      throw error;
    }
  }

  async update(id: string, _updates: Partial<SubProvider>): Promise<SubProvider> {
    try {
      const existing = await this.findById(id);
      if (!existing) throw new Error(`Sub-provider ${id} not found`);
      const row = this.entityToRow(existing);
      const { updated_at, ...rest } = row;
      const updateRow: Record<string, any> = { ...rest, updated_at: new Date().toISOString() };
      const { error } = await getSupabaseAdmin().from('sub_providers').update(updateRow).eq('id', id);
      if (error) throw error;
      const updated = await this.findById(id);
      if (!updated) throw new Error(`Sub-provider ${id} not found after update`);
      return updated;
    } catch (error) {
      this.logger.error('Failed to update sub-provider', error as Error, { metadata: { subProviderId: id } });
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      const { error } = await getSupabaseAdmin().from('sub_providers').delete().eq('id', id);
      if (error) throw error;
    } catch (error) {
      this.logger.error('Failed to delete sub-provider', error as Error, { metadata: { subProviderId: id } });
      throw error;
    }
  }

  async exists(id: string): Promise<boolean> {
    const { count, error } = await getSupabaseAdmin().from('sub_providers').select('id', { count: 'exact', head: true }).eq('id', id);
    if (error) throw error;
    return (count ?? 0) > 0;
  }

  async findByCircuitBreakerState(state: 'closed' | 'open' | 'half-open'): Promise<SubProvider[]> {
    try {
      const all = await this.findAll();
      return all.filter(sp => sp.getCircuitBreakerState() === state);
    } catch (error) {
      this.logger.error('Failed to find sub-providers by circuit breaker state', error as Error, { metadata: { state } });
      throw error;
    }
  }

  async findSupportingModel(model: string): Promise<SubProvider[]> {
    try {
      const all = await this.findAll();
      return all.filter(sp => sp.supportsModel(model));
    } catch (error) {
      this.logger.error('Failed to find sub-providers supporting model', error as Error, { metadata: { model } });
      throw error;
    }
  }

  async findByPriority(minPriority: number): Promise<SubProvider[]> {
    try {
      const all = await this.findAll();
      return all.filter(sp => sp.getPriority() >= minPriority);
    } catch (error) {
      this.logger.error('Failed to find sub-providers by priority', error as Error, { metadata: { minPriority } });
      throw error;
    }
  }

  async findByWeight(minWeight: number): Promise<SubProvider[]> {
    try {
      const all = await this.findAll();
      return all.filter(sp => sp.getWeight() >= minWeight);
    } catch (error) {
      this.logger.error('Failed to find sub-providers by weight', error as Error, { metadata: { minWeight } });
      throw error;
    }
  }

  async recordSuccess(id: string, latency: number, tokensUsed: number): Promise<void> {
    const sp = await this.findById(id);
    if (sp) {
      sp.recordSuccess(latency, tokensUsed);
      await this.save(sp);
    }
  }

  async recordError(id: string, errorType: string): Promise<void> {
    const sp = await this.findById(id);
    if (sp) {
      sp.recordError(errorType);
      await this.save(sp);
    }
  }

  async updateLimits(id: string, requestCount: number, tokenCount: number, concurrentRequests: number): Promise<void> {
    const sp = await this.findById(id);
    if (sp) {
      sp.updateLimits(requestCount, tokenCount, concurrentRequests);
      await this.save(sp);
    }
  }

  async openCircuitBreaker(id: string): Promise<void> {
    const sp = await this.findById(id);
    if (sp) {
      sp.openCircuitBreaker();
      await this.save(sp);
    }
  }

  async closeCircuitBreaker(id: string): Promise<void> {
    const sp = await this.findById(id);
    if (sp) {
      sp.closeCircuitBreaker();
      await this.save(sp);
    }
  }

  async halfOpenCircuitBreaker(id: string): Promise<void> {
    const sp = await this.findById(id);
    if (sp) {
      sp.halfOpenCircuitBreaker();
      await this.save(sp);
    }
  }

  async getTopPerformers(limit: number): Promise<SubProvider[]> {
    const all = await this.findAll();
    return all
      .filter(sp => sp.isEnabled() && sp.isHealthy())
      .sort((a, b) => b.getSuccessRate() - a.getSuccessRate())
      .slice(0, limit);
  }

  async getLeastUsed(limit: number): Promise<SubProvider[]> {
    const all = await this.findAll();
    return all
      .filter(sp => sp.isEnabled() && sp.isHealthy())
      .sort((a, b) => a.getTotalRequests() - b.getTotalRequests())
      .slice(0, limit);
  }

  async getTotalTokenUsage(): Promise<number> {
    const all = await this.findAll();
    return all.reduce((sum, sp) => sum + sp.getTotalTokenUsage(), 0);
  }

  async getAverageLatency(): Promise<number> {
    const all = await this.findAll();
    if (all.length === 0) return 0;
    return all.reduce((sum, sp) => sum + sp.getAvgLatency(), 0) / all.length;
  }

  async countByStatus(): Promise<Record<string, number>> {
    const all = await this.findAll();
    const counts: Record<string, number> = {};
    for (const sp of all) {
      const status = sp.isEnabled() ? 'active' : 'disabled';
      counts[status] = (counts[status] || 0) + 1;
    }
    return counts;
  }

  async countByCircuitBreakerState(): Promise<Record<string, number>> {
    const all = await this.findAll();
    const counts: Record<string, number> = {};
    for (const sp of all) {
      const state = sp.getCircuitBreakerState();
      counts[state] = (counts[state] || 0) + 1;
    }
    return counts;
  }
}
