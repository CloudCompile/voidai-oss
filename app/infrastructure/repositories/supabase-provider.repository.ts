import { injectable, inject } from 'inversify';
import { Provider } from '../../domain/entities.js';
import type { ProviderRepository } from '../../domain/repositories';
import type { ILogger } from '../../core/logging';
import { TYPES } from '../../core/container';
import { getSupabaseAdmin } from '../supabase/client.js';

interface ProviderRow {
  id: string;
  name: string;
  display_name: string;
  configuration: any;
  metrics: any;
  costs: any;
  security: any;
  created_at: string;
  updated_at: string;
}

@injectable()
export class SupabaseProviderRepository implements ProviderRepository {
  private readonly logger: ILogger;

  constructor(@inject(TYPES.Logger) logger: ILogger) {
    this.logger = logger.createChild('SupabaseProviderRepository');
  }

  private rowToEntity(row: ProviderRow): Provider {
    return new Provider(
      {
        id: row.id,
        name: row.name,
        displayName: row.display_name,
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime()
      },
      row.configuration || {},
      row.metrics || {},
      row.costs || {},
      row.security || {}
    );
  }

  private entityToRow(provider: Provider): Record<string, any> {
    const identity = provider.getIdentity();
    return {
      id: identity.id,
      name: identity.name,
      display_name: identity.displayName,
      configuration: provider.getConfiguration(),
      metrics: provider.getMetrics(),
      costs: provider.getCostMetrics(),
      security: provider.getSecurity(),
      updated_at: new Date().toISOString()
    };
  }

