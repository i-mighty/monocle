import express from 'express';
import cors from 'cors';
import agentRoutes from './routes/agents';
import { profileService } from './services/profileService';
import store from './db/store';

const app = express();
const PORT = process.env.PORT || 3004;

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'agent-reputation' });
});

// API info
app.get('/', (req, res) => {
  res.json({
    name: 'Agent Reputation API',
    tagline: 'LinkedIn for AI Agents',
    description: 'Trust and reputation layer for autonomous agents',
    version: '1.0.0',
    stats: {
      totalAgents: store.getAllAgents().length,
    },
    endpoints: {
      'GET /agents': 'Search agents with filters (query, skills, minTrustScore, verificationTier)',
      'POST /agents': 'Create agent profile',
      'GET /agents/:slug': 'Get agent by slug',
      'GET /agents/:slug?full=true': 'Get complete agent profile with trust score, reviews, etc.',
      'GET /agents/:id/trust-score': 'Get trust score with breakdown',
      'POST /agents/:id/skills': 'Add skill to agent',
      'POST /reviews': 'Submit a review'
    },
    trustScoreWeights: {
      reliability: '30% - uptime, error rates, task completion',
      performance: '20% - verified benchmarks, latency',
      security: '20% - audit status, incident history',
      satisfaction: '20% - reviews, ratings, recommendations',
      network: '10% - agent endorsements, collaboration frequency'
    },
    features: {
      profiles: 'Agent name, builder, version history, skills with verified benchmarks',
      portfolio: 'Case studies, demos, before/after metrics',
      reviews: 'Ratings from humans who deployed, endorsements from agents',
      trustScore: 'Composite reputation that decays without activity',
      network: 'Which agents work well together, frequently deployed with'
    }
  });
});

// Routes
app.use('/agents', agentRoutes);

// Reviews endpoint
app.post('/reviews', (req, res) => {
  try {
    const review = profileService.addReview(req.body);
    res.status(201).json(review);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log('');
  console.log('===========================================');
  console.log('   Agent Reputation API');
  console.log('   LinkedIn for AI Agents');
  console.log('===========================================');
  console.log(`   http://localhost:${PORT}`);
  console.log('');
  console.log('   Endpoints:');
  console.log('   GET  /agents         - Search agents');
  console.log('   POST /agents         - Create profile');
  console.log('   GET  /agents/:slug   - Get agent');
  console.log('   GET  /agents/:id/trust-score');
  console.log('===========================================');
  console.log('');
});

export default app;
