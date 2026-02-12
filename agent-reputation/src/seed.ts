// Seed script with mock agent data
import store from './db/store';
import { v4 as uuid } from 'uuid';

const NOW = Math.floor(Date.now() / 1000);
const DAY = 24 * 60 * 60;

console.log('Seeding database...');

// Seed builders
const builders = [
  { id: uuid(), name: 'Anthropic', slug: 'anthropic', website: 'https://anthropic.com', verified: true, createdAt: NOW - 90 * DAY },
  { id: uuid(), name: 'OpenAI', slug: 'openai', website: 'https://openai.com', verified: true, createdAt: NOW - 90 * DAY },
  { id: uuid(), name: 'Indie Labs', slug: 'indie-labs', website: 'https://indielabs.io', verified: false, createdAt: NOW - 60 * DAY },
  { id: uuid(), name: 'AgentForge', slug: 'agentforge', website: 'https://agentforge.dev', verified: true, createdAt: NOW - 80 * DAY }
];

for (const b of builders) {
  store.setBuilder(b.id, b);
}

// Seed agents
const agents = [
  {
    id: uuid(),
    name: 'Claude Code Agent',
    slug: 'claude-code',
    builderId: builders[0].id,
    description: 'Expert coding assistant for complex software development tasks. Handles code generation, debugging, refactoring, and code review with near-human accuracy.',
    version: '3.5.2',
    sourceUrl: 'https://github.com/anthropic/claude-code',
    mcpEndpoint: 'https://mcp.anthropic.com/claude-code',
    isVerified: true,
    verificationTier: 'enterprise',
    status: 'active',
    createdAt: NOW - 60 * DAY,
    updatedAt: NOW - 1 * DAY
  },
  {
    id: uuid(),
    name: 'GPT DevOps',
    slug: 'gpt-devops',
    builderId: builders[1].id,
    description: 'Infrastructure automation and deployment specialist. Automates CI/CD pipelines, manages Kubernetes clusters, and handles cloud deployments.',
    version: '2.1.0',
    sourceUrl: 'https://github.com/openai/gpt-devops',
    isVerified: true,
    verificationTier: 'standard',
    status: 'active',
    createdAt: NOW - 45 * DAY,
    updatedAt: NOW - 2 * DAY
  },
  {
    id: uuid(),
    name: 'DataMiner Pro',
    slug: 'dataminer-pro',
    builderId: builders[2].id,
    description: 'Data analysis and visualization agent. Transforms raw data into actionable insights with automated reporting.',
    version: '1.4.0',
    isVerified: false,
    verificationTier: 'basic',
    status: 'active',
    createdAt: NOW - 30 * DAY,
    updatedAt: NOW - 5 * DAY
  },
  {
    id: uuid(),
    name: 'SecurityBot',
    slug: 'securitybot',
    builderId: builders[3].id,
    description: 'Automated security auditing and vulnerability detection. Scans codebases for CVEs, misconfigurations, and security anti-patterns.',
    version: '4.0.0',
    sourceUrl: 'https://github.com/agentforge/securitybot',
    isVerified: true,
    verificationTier: 'enterprise',
    status: 'active',
    createdAt: NOW - 75 * DAY,
    updatedAt: NOW - 1 * DAY
  },
  {
    id: uuid(),
    name: 'ContentWriter AI',
    slug: 'contentwriter',
    builderId: builders[2].id,
    description: 'Technical documentation and content generation. Creates API docs, tutorials, and marketing copy.',
    version: '2.0.1',
    isVerified: false,
    verificationTier: 'none',
    status: 'active',
    createdAt: NOW - 20 * DAY,
    updatedAt: NOW - 3 * DAY
  }
];

for (const a of agents) {
  store.setAgent(a.id, a);
}

// Skills
const skills = [
  { id: uuid(), agentId: agents[0].id, skillName: 'code-generation', benchmarkName: 'HumanEval', benchmarkScore: 92.3, benchmarkPercentile: 98, verified: true, selfReported: false, benchmarkDate: NOW - 30 * DAY },
  { id: uuid(), agentId: agents[0].id, skillName: 'debugging', benchmarkName: 'SWE-bench', benchmarkScore: 48.5, benchmarkPercentile: 95, verified: true, selfReported: false, benchmarkDate: NOW - 30 * DAY },
  { id: uuid(), agentId: agents[0].id, skillName: 'code-review', benchmarkName: null, benchmarkScore: null, benchmarkPercentile: null, verified: false, selfReported: true },
  { id: uuid(), agentId: agents[1].id, skillName: 'infrastructure', benchmarkName: 'DevOps-Eval', benchmarkScore: 87.0, benchmarkPercentile: 90, verified: true, selfReported: false, benchmarkDate: NOW - 25 * DAY },
  { id: uuid(), agentId: agents[1].id, skillName: 'kubernetes', benchmarkName: null, benchmarkScore: null, benchmarkPercentile: null, verified: false, selfReported: true },
  { id: uuid(), agentId: agents[2].id, skillName: 'data-analysis', benchmarkName: 'TabBench', benchmarkScore: 76.2, benchmarkPercentile: 75, verified: true, selfReported: false, benchmarkDate: NOW - 20 * DAY },
  { id: uuid(), agentId: agents[3].id, skillName: 'security-audit', benchmarkName: 'SecEval', benchmarkScore: 94.1, benchmarkPercentile: 99, verified: true, selfReported: false, benchmarkDate: NOW - 15 * DAY },
  { id: uuid(), agentId: agents[3].id, skillName: 'vulnerability-detection', benchmarkName: 'CVE-Catch', benchmarkScore: 89.5, benchmarkPercentile: 96, verified: true, selfReported: false, benchmarkDate: NOW - 15 * DAY }
];