  private async query(filter?: (qb: any) => any): Promise<Provider[]> {
    let q = getSupabaseAdmin().from('providers').select('*');
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error || !data) return [];
    return (data as ProviderRow[]).map(row => this.rowToEntity(row));
  }

  async findById(id: string): Promise<Provider | null> {
    try {
      const { data, error } = await getSupabaseAdmin().from('providers').select('*').eq('id', id).single();
      if (error || !data) return null;
      return this.rowToEntity(data as ProviderRow);
    } catch (error) {
      this.logger.error('Failed to find provider by ID', error as Error, { metadata: { providerId: id } });
      throw error;
    }
  }

  async findByName(name: string): Promise<Provider | null> {
    try {
      const { data, error } = await getSupabaseAdmin().from('providers').select('*').eq('name', name).single();
      if (error || !data) return null;
      return this.rowToEntity(data as ProviderRow);
    } catch (error) {
      this.logger.error('Failed to find provider by name', error as Error, { metadata: { name } });
      throw error;
    }
  }

  async findAll(): Promise<Provider[]> { return this.query(); }

  async findActive(): Promise<Provider[]> {
    return this.query(q => q.contains('configuration', { isActive: true }));
  }

  async findByVendor(vendor: string): Promise<Provider[]> {
    return this.query(q => q.ilike('name', `%${vendor}%`));
  }

  async save(provider: Provider): Promise<Provider> {
    try {
      const row = this.entityToRow(provider);
      row.created_at = new Date(provider.getCreatedAt()).toISOString();
      const { error } = await getSupabaseAdmin().from('providers').upsert(row, { onConflict: 'id' });
      if (error) throw error;
      return provider;
    } catch (error) {
      this.logger.error('Failed to save provider', error as Error, { metadata: { providerId: provider.getId() } });
      throw error;
    }
  }

  async update(id: string, _updates: Partial<Provider>): Promise<Provider> {
    try {
      const existing = await this.findById(id);
      if (!existing) throw new Error(`Provider ${id} not found`);
      const row = this.entityToRow(existing);
      const { updated_at, ...rest } = row;
      const updateRow: Record<string, any> = { ...rest, updated_at: new Date().toISOString() };
      const { error } = await getSupabaseAdmin().from('providers').update(updateRow).eq('id', id);
      if (error) throw error;
      const updated = await this.findById(id);
      if (!updated) throw new Error(`Provider ${id} not found after update`);
      return updated;
    } catch (error) {
      this.logger.error('Failed to update provider', error as Error, { metadata: { providerId: id } });
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      const { error } = await getSupabaseAdmin().from('providers').delete().eq('id', id);
      if (error) throw error;
    } catch (error) {
      this.logger.error('Failed to delete provider', error as Error, { metadata: { providerId: id } });
      throw error;
    }
  }

  async exists(id: string): Promise<boolean> {
    const { count, error } = await getSupabaseAdmin().from('providers').select('id', { count: 'exact', head: true }).eq('id', id);
    if (error) throw error;
    return (count ?? 0) > 0;
  }

  async findHealthy(): Promise<Provider[]> {
    return this.query(q => q.contains('metrics', { healthStatus: 'healthy' }));
  }

  async findByPriority(minPriority: number): Promise<Provider[]> {
    return this.query(q => q.gte('configuration->>priority', minPriority));
  }

  async findSupportingModel(model: string): Promise<Provider[]> {
    // JSONB array containment check
    const { data, error } = await getSupabaseAdmin()
      .from('providers').select('*')
      .contains('configuration->supportedModels', [model]);
    if (error || !data) return [];
    return (data as ProviderRow[]).map(row => this.rowToEntity(row));
  }

  async findSupportingFeature(feature: string): Promise<Provider[]> {
    const { data, error } = await getSupabaseAdmin()
      .from('providers').select('*')
      .contains('configuration->features', [feature]);
    if (error || !data) return [];
    return (data as ProviderRow[]).map(row => this.rowToEntity(row));
  }

  async updateMetrics(id: string, metrics: any): Promise<void> {
    const { error } = await getSupabaseAdmin()
      .from('providers').update({ metrics, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  }

  async updateHealthStatus(id: string, status: 'healthy' | 'degraded' | 'unhealthy'): Promise<void> {
    const provider = await this.findById(id);
    if (provider) {
      const metrics = provider.getMetrics();
      metrics.healthStatus = status;
      await this.updateMetrics(id, metrics);
    }
  }

  async recordSuccess(id: string, latency: number, tokensUsed: number, cost: number): Promise<void> {
    const provider = await this.findById(id);
    if (provider) {
      provider.recordSuccess(latency, tokensUsed, cost);
      await this.save(provider);
    }
  }

  async recordError(id: string, errorType: string): Promise<void> {
    const provider = await this.findById(id);
    if (provider) {
      provider.recordError(errorType);
      await this.save(provider);
    }
  }

  async getTopPerformers(limit: number): Promise<Provider[]> {
    const { data, error } = await getSupabaseAdmin()
      .from('providers').select('*')
      .contains('configuration', { isActive: true })
      .order('metrics->>successCount', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as ProviderRow[]).map(row => this.rowToEntity(row));
  }

  async getLeastUsed(limit: number): Promise<Provider[]> {
    const { data, error } = await getSupabaseAdmin()
      .from('providers').select('*')
      .contains('configuration', { isActive: true })
      .order('metrics->>totalRequests', { ascending: true })
      .limit(limit);
    if (error || !data) return [];
    return (data as ProviderRow[]).map(row => this.rowToEntity(row));
  }

  async getTotalTokenUsage(): Promise<number> {
    const { data, error } = await getSupabaseAdmin().from('providers').select('metrics');
    if (error || !data) return 0;
    return data.reduce((sum: number, row: any) => sum + (row.metrics?.totalTokenUsage || 0), 0);
  }

  async getTotalCost(): Promise<number> {
    const { data, error } = await getSupabaseAdmin().from('providers').select('costs');
    if (error || !data) return 0;
    return data.reduce((sum: number, row: any) => sum + (row.costs?.totalCost || 0), 0);
  }

  async getAverageLatency(): Promise<number> {
    const { data, error } = await getSupabaseAdmin().from('providers').select('metrics');
    if (error || !data || data.length === 0) return 0;
    const total = data.reduce((sum: number, row: any) => sum + (row.metrics?.avgLatency || 0), 0);
    return total / data.length;
  }

  async countByStatus(): Promise<Record<string, number>> {
    const { data, error } = await getSupabaseAdmin().from('providers').select('metrics');
    if (error || !data) return {};
    const counts: Record<string, number> = {};
    for (const row of data) {
      const status = row.metrics?.healthStatus || 'unknown';
      counts[status] = (counts[status] || 0) + 1;
    }
    return counts;
  }
}
