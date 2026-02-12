import { Router, Request, Response } from 'express';
import { profileService } from '../services/profileService';
import { trustScoreService } from '../services/trustScore';
import { z } from 'zod';

const router = Router();

const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
  builderName: z.string().min(1),
  builderSlug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  version: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  mcpEndpoint: z.string().url().optional(),
  a2aCardUrl: z.string().url().optional(),
  logoUrl: z.string().url().optional()
});

const searchSchema = z.object({
  query: z.string().optional(),
  skills: z.string().optional(),
  minTrustScore: z.coerce.number().min(0).max(100).optional(),
  verificationTier: z.enum(['none', 'basic', 'standard', 'enterprise']).optional(),
  builderId: z.string().optional(),
  sortBy: z.enum(['trust_score', 'reviews', 'deployments', 'created_at']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional()
});

// GET /agents - Search
router.get('/', (req: Request, res: Response) => {
  try {
    const filters = searchSchema.parse(req.query);
    const result = profileService.searchAgents({
      ...filters,
      skills: filters.skills?.split(',').map(s => s.trim())
    });
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// POST /agents - Create
router.post('/', (req: Request, res: Response) => {
  try {
    const data = createAgentSchema.parse(req.body);
    const builder = profileService.getOrCreateBuilder(data.builderName, data.builderSlug);
    
    const agent = profileService.createAgent({
      name: data.name,
      slug: data.slug,
      builderId: builder.id,
      description: data.description,
      version: data.version,
      sourceUrl: data.sourceUrl,
      mcpEndpoint: data.mcpEndpoint,
      a2aCardUrl: data.a2aCardUrl,
      logoUrl: data.logoUrl
    });
    
    res.status(201).json(agent);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// GET /agents/:idOrSlug
router.get('/:idOrSlug', (req: Request, res: Response) => {
  const { idOrSlug } = req.params;
  const full = req.query.full === 'true';
  
  let agent = profileService.getAgentBySlug(idOrSlug);
  if (!agent) agent = profileService.getAgent(idOrSlug);
  
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  if (full) {
    const profile = profileService.getFullProfile(agent.id);
    return res.json(profile);
  }
  
  res.json(agent);
});

// GET /agents/:id/trust-score
router.get('/:id/trust-score', (req: Request, res: Response) => {
  const { id } = req.params;
  const recalculate = req.query.recalculate === 'true';
  
  const agent = profileService.getAgent(id) || profileService.getAgentBySlug(id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const trustScore = recalculate 
    ? trustScoreService.calculateTrustScore(agent.id)
    : trustScoreService.getTrustScore(agent.id);
    
  res.json(trustScore);
});

// POST /agents/:id/skills
router.post('/:id/skills', (req: Request, res: Response) => {
  const { id } = req.params;
  const { skillName, benchmark } = req.body;
  
  const agent = profileService.getAgent(id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const skill = profileService.addSkill(id, skillName, benchmark);
  res.status(201).json(skill);
});

export default router;
