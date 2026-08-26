import { injectable, inject } from 'inversify';
import { User } from '../../domain/entities';
import type { UserRepository } from '../../domain/repositories';
import type { ILogger } from '../../core/logging';
import { TYPES } from '../../core/container';
import { getSupabaseAdmin } from '../supabase/client';

interface UserRow {
  id: string;
  name: string;
  api_key_hashes: string[];
  plan: string;
  plan_expires_at: number;
  enabled: boolean;
  credits: number;
  credits_last_reset: number;
  permissions: string[];
  ip_whitelist: string[];
  rate_limit: number;
  max_concurrent_requests: number;
  usage: {
    totalRequests: number;
    totalTokensUsed: number;
    totalCreditsUsed: number;
    lastRequestAt?: number;
    requestHistory: Array<{
      timestamp: number;
      endpoint: string;
      tokensUsed: number;
      creditsUsed: number;
    }>;
  };
  created_at: string;
  updated_at: string;
}

@injectable()
export class SupabaseUserRepository implements UserRepository {
  private readonly logger: ILogger;

  constructor(@inject(TYPES.Logger) logger: ILogger) {
    this.logger = logger.createChild('SupabaseUserRepository');
  }

  private rowToEntity(row: UserRow): User {
    return new User(
      { id: row.id, name: row.name, createdAt: new Date(row.created_at).getTime(), updatedAt: new Date(row.updated_at).getTime() },
      { apiKeyHashes: row.api_key_hashes || [] },
      {
        plan: row.plan,
        planExpiresAt: row.plan_expires_at,
        enabled: row.enabled,
        credits: Number(row.credits),
        creditsLastReset: row.credits_last_reset,
        permissions: row.permissions || [],
        ipWhitelist: row.ip_whitelist || [],
        rateLimit: row.rate_limit,
        maxConcurrentRequests: row.max_concurrent_requests
      },
      {
        totalRequests: row.usage?.totalRequests || 0,
        totalTokensUsed: row.usage?.totalTokensUsed || 0,
        totalCreditsUsed: row.usage?.totalCreditsUsed || 0,
        lastRequestAt: row.usage?.lastRequestAt,
        requestHistory: row.usage?.requestHistory || []
      }
    );
  }

  private entityToRow(user: User): Record<string, any> {
    const stats = user.getUsageStats();
    return {
      id: user.getId(),
      name: user.getName(),
      api_key_hashes: user.getApiKeyHashes(),
      plan: user.getPlan(),
      plan_expires_at: user.getPlanExpiresAt(),
      enabled: user.isEnabled(),
      credits: user.getCredits(),
      credits_last_reset: user.getCreditsLastReset(),
      permissions: user.getPermissions(),
      ip_whitelist: user.getIpWhitelist(),
      rate_limit: user.getRateLimit(),
      max_concurrent_requests: user.getMaxConcurrentRequests(),
      usage: {
        totalRequests: stats.totalRequests,
        totalTokensUsed: stats.totalTokensUsed,
        totalCreditsUsed: stats.totalCreditsUsed,
        lastRequestAt: stats.lastRequestAt,
        requestHistory: user.getRequestHistory()
      },
      updated_at: new Date().toISOString()
    };
  }

  async findById(id: string): Promise<User | null> {
    try {
      const { data, error } = await getSupabaseAdmin().from('users').select('*').eq('id', id).single();
      if (error || !data) return null;
      return this.rowToEntity(data as UserRow);
    } catch (error) {
      this.logger.error('Failed to find user by ID', error as Error, { metadata: { userId: id } });
      throw error;
    }
  }

  async findByApiKeyHash(keyHash: string): Promise<User | null> {
    try {
      const { data, error } = await getSupabaseAdmin()
        .from('users').select('*').contains('api_key_hashes', [keyHash]).limit(1).single();
      if (error || !data) return null;
      return this.rowToEntity(data as UserRow);
    } catch (error) {
      this.logger.error('Failed to find user by API key hash', error as Error);
      throw error;
    }
  }

