// In-memory database store for agent reputation
// Uses JSON file for persistence

import fs from 'fs';
import path from 'path';

const DB_PATH = process.env.REPUTATION_DB_PATH || './data.json';

interface Database {
  agents: Map<string, any>;
  builders: Map<string, any>;
  skills: Map<string, any>;
  metrics: Map<string, any>;
  reviews: Map<string, any>;
  endorsements: Map<string, any>;
  incidents: Map<string, any>;
  trustScores: Map<string, any>;
  integrations: Map<string, any>;
  badges: Map<string, any>;
  agentPairs: Map<string, any>;
  portfolioItems: Map<string, any>;
  securityAudits: Map<string, any>;
}

class Store {
  private data: Database;
  
  constructor() {
    this.data = {
      agents: new Map(),
      builders: new Map(),
      skills: new Map(),
      metrics: new Map(),
      reviews: new Map(),
      endorsements: new Map(),
      incidents: new Map(),
      trustScores: new Map(),
      integrations: new Map(),
      badges: new Map(),
      agentPairs: new Map(),
      portfolioItems: new Map(),
      securityAudits: new Map()
    };
    this.load();
  }
  
  private load() {
    try {
      if (fs.existsSync(DB_PATH)) {
        const raw = fs.readFileSync(DB_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        for (const [key, value] of Object.entries(parsed)) {
          if (this.data[key as keyof Database]) {
            this.data[key as keyof Database] = new Map(Object.entries(value as object));
          }
        }
      }
    } catch (e) {
      console.log('Starting with empty database');
    }
  }
  
  save() {
    const serialized: any = {};
    for (const [key, value] of Object.entries(this.data)) {
      serialized[key] = Object.fromEntries(value);
    }
    fs.writeFileSync(DB_PATH, JSON.stringify(serialized, null, 2));
  }
  
  // Agents
  getAgent(id: string) { return this.data.agents.get(id); }
  getAgentBySlug(slug: string) { 
    return Array.from(this.data.agents.values()).find(a => a.slug === slug); 
  }
  setAgent(id: string, agent: any) { 
    this.data.agents.set(id, agent); 
    this.save();
  }
  getAllAgents() { return Array.from(this.data.agents.values()); }
  
  // Builders
  getBuilder(id: string) { return this.data.builders.get(id); }
  getBuilderBySlug(slug: string) { 
    return Array.from(this.data.builders.values()).find(b => b.slug === slug); 
  }
  setBuilder(id: string, builder: any) { 
    this.data.builders.set(id, builder); 
    this.save();
  }
  
  // Skills
  getSkillsByAgent(agentId: string) { 
    return Array.from(this.data.skills.values()).filter(s => s.agentId === agentId); 
  }
  setSkill(id: string, skill: any) { 
    this.data.skills.set(id, skill); 
    this.save();
  }
  
  // Metrics
  getLatestMetrics(agentId: string) { 
    const all = Array.from(this.data.metrics.values()).filter(m => m.agentId === agentId);
    return all.sort((a, b) => b.periodEnd - a.periodEnd)[0] || null;
  }
  setMetrics(id: string, metrics: any) { 
    this.data.metrics.set(id, metrics); 
    this.save();
  }
  
  // Reviews
  getReviewsByAgent(agentId: string, limit = 10) { 
    return Array.from(this.data.reviews.values())
      .filter(r => r.agentId === agentId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }
  setReview(id: string, review: any) { 
    this.data.reviews.set(id, review); 
    this.save();
  }
  getReviewStats(agentId: string) {
    const reviews = Array.from(this.data.reviews.values()).filter(r => r.agentId === agentId);
    if (reviews.length === 0) return null;
    const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
    const recommendCount = reviews.filter(r => r.wouldRecommend).length;
    return { avgRating, reviewCount: reviews.length, recommendCount };
  }
  
  // Trust Scores
  getTrustScore(agentId: string) { 
    return Array.from(this.data.trustScores.values()).find(t => t.agentId === agentId); 
  }
  setTrustScore(id: string, score: any) { 
    // Remove old score for this agent
    for (const [key, val] of this.data.trustScores.entries()) {
      if (val.agentId === score.agentId) {
        this.data.trustScores.delete(key);
      }
    }
    this.data.trustScores.set(id, score); 
    this.save();
  }
  
  // Endorsements
  getEndorsementsByAgent(agentId: string) { 
    return Array.from(this.data.endorsements.values()).filter(e => e.endorsedAgentId === agentId); 
  }
  setEndorsement(id: string, endorsement: any) { 
    this.data.endorsements.set(id, endorsement); 
    this.save();
  }
  
  // Incidents
  getIncidentsByAgent(agentId: string, days = 90) { 
    const cutoff = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);
    return Array.from(this.data.incidents.values())
      .filter(i => i.agentId === agentId && i.occurredAt > cutoff);
  }
  setIncident(id: string, incident: any) { 
    this.data.incidents.set(id, incident); 
    this.save();
  }
  
  // Integrations
  getIntegrationsByAgent(agentId: string) { 
    return Array.from(this.data.integrations.values()).filter(i => i.agentId === agentId); 
  }
  setIntegration(id: string, integration: any) { 
    this.data.integrations.set(id, integration); 
    this.save();
  }
  
  // Badges  
  getBadgesByAgent(agentId: string) { 
    return Array.from(this.data.badges.values()).filter(b => b.agentId === agentId); 
  }
  setBadge(id: string, badge: any) { 
    this.data.badges.set(id, badge); 
    this.save();
  }
  
  // Agent Pairs
  getAgentPairs(agentId: string) { 
    return Array.from(this.data.agentPairs.values())
      .filter(p => p.agentAId === agentId || p.agentBId === agentId);
  }
  setAgentPair(id: string, pair: any) { 
    this.data.agentPairs.set(id, pair); 
    this.save();
  }
  
  // Portfolio
  getPortfolioByAgent(agentId: string) { 
    return Array.from(this.data.portfolioItems.values()).filter(p => p.agentId === agentId); 
  }
  setPortfolioItem(id: string, item: any) { 
    this.data.portfolioItems.set(id, item); 
    this.save();
  }
  
  // Security Audits
  getAuditsByAgent(agentId: string) { 
    return Array.from(this.data.securityAudits.values())
      .filter(a => a.agentId === agentId)
      .sort((a, b) => b.auditDate - a.auditDate);
  }
  setAudit(id: string, audit: any) { 
    this.data.securityAudits.set(id, audit); 
    this.save();
  }
}

export const store = new Store();
export default store;