for (const s of skills) {
  store.setSkill(s.id, s);
}

// Metrics
const metrics = [
  { id: uuid(), agentId: agents[0].id, periodStart: NOW - 30 * DAY, periodEnd: NOW, deploymentCount: 15420, activeDeployments: 8932, totalTasksCompleted: 2847500, totalTasksFailed: 28475, uptimePercentage: 99.94, errorRate: 0.01, p50LatencyMs: 245, p95LatencyMs: 890 },
  { id: uuid(), agentId: agents[1].id, periodStart: NOW - 30 * DAY, periodEnd: NOW, deploymentCount: 6750, activeDeployments: 3210, totalTasksCompleted: 892000, totalTasksFailed: 17840, uptimePercentage: 99.87, errorRate: 0.02, p50LatencyMs: 320, p95LatencyMs: 1200 },
  { id: uuid(), agentId: agents[2].id, periodStart: NOW - 30 * DAY, periodEnd: NOW, deploymentCount: 890, activeDeployments: 420, totalTasksCompleted: 45000, totalTasksFailed: 2250, uptimePercentage: 98.5, errorRate: 0.05, p50LatencyMs: 560, p95LatencyMs: 2100 },
  { id: uuid(), agentId: agents[3].id, periodStart: NOW - 30 * DAY, periodEnd: NOW, deploymentCount: 3200, activeDeployments: 1850, totalTasksCompleted: 125000, totalTasksFailed: 1250, uptimePercentage: 99.99, errorRate: 0.01, p50LatencyMs: 180, p95LatencyMs: 450 }
];

for (const m of metrics) {
  store.setMetrics(m.id, m);
}

// Reviews
const reviews = [
  { id: uuid(), agentId: agents[0].id, reviewerId: uuid(), reviewerName: 'Jane D.', reviewerCompany: 'TechCorp', rating: 5, title: 'Best coding assistant ever', content: 'Completely transformed our development workflow. Code quality improved 40%.', useCase: 'Full-stack development', deploymentDurationDays: 180, wouldRecommend: true, verifiedDeployment: true, createdAt: NOW - 10 * DAY, helpfulCount: 45 },
  { id: uuid(), agentId: agents[0].id, reviewerId: uuid(), reviewerName: 'Mike S.', reviewerCompany: 'StartupXYZ', rating: 5, title: 'Incredible code quality', content: 'Reduced our code review time by 60%. Catches bugs humans miss.', useCase: 'Backend APIs', deploymentDurationDays: 90, wouldRecommend: true, verifiedDeployment: true, createdAt: NOW - 15 * DAY, helpfulCount: 32 },
  { id: uuid(), agentId: agents[0].id, reviewerId: uuid(), reviewerName: 'Alex R.', reviewerCompany: 'IndieHacker', rating: 4, title: 'Great but expensive', content: 'Works amazingly well, but enterprise pricing is steep for small teams.', useCase: 'Side projects', deploymentDurationDays: 45, wouldRecommend: true, verifiedDeployment: false, createdAt: NOW - 20 * DAY, helpfulCount: 28 },
  { id: uuid(), agentId: agents[1].id, reviewerId: uuid(), reviewerName: 'Sarah K.', reviewerCompany: 'CloudFirst', rating: 4, title: 'Solid DevOps automation', content: 'Handles 80% of our infrastructure tasks autonomously.', useCase: 'CI/CD pipelines', deploymentDurationDays: 120, wouldRecommend: true, verifiedDeployment: true, createdAt: NOW - 12 * DAY, helpfulCount: 19 },
  { id: uuid(), agentId: agents[1].id, reviewerId: uuid(), reviewerName: 'Tom B.', reviewerCompany: 'Acme Inc', rating: 3, title: 'Good but learning curve', content: 'Powerful but took weeks to configure properly for our stack.', useCase: 'Infrastructure migration', deploymentDurationDays: 30, wouldRecommend: false, verifiedDeployment: true, createdAt: NOW - 25 * DAY, helpfulCount: 12 },
  { id: uuid(), agentId: agents[3].id, reviewerId: uuid(), reviewerName: 'Chris L.', reviewerCompany: 'SecureTech', rating: 5, title: 'Found critical vulns we missed', content: 'Discovered 3 critical vulnerabilities our manual audit missed. Worth every penny.', useCase: 'Security audit', deploymentDurationDays: 60, wouldRecommend: true, verifiedDeployment: true, createdAt: NOW - 8 * DAY, helpfulCount: 67 }
];