  async findByName(name: string): Promise<User | null> {
    try {
      const { data, error } = await getSupabaseAdmin().from('users').select('*').eq('name', name).single();
      if (error || !data) return null;
      return this.rowToEntity(data as UserRow);
    } catch (error) {
      this.logger.error('Failed to find user by name', error as Error, { metadata: { name } });
      throw error;
    }
  }

  async findAll(): Promise<User[]> {
    try {
      const { data, error } = await getSupabaseAdmin().from('users').select('*');
      if (error || !data) return [];
      return (data as UserRow[]).map(row => this.rowToEntity(row));
    } catch (error) {
      this.logger.error('Failed to find all users', error as Error);
      throw error;
    }
  }

  async save(user: User): Promise<User> {
    try {
      const row = this.entityToRow(user);
      row.created_at = new Date(user.getCreatedAt()).toISOString();
      const { error } = await getSupabaseAdmin().from('users').upsert(row, { onConflict: 'id' });
      if (error) throw error;
      return user;
    } catch (error) {
      this.logger.error('Failed to save user', error as Error, { metadata: { userId: user.getId() } });
      throw error;
    }
  }

  async update(id: string, updates: Partial<User>): Promise<User> {
    try {
      const existing = await this.findById(id);
      if (!existing) throw new Error(`User ${id} not found`);

      const row = this.entityToRow(existing);
      const { updated_at, ...rest } = row;
      const updateRow: Record<string, any> = { ...rest, updated_at: new Date().toISOString() };

      // Apply partial updates to the row
      for (const [key, val] of Object.entries(updates)) {
        if (val !== undefined) {
          if (key === 'plan') updateRow.plan = val;
          if (key === 'enabled') updateRow.enabled = val;
          if (key === 'credits') updateRow.credits = val;
          if (key === 'creditsLastReset') updateRow.credits_last_reset = val;
          if (key === 'permissions') updateRow.permissions = val;
          if (key === 'ipWhitelist') updateRow.ip_whitelist = val;
          if (key === 'rateLimit') updateRow.rate_limit = val;
          if (key === 'maxConcurrentRequests') updateRow.max_concurrent_requests = val;
          if (key === 'apiKeyHashes') updateRow.api_key_hashes = val;
        }
      }

      const { error } = await getSupabaseAdmin().from('users').update(updateRow).eq('id', id);
      if (error) throw error;

      const updated = await this.findById(id);
      if (!updated) throw new Error(`User ${id} not found after update`);
      return updated;
    } catch (error) {
      this.logger.error('Failed to update user', error as Error, { metadata: { userId: id } });
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      const { error } = await getSupabaseAdmin().from('users').delete().eq('id', id);
      if (error) throw error;
    } catch (error) {
      this.logger.error('Failed to delete user', error as Error, { metadata: { userId: id } });
      throw error;
    }
  }

  async exists(id: string): Promise<boolean> {
    try {
      const { count, error } = await getSupabaseAdmin().from('users').select('id', { count: 'exact', head: true }).eq('id', id);
      if (error) throw error;
      return (count ?? 0) > 0;
    } catch (error) {
      this.logger.error('Failed to check if user exists', error as Error, { metadata: { userId: id } });
      throw error;
    }
  }

  async findByPlan(plan: string): Promise<User[]> {
    try {
      const { data, error } = await getSupabaseAdmin().from('users').select('*').eq('plan', plan);
      if (error || !data) return [];
      return (data as UserRow[]).map(row => this.rowToEntity(row));
    } catch (error) {
      this.logger.error('Failed to find users by plan', error as Error, { metadata: { plan } });
      throw error;
    }
  }

