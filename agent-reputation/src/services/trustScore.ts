import store from '../db/store';
import { v4 as uuid } from 'uuid';
import { TrustScore, TrustScoreBreakdown } from '../types';

// Trust score weights (sum to 1.0)
const WEIGHTS = {
  reliability: 0.30,
  performance: 0.20,
  security: 0.20,
  satisfaction: 0.20,
  network: 0.10
};

const DECAY_RATE_PER_DAY = 0.001;
const MAX_DECAY = 0.5;

export class TrustScoreService {
  
  calculateTrustScore(agentId: string): TrustScore {
    const reliability = this.calculateReliabilityScore(agentId);
    const performance = this.calculatePerformanceScore(agentId);
    const security = this.calculateSecurityScore(agentId);
    const satisfaction = this.calculateSatisfactionScore(agentId);
    const network = this.calculateNetworkScore(agentId);
    
    const overallScore = (
      reliability.score * WEIGHTS.reliability +
      performance.score * WEIGHTS.performance +
      security.score * WEIGHTS.security +
      satisfaction.score * WEIGHTS.satisfaction +
      network.score * WEIGHTS.network
    );
    
    const lastActivity = this.getLastActivityTime(agentId);
    const decayFactor = this.calculateDecay(lastActivity);
    const decayedScore = overallScore * decayFactor;
    
    const breakdown: TrustScoreBreakdown = {
      reliability: { ...reliability.factors, weight: WEIGHTS.reliability },
      performance: { ...performance.factors, weight: WEIGHTS.performance },
      security: { ...security.factors, weight: WEIGHTS.security },
      satisfaction: { ...satisfaction.factors, weight: WEIGHTS.satisfaction },
      network: { ...network.factors, weight: WEIGHTS.network }
    };
    
    const trustScore: TrustScore = {
      id: uuid(),
      agentId,
      overallScore: Math.round(decayedScore * 100) / 100,
      reliabilityScore: reliability.score,
      performanceScore: performance.score,
      securityScore: security.score,
      satisfactionScore: satisfaction.score,
      networkScore: network.score,
      scoreBreakdown: breakdown,
      lastCalculated: Math.floor(Date.now() / 1000),
      decayFactor
    };
    
    store.setTrustScore(trustScore.id, trustScore);
    return trustScore;
  }
  
  private calculateReliabilityScore(agentId: string): { score: number; factors: any } {
    const metrics = store.getLatestMetrics(agentId);
    
    if (!metrics) {
      return { 
        score: 50,
        factors: { uptime: 50, errorRate: 50, taskCompletion: 50 }
      };
    }
    
    const uptimeScore = (metrics.uptimePercentage || 95);
    const errorRate = metrics.errorRate || 0.05;
    const errorRateScore = Math.max(0, 100 - (errorRate * 1000));
    
    const totalTasks = (metrics.totalTasksCompleted || 0) + (metrics.totalTasksFailed || 0);
    const completionRate = totalTasks > 0 
      ? (metrics.totalTasksCompleted / totalTasks) * 100 
      : 50;
    
    const score = (uptimeScore * 0.4 + errorRateScore * 0.3 + completionRate * 0.3);
    
    return {
      score: Math.min(100, Math.max(0, score)),
      factors: { uptime: uptimeScore, errorRate: errorRateScore, taskCompletion: completionRate }
    };
  }
  
  private calculatePerformanceScore(agentId: string): { score: number; factors: any } {
    const skills = store.getSkillsByAgent(agentId);
    const verifiedSkills = skills.filter(s => s.verified && s.benchmarkPercentile);
    
    const benchmarkScore = verifiedSkills.length > 0
      ? verifiedSkills.reduce((sum, s) => sum + s.benchmarkPercentile, 0) / verifiedSkills.length
      : 50;
    
    const metrics = store.getLatestMetrics(agentId);
    let latencyScore = 50;
    if (metrics?.p50LatencyMs) {
      latencyScore = Math.max(0, 100 - (metrics.p50LatencyMs / 10));
    }
    
    const score = benchmarkScore * 0.7 + latencyScore * 0.3;
    
    return {
      score: Math.min(100, Math.max(0, score)),
      factors: { benchmarkAvg: benchmarkScore, latency: latencyScore }
    };
  }
  
