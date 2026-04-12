interface RequestStat {
  model: string;
  tier: string;
  timestamp: number;
  latencyMs: number;
  success: boolean;
  cost?: string;
}

class StatsTracker {
  private history: RequestStat[] = [];

  record(stat: RequestStat): void {
    this.history.push(stat);
    // Keep last 10000 entries
    if (this.history.length > 10000) {
      this.history = this.history.slice(-10000);
    }
  }

  getSummary(): {
    totalRequests: number;
    freeRequests: number;
    paidRequests: number;
    successRate: number;
    avgLatencyMs: number;
    modelBreakdown: Record<string, number>;
  } {
    const total = this.history.length;
    if (total === 0) {
      return {
        totalRequests: 0,
        freeRequests: 0,
        paidRequests: 0,
        successRate: 0,
        avgLatencyMs: 0,
        modelBreakdown: {},
      };
    }

    const free = this.history.filter((s) => s.tier === "FREE").length;
    const paid = total - free;
    const successes = this.history.filter((s) => s.success).length;
    const avgLatency =
      this.history.reduce((sum, s) => sum + s.latencyMs, 0) / total;

    const breakdown: Record<string, number> = {};
    for (const s of this.history) {
      breakdown[s.model] = (breakdown[s.model] || 0) + 1;
    }

    return {
      totalRequests: total,
      freeRequests: free,
      paidRequests: paid,
      successRate: Math.round((successes / total) * 100),
      avgLatencyMs: Math.round(avgLatency),
      modelBreakdown: breakdown,
    };
  }

  clear(): void {
    this.history = [];
  }
}

export const stats = new StatsTracker();