  async findActiveUsers(): Promise<User[]> {
    try {
      const { data, error } = await getSupabaseAdmin().from('users').select('*').eq('enabled', true);
      if (error || !data) return [];
      return (data as UserRow[]).map(row => this.rowToEntity(row));
    } catch (error) {
      this.logger.error('Failed to find active users', error as Error);
      throw error;
    }
  }

  async findUsersWithLowCredits(threshold: number): Promise<User[]> {
    try {
      const { data, error } = await getSupabaseAdmin().from('users').select('*').lt('credits', threshold);
      if (error || !data) return [];
      return (data as UserRow[]).map(row => this.rowToEntity(row));
    } catch (error) {
      this.logger.error('Failed to find users with low credits', error as Error, { metadata: { threshold } });
      throw error;
    }
  }

  async updateCredits(id: string, credits: number): Promise<void> {
    try {
      const { error } = await getSupabaseAdmin()
        .from('users').update({ credits, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
    } catch (error) {
      this.logger.error('Failed to update user credits', error as Error, { metadata: { userId: id, credits } });
      throw error;
    }
  }

  async incrementCredits(id: string, amount: number): Promise<void> {
    try {
      const user = await this.findById(id);
      if (user) {
        const newCredits = user.getCredits() + amount;
        await this.updateCredits(id, newCredits);
      }
    } catch (error) {
      this.logger.error('Failed to increment user credits', error as Error, { metadata: { userId: id, amount } });
      throw error;
    }
  }

  async decrementCredits(id: string, amount: number): Promise<boolean> {
    try {
      const user = await this.findById(id);
      if (!user || user.getCredits() < amount) return false;
      const newCredits = user.getCredits() - amount;
      await this.updateCredits(id, newCredits);
      return true;
    } catch (error) {
      this.logger.error('Failed to decrement user credits', error as Error, { metadata: { userId: id, amount } });
      throw error;
    }
  }

  async resetCredits(id: string, newCredits: number): Promise<void> {
    try {
      const { error } = await getSupabaseAdmin().from('users').update({
        credits: newCredits,
        credits_last_reset: Date.now(),
        updated_at: new Date().toISOString()
      }).eq('id', id);
      if (error) throw error;
    } catch (error) {
      this.logger.error('Failed to reset user credits', error as Error, { metadata: { userId: id, newCredits } });
      throw error;
    }
  }

  async findUsersNeedingCreditReset(): Promise<User[]> {
    try {
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
      const { data, error } = await getSupabaseAdmin()
        .from('users').select('*').lt('credits_last_reset', oneDayAgo).eq('enabled', true);
      if (error || !data) return [];
      return (data as UserRow[]).map(row => this.rowToEntity(row));
    } catch (error) {
      this.logger.error('Failed to find users needing credit reset', error as Error);
      throw error;
    }
  }

  async countByPlan(): Promise<Record<string, number>> {
    try {
      const { data, error } = await getSupabaseAdmin().from('users').select('plan');
      if (error || !data) return {};
      const counts: Record<string, number> = {};
      for (const row of data) {
        counts[row.plan] = (counts[row.plan] || 0) + 1;
      }
      return counts;
    } catch (error) {
      this.logger.error('Failed to count users by plan', error as Error);
      throw error;
    }
  }

  async getTotalCreditsUsed(): Promise<number> {
    try {
      const { data, error } = await getSupabaseAdmin().from('users').select('usage');
      if (error || !data) return 0;
      return data.reduce((sum: number, row: any) => sum + (row.usage?.totalCreditsUsed || 0), 0);
    } catch (error) {
      this.logger.error('Failed to get total credits used', error as Error);
      throw error;
    }
  }

  async getActiveUserCount(): Promise<number> {
    try {
      const { count, error } = await getSupabaseAdmin()
        .from('users').select('id', { count: 'exact', head: true }).eq('enabled', true);
      if (error) throw error;
      return count ?? 0;
    } catch (error) {
      this.logger.error('Failed to get active user count', error as Error);
      throw error;
    }
  }
}
