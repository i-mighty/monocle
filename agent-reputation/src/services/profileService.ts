import store from '../db/store';
import { v4 as uuid } from 'uuid';
import { 
  Agent, Builder, AgentProfile, 
  CreateAgentRequest, AgentSearchFilters, AgentSearchResult 
} from '../types';
import { trustScoreService } from './trustScore';

export class ProfileService {
  
  createAgent(data: CreateAgentRequest): Agent {
    const id = uuid();
    const now = Math.floor(Date.now() / 1000);
    
    const agent: Agent = {
      id,
      name: data.name,
      slug: data.slug,
      builderId: data.builderId,
      description: data.description,
      version: data.version || '1.0.0',
      sourceUrl: data.sourceUrl,
      mcpEndpoint: data.mcpEndpoint,
      a2aCardUrl: data.a2aCardUrl,
      logoUrl: data.logoUrl,
      createdAt: now,
      updatedAt: now,
      isVerified: false,
      verificationTier: 'none',
      status: 'active'
    };
    
    store.setAgent(id, agent);
    return agent;
  }
  
  getAgent(id: string): Agent | null {
    return store.getAgent(id) || null;
  }
  
  getAgentBySlug(slug: string): Agent | null {
    return store.getAgentBySlug(slug) || null;
  }
  
  getFullProfile(agentId: string): AgentProfile | null {
    const agent = this.getAgent(agentId);
    if (!agent) return null;
    
    const builder = this.getBuilder(agent.builderId);
    if (!builder) return null;
    
    return {
      agent,
      builder,
      skills: store.getSkillsByAgent(agentId),
      metrics: store.getLatestMetrics(agentId),
      trustScore: trustScoreService.getTrustScore(agentId),
      portfolio: store.getPortfolioByAgent(agentId),
      reviews: store.getReviewsByAgent(agentId, 10),
      endorsements: store.getEndorsementsByAgent(agentId),
      integrations: store.getIntegrationsByAgent(agentId),
      badges: store.getBadgesByAgent(agentId),
      incidents: store.getIncidentsByAgent(agentId),
      frequentlyDeployedWith: this.getFrequentlyDeployedWith(agentId)
    };
  }
  
  searchAgents(filters: AgentSearchFilters): AgentSearchResult {
    let agents = store.getAllAgents().filter(a => a.status === 'active');
    
    if (filters.query) {
      const q = filters.query.toLowerCase();
      agents = agents.filter(a => 
        a.name.toLowerCase().includes(q) || 
        (a.description && a.description.toLowerCase().includes(q))
      );
    }
    
    if (filters.verificationTier) {
      agents = agents.filter(a => a.verificationTier === filters.verificationTier);
    }
    
    if (filters.builderId) {
      agents = agents.filter(a => a.builderId === filters.builderId);
    }
    
    if (filters.skills && filters.skills.length > 0) {
      agents = agents.filter(a => {
        const agentSkills = store.getSkillsByAgent(a.id).map(s => s.skillName);
        return filters.skills!.some(skill => agentSkills.includes(skill));
      });
    }
    
    // Add trust scores
    const agentsWithScores = agents.map(agent => {
      const ts = store.getTrustScore(agent.id);
      const reviews = store.getReviewsByAgent(agent.id);
      return {
        ...agent,
        trustScore: ts?.overallScore,
        reviewCount: reviews.length
      };
    });
    
    if (filters.minTrustScore) {
      agentsWithScores.filter(a => (a.trustScore || 0) >= filters.minTrustScore!);
    }
    
    // Sort
    const sortBy = filters.sortBy || 'trust_score';
    const sortOrder = filters.sortOrder === 'asc' ? 1 : -1;
    
    agentsWithScores.sort((a, b) => {
      let aVal: number, bVal: number;
      switch (sortBy) {
        case 'trust_score': aVal = a.trustScore || 0; bVal = b.trustScore || 0; break;
        case 'reviews': aVal = a.reviewCount || 0; bVal = b.reviewCount || 0; break;
        case 'created_at': aVal = a.createdAt; bVal = b.createdAt; break;
        default: aVal = a.trustScore || 0; bVal = b.trustScore || 0;
      }
      return (bVal - aVal) * sortOrder;
    });
    
    const total = agentsWithScores.length;
    const limit = filters.limit || 20;
    const offset = filters.offset || 0;
    
    return {
      agents: agentsWithScores.slice(offset, offset + limit),
      total,
      page: Math.floor(offset / limit) + 1,
      pageSize: limit
    };
  }
  
  getOrCreateBuilder(name: string, slug: string): Builder {
    let builder = store.getBuilderBySlug(slug);
    
    if (!builder) {
      const id = uuid();
      builder = {
        id,
        name,
        slug,
        verified: false,
        createdAt: Math.floor(Date.now() / 1000)
      };
      store.setBuilder(id, builder);
    }
    
    return builder;
  }
  
  getBuilder(id: string): Builder | null {
    return store.getBuilder(id) || null;
  }
  
  addSkill(agentId: string, skillName: string, benchmark?: { name: string; score: number; percentile?: number }) {
    const id = uuid();
    const skill = {
      id,
      agentId,
      skillName,
      benchmarkName: benchmark?.name,
      benchmarkScore: benchmark?.score,
      benchmarkPercentile: benchmark?.percentile,
      benchmarkDate: benchmark ? Math.floor(Date.now() / 1000) : null,
      verified: false,
      selfReported: true
    };
    store.setSkill(id, skill);
    return skill;
  }
  
  addReview(data: any) {
    const id = uuid();
    const review = {
      id,
      agentId: data.agentId,
      reviewerId: data.reviewerId,
      reviewerName: data.reviewerName,
      reviewerCompany: data.reviewerCompany,
      rating: data.rating,
      title: data.title,
      content: data.content,
      useCase: data.useCase,
      deploymentDurationDays: data.deploymentDurationDays,
      wouldRecommend: data.wouldRecommend ?? true,
      pros: data.pros,
      cons: data.cons,
      verifiedDeployment: false,
      createdAt: Math.floor(Date.now() / 1000),
      helpfulCount: 0
    };
    store.setReview(id, review);
    return review;
  }
  
  getFrequentlyDeployedWith(agentId: string, limit = 5): Agent[] {
    const pairs = store.getAgentPairs(agentId);
    const partnerIds = pairs
      .map(p => p.agentAId === agentId ? p.agentBId : p.agentAId)
      .slice(0, limit);
    
    return partnerIds.map(id => store.getAgent(id)).filter(Boolean);
  }
}

export const profileService = new ProfileService();