  private calculateSecurityScore(agentId: string): { score: number; factors: any } {
    const audits = store.getAuditsByAgent(agentId);
    const latestAudit = audits.find(a => a.verified);
    
    let auditScore = 30;
    if (latestAudit) {
      if (latestAudit.passed && latestAudit.criticalIssues === 0 && latestAudit.highIssues === 0) {
        auditScore = 100;
      } else if (latestAudit.passed) {
        auditScore = 80 - (latestAudit.highIssues * 10);
      } else {
        auditScore = 40 - (latestAudit.criticalIssues * 20) - (latestAudit.highIssues * 10);
      }
    }
    
    const incidents = store.getIncidentsByAgent(agentId, 90);
    let incidentPenalty = 0;
    for (const inc of incidents) {
      switch (inc.severity) {
        case 'critical': incidentPenalty += 30; break;
        case 'high': incidentPenalty += 15; break;
        case 'medium': incidentPenalty += 5; break;
        case 'low': incidentPenalty += 1; break;
      }
    }
    const incidentScore = Math.max(0, 100 - incidentPenalty);
    
    const score = auditScore * 0.6 + incidentScore * 0.4;
    
    return {
      score: Math.min(100, Math.max(0, score)),
      factors: { auditStatus: auditScore, incidentHistory: incidentScore }
    };
  }
  
  private calculateSatisfactionScore(agentId: string): { score: number; factors: any } {
    const stats = store.getReviewStats(agentId);
    
    if (!stats || stats.reviewCount === 0) {
      return {
        score: 50,
        factors: { avgRating: 50, reviewCount: 0, recommendRate: 50 }
      };
    }
    
    const ratingScore = ((stats.avgRating - 1) / 4) * 100;
    const countBonus = Math.min(20, stats.reviewCount * 2);
    const recommendRate = (stats.recommendCount / stats.reviewCount) * 100;
    
    const score = ratingScore * 0.5 + recommendRate * 0.3 + countBonus;
    
    return {
      score: Math.min(100, Math.max(0, score)),
      factors: { avgRating: ratingScore, reviewCount: stats.reviewCount, recommendRate }
    };
  }
  
  private calculateNetworkScore(agentId: string): { score: number; factors: any } {
    const endorsements = store.getEndorsementsByAgent(agentId);
    const pairs = store.getAgentPairs(agentId);
    
    const endorsementCount = endorsements.length;
    const totalCollabs = endorsements.reduce((sum, e) => sum + (e.collaborationCount || 0), 0);
    const coDeployments = pairs.reduce((sum, p) => sum + (p.coDeploymentCount || 0), 0);
    
    const endorsementScore = Math.min(100, Math.log2(endorsementCount + 1) * 17);
    const collabScore = Math.min(100, Math.log2(totalCollabs + coDeployments + 1) * 15);
    
    const score = endorsementScore * 0.6 + collabScore * 0.4;
    
    return {
      score: Math.min(100, Math.max(0, score)),
      factors: { endorsementCount, collaborationScore: collabScore }
    };
  }
  
  private getLastActivityTime(agentId: string): number {
    const metrics = store.getLatestMetrics(agentId);
    const reviews = store.getReviewsByAgent(agentId, 1);
    
    return Math.max(
      metrics?.periodEnd || 0,
      reviews[0]?.createdAt || 0,
      Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60)
    );
  }
  
  private calculateDecay(lastActivityTimestamp: number): number {
    const now = Math.floor(Date.now() / 1000);
    const daysSinceActive = (now - lastActivityTimestamp) / (24 * 60 * 60);
    
    if (daysSinceActive <= 7) return 1.0;
    
    const decay = 1 - (DECAY_RATE_PER_DAY * (daysSinceActive - 7));
    return Math.max(MAX_DECAY, decay);
  }
  
  getTrustScore(agentId: string, maxAge: number = 3600): TrustScore | null {
    const cached = store.getTrustScore(agentId);
    
    if (!cached) {
      return this.calculateTrustScore(agentId);
    }
    
    const age = Math.floor(Date.now() / 1000) - cached.lastCalculated;
    if (age > maxAge) {
      return this.calculateTrustScore(agentId);
    }
    
    return cached;
  }
}

export const trustScoreService = new TrustScoreService();