for (const r of reviews) {
  store.setReview(r.id, r);
}

// Security audits
const audits = [
  { id: uuid(), agentId: agents[0].id, auditorName: 'Trail of Bits', auditType: 'code_review', auditDate: NOW - 45 * DAY, passed: true, criticalIssues: 0, highIssues: 0, mediumIssues: 2, lowIssues: 5, verified: true, reportUrl: 'https://audits.example.com/claude-code-2024' },
  { id: uuid(), agentId: agents[3].id, auditorName: 'Cure53', auditType: 'penetration_test', auditDate: NOW - 30 * DAY, passed: true, criticalIssues: 0, highIssues: 0, mediumIssues: 0, lowIssues: 1, verified: true, reportUrl: 'https://audits.example.com/securitybot-2024' }
];

for (const a of audits) {
  store.setAudit(a.id, a);
}

// Badges
const badges = [
  { id: uuid(), agentId: agents[0].id, badgeType: 'verified_builder', badgeName: 'Verified Builder', issuedAt: NOW - 60 * DAY, issuer: 'AgentReputation' },
  { id: uuid(), agentId: agents[0].id, badgeType: 'security_audited', badgeName: 'Security Audited', issuedAt: NOW - 45 * DAY, issuer: 'Trail of Bits' },
  { id: uuid(), agentId: agents[0].id, badgeType: 'top_performer', badgeName: 'Top 1% Performer', issuedAt: NOW - 30 * DAY, issuer: 'AgentReputation' },
  { id: uuid(), agentId: agents[3].id, badgeType: 'security_audited', badgeName: 'Security Audited', issuedAt: NOW - 30 * DAY, issuer: 'Cure53' },
  { id: uuid(), agentId: agents[3].id, badgeType: 'verified_builder', badgeName: 'Verified Builder', issuedAt: NOW - 70 * DAY, issuer: 'AgentReputation' }
];

for (const b of badges) {
  store.setBadge(b.id, b);
}

// Agent pairs (frequently deployed together)
const pairs = [
  { id: uuid(), agentAId: agents[0].id, agentBId: agents[1].id, coDeploymentCount: 1250, lastSeen: NOW },
  { id: uuid(), agentAId: agents[0].id, agentBId: agents[3].id, coDeploymentCount: 890, lastSeen: NOW },
  { id: uuid(), agentAId: agents[1].id, agentBId: agents[3].id, coDeploymentCount: 560, lastSeen: NOW - 2 * DAY }
];

for (const p of pairs) {
  store.setAgentPair(p.id, p);
}

// Endorsements
const endorsements = [
  { id: uuid(), endorserAgentId: agents[1].id, endorsedAgentId: agents[0].id, skillName: 'code-generation', context: 'Excellent code quality for infrastructure scripts', collaborationCount: 1250, createdAt: NOW - 15 * DAY },
  { id: uuid(), endorserAgentId: agents[3].id, endorsedAgentId: agents[0].id, skillName: 'code-review', context: 'Catches security issues in PRs', collaborationCount: 890, createdAt: NOW - 10 * DAY },
  { id: uuid(), endorserAgentId: agents[0].id, endorsedAgentId: agents[3].id, skillName: 'security-audit', context: 'Found vulnerabilities I missed', collaborationCount: 890, createdAt: NOW - 10 * DAY }
];

for (const e of endorsements) {
  store.setEndorsement(e.id, e);
}

// Integrations
const integrations = [
  { id: uuid(), agentId: agents[0].id, integrationType: 'mcp_server', integrationName: 'GitHub', verified: true, createdAt: NOW - 50 * DAY },
  { id: uuid(), agentId: agents[0].id, integrationType: 'mcp_server', integrationName: 'VS Code', verified: true, createdAt: NOW - 50 * DAY },
  { id: uuid(), agentId: agents[0].id, integrationType: 'api', integrationName: 'Jira', verified: true, createdAt: NOW - 40 * DAY },
  { id: uuid(), agentId: agents[1].id, integrationType: 'mcp_server', integrationName: 'AWS', verified: true, createdAt: NOW - 35 * DAY },
  { id: uuid(), agentId: agents[1].id, integrationType: 'mcp_server', integrationName: 'Kubernetes', verified: true, createdAt: NOW - 35 * DAY },
  { id: uuid(), agentId: agents[3].id, integrationType: 'api', integrationName: 'Snyk', verified: true, createdAt: NOW - 60 * DAY },
  { id: uuid(), agentId: agents[3].id, integrationType: 'mcp_server', integrationName: 'GitHub', verified: true, createdAt: NOW - 60 * DAY }
];

for (const i of integrations) {
  store.setIntegration(i.id, i);
}

console.log('Database seeded!');
console.log(`- ${builders.length} builders`);
console.log(`- ${agents.length} agents`);
console.log(`- ${skills.length} skills`);
console.log(`- ${reviews.length} reviews`);
console.log(`- ${audits.length} security audits`);
console.log(`- ${badges.length} badges`);
console.log(`- ${endorsements.length} endorsements`);
console.log(`- ${integrations.length} integrations`);
